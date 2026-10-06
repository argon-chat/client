/**
 * The mediabunny side of preparing a video: one Conversion into a fast-start MP4 in memory. Runs in
 * the transcode worker, or on the page when no worker can be started.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferSource as MemorySource,
  BufferTarget,
  canEncodeVideo,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  type ConversionAudioOptions,
  type ConversionOptions,
  type ConversionVideoOptions,
  type DiscardedTrack,
  type VideoCodec,
} from "mediabunny";
import { AAC_BITRATE, AAC_CHANNELS, AAC_SAMPLE_RATE, type VideoPlan } from "./plan";
import { VideoPrepareError, type VideoPrepareErrorCode } from "./errors";
import { ensureAacEncoder } from "./codecs";

export type HardwareAcceleration = "prefer-hardware" | "no-preference";

export interface ConvertOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /**
   * Test hook: encode with this codec instead of H.264, for a Chromium build without an H.264
   * encoder. Never set in the app.
   */
  videoCodec?: VideoCodec;
}

/** What the server will read back from the MP4's header. */
export interface Mp4Description {
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
  codecString: string | null;
}

const PROGRESS_INTERVAL_MS = 100;

/**
 * The Conversion options a plan stands for. A packet-copy plan (`video: null`) sets nothing on the
 * video, so mediabunny copies it; a transcode re-encodes with rotation baked into the pixels, so the
 * output's width and height are its display size with no matrix to apply.
 */
export function conversionOptions(
  plan: VideoPlan,
  { videoCodec, hardwareAcceleration = "prefer-hardware" }: { videoCodec?: VideoCodec; hardwareAcceleration?: HardwareAcceleration } = {},
): Pick<ConversionOptions, "video" | "audio" | "trim" | "tracks"> {
  const video: ConversionVideoOptions = plan.video
    ? {
        codec: videoCodec ?? plan.video.codec,
        width: plan.video.width,
        height: plan.video.height,
        fit: "contain",
        crop: plan.crop ?? undefined,
        rotate: plan.rotate,
        flip: plan.flip || undefined,
        frameRate: plan.video.frameRate ?? undefined,
        quality: new Quality({ bitrate: plan.video.bitrate }),
        keyFrameInterval: plan.video.keyFrameIntervalSec,
        hardwareAcceleration,
        allowTransformationMetadata: false,
        forceTranscode: true,
      }
    : {};

  const audio: ConversionAudioOptions =
    plan.audio === "none"
      ? { discard: true }
      : plan.audio === "aac"
        ? {
            codec: "aac",
            quality: new Quality({ bitrate: AAC_BITRATE }),
            numberOfChannels: AAC_CHANNELS,
            sampleRate: AAC_SAMPLE_RATE,
            forceTranscode: true,
          }
        : { codec: "aac" };

  return {
    tracks: "primary",
    video,
    audio,
    trim: plan.trim ? { start: plan.trim.startMs / 1000, end: plan.trim.endMs / 1000 } : undefined,
  };
}

function discardCode(reason: DiscardedTrack["reason"]): VideoPrepareErrorCode | null {
  switch (reason) {
    case "unknown_source_codec":
      return "unsupported-codec";
    case "undecodable_source_codec":
      return "undecodable";
    case "no_encodable_target_codec":
      return "no-encoder";
    case "cannot_copy":
      return "invalid-conversion";
    default:
      return null;
  }
}

/** Why an initialised conversion would not produce what the plan promised, or null. */
function conversionProblem(conversion: Conversion, plan: VideoPlan): VideoPrepareError | null {
  for (const { track, reason } of conversion.discardedTracks) {
    if (track.type === "audio" && plan.audio === "none") continue;
    const code = discardCode(reason);
    if (code) return new VideoPrepareError(code, `The ${track.type} track was discarded (${reason})`);
  }
  if (!conversion.isValid) return new VideoPrepareError("invalid-conversion");
  return null;
}

/** At most every 100 ms, and never lower than already reported (a re-run starts from 0 again). */
function throttled(onProgress: ((fraction: number) => void) | undefined): (fraction: number) => void {
  let last = 0;
  let best = 0;
  return (fraction) => {
    const now = performance.now();
    const value = Math.min(1, Math.max(0, fraction));
    if (!onProgress || value < best || (now - last < PROGRESS_INTERVAL_MS && value < 1)) return;
    last = now;
    best = value;
    onProgress(value);
  };
}

/** Whether a hardware encoder takes this plan's frame; asked first so a refusal costs no failed attempt. */
async function hardwareEncodes(plan: VideoPlan, videoCodec: VideoCodec | undefined): Promise<boolean> {
  if (!plan.video) return false;
  return canEncodeVideo(videoCodec ?? plan.video.codec, {
    width: plan.video.width,
    height: plan.video.height,
    quality: new Quality({ bitrate: plan.video.bitrate }),
    hardwareAcceleration: "prefer-hardware",
  }).catch(() => false);
}

function aborted(signal?: AbortSignal): VideoPrepareError | null {
  return signal?.aborted ? new VideoPrepareError("aborted") : null;
}

/**
 * Converts `file` as `plan` says into a fast-start MP4 held in memory. Memory peaks at about three
 * times the output: the muxer keeps every chunk until finalize ('in-memory' fast start; 'reserve'
 * would need a per-track packet count the Conversion API does not take), the BufferTarget grows by
 * doubling and is sliced to size at the end, and the page then copies it into a Blob. The plan keeps
 * outputs within the memory budget (videoMemoryBudget: 512 MiB, 256 MiB on a ≤ 4 GB device).
 *
 * Hardware encoding is preferred when a hardware encoder takes the frame; if it then fails, the
 * conversion runs once more without the preference.
 */
export async function convertVideo(file: Blob, plan: VideoPlan, options: ConvertOptions = {}): Promise<ArrayBuffer> {
  const { signal, videoCodec } = options;
  const progress = throttled(options.onProgress);

  if (plan.audio === "aac" && !(await ensureAacEncoder()).aac) throw new VideoPrepareError("no-encoder", "No AAC encoder");

  const attempts: HardwareAcceleration[] = (await hardwareEncodes(plan, videoCodec)) ? ["prefer-hardware", "no-preference"] : ["no-preference"];
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const last = attempt === attempts.length - 1;
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    let conversion: Conversion | null = null;
    const onAbort = () => void conversion?.cancel();

    try {
      const early = aborted(signal);
      if (early) throw early;

      conversion = await Conversion.init({
        input,
        output,
        showWarnings: false,
        ...conversionOptions(plan, { videoCodec, hardwareAcceleration: attempts[attempt] }),
      });

      const problem = conversionProblem(conversion, plan);
      if (problem) {
        await conversion.cancel();
        if (problem.code === "no-encoder" && !last) continue;
        throw problem;
      }

      signal?.addEventListener("abort", onAbort, { once: true });
      const late = aborted(signal);
      if (late) throw late;

      conversion.onProgress = progress;
      await conversion.execute();

      const buffer = output.target.buffer;
      if (!buffer || buffer.byteLength === 0) throw new VideoPrepareError("empty-output");
      progress(1);
      return buffer;
    } catch (e) {
      if (signal?.aborted || e instanceof ConversionCanceledError) throw new VideoPrepareError("aborted", undefined, { cause: e });
      if (e instanceof VideoPrepareError) throw e;
      if (!last) continue;
      throw new VideoPrepareError("conversion-failed", e instanceof Error ? e.message : String(e), { cause: e });
    } finally {
      signal?.removeEventListener("abort", onAbort);
      input.dispose();
    }
  }

  throw new VideoPrepareError("conversion-failed");
}

/** Reads back the display size, duration, audio and codec of an MP4, as the server's probe will. */
export async function describeMp4(mp4: Blob | ArrayBuffer): Promise<Mp4Description> {
  const source = mp4 instanceof Blob ? new BlobSource(mp4) : new MemorySource(mp4);
  const input = new Input({ source, formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new VideoPrepareError("empty-output", "The output has no video track");
    const audio = await input.getPrimaryAudioTrack();
    const [width, height, codecString, durationSec] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getCodecParameterString(),
      input.computeDuration(audio ? [video, audio] : [video]),
    ]);
    return { width, height, durationMs: Math.round(durationSec * 1000), hasAudio: !!audio, codecString };
  } finally {
    input.dispose();
  }
}
