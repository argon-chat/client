import type { VideoCodec } from "mediabunny";
import { logger } from "@argon/core";
import { planVideo, rungBelow, type VideoEncoderAvailability, type VideoPlan, type VideoPrefs } from "./plan";
import type { VideoProbe } from "./probe";
import type { Mp4Description } from "./convert";
import type { TranscodeFromWorker, TranscodeToWorker } from "./protocol";
import { VideoPrepareError } from "./errors";
import { recordPrepared, recordPrepareFailed } from "./telemetry";

/** A video ready to declare and upload: one fast-start MP4. */
export interface PreparedVideo {
  /** video/mp4 */
  blob: Blob;
  /** Display size, as the server reads it from the header. */
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
  /** RFC 6381 of the video track (`avc1.64001f`). */
  codecString: string | null;
  mode: "copy" | "remux" | "transcode";
}

export interface PrepareVideoOptions {
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Run the conversion on the page instead of in a worker. Defaults to false; a worker that cannot start falls back to the page anyway. */
  onMainThread?: boolean;
  /** Test hook: encode with this codec instead of H.264. Never set in the app. */
  videoCodec?: VideoCodec;
}

/** How long a cancelled worker gets to close its encoders before it is terminated. */
const CANCEL_GRACE_MS = 500;

interface Converted {
  blob: Blob;
  description: Mp4Description;
}

async function onPage(file: Blob, plan: VideoPlan, options: PrepareVideoOptions): Promise<Converted> {
  const { convertVideo, describeMp4 } = await import("./convert");
  const buffer = await convertVideo(file, plan, options);
  return { blob: new Blob([buffer], { type: "video/mp4" }), description: await describeMp4(buffer) };
}

async function inWorker(file: Blob, plan: VideoPlan, options: PrepareVideoOptions): Promise<Converted> {
  let worker: Worker;
  try {
    const { default: TranscodeWorker } = await import("./transcode.worker?worker");
    worker = new TranscodeWorker();
  } catch (e) {
    logger.warn("The video worker could not start; converting on the page:", e);
    return onPage(file, plan, options);
  }

  const { signal, onProgress } = options;
  return new Promise<Converted>((resolve, reject) => {
    let started = false;
    let settled = false;

    const settle = (terminateIn: number, done: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (terminateIn > 0) setTimeout(() => worker.terminate(), terminateIn);
      else worker.terminate();
      done();
    };

    const onAbort = () => {
      worker.postMessage({ type: "cancel" } satisfies TranscodeToWorker);
      settle(CANCEL_GRACE_MS, () => reject(new VideoPrepareError("aborted")));
    };

    worker.onmessage = (event: MessageEvent<TranscodeFromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case "started":
          started = true;
          break;
        case "progress":
          onProgress?.(message.fraction);
          break;
        case "done":
          settle(0, () =>
            resolve({ blob: new Blob([message.buffer], { type: "video/mp4" }), description: message.description }),
          );
          break;
        case "error":
          settle(0, () => reject(new VideoPrepareError(message.code, message.message)));
          break;
      }
    };

    worker.onerror = (event) => {
      event.preventDefault();
      if (started) {
        settle(0, () => reject(new VideoPrepareError("worker-failed", event.message)));
        return;
      }
      logger.warn("The video worker failed to load; converting on the page:", event.message);
      settle(0, () => resolve(onPage(file, plan, options)));
    };

    if (signal?.aborted) {
      settle(0, () => reject(new VideoPrepareError("aborted")));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ type: "start", file, plan, videoCodec: options.videoCodec } satisfies TranscodeToWorker);
  });
}
/** A progress callback that never reports less than it already has. */
function monotonic(onProgress: ((fraction: number) => void) | undefined): ((fraction: number) => void) | undefined {
  if (!onProgress) return undefined;
  let best = 0;
  return (fraction) => {
    if (!(fraction >= best)) return;
    best = fraction;
    onProgress(fraction);
  };
}

/**
 * Turns `file` into the MP4 `plan` describes. `copy` sends the file's own bytes (checked, not
 * rewritten, so a resend still matches the server's hash); `remux` and `transcode` run a mediabunny
 * Conversion in a worker. The result's size, duration and audio are read back from the output, so
 * the declaration matches what the server will probe. Progress only goes up.
 *
 * Throws {@link VideoPrepareError}; a cancel through `signal` rejects with code `aborted` (name
 * `AbortError`); an output over the plan's `maxBytes` (an encoder overshot) with `output-too-large`
 * (see {@link prepareWithinLimit}). An `original` plan cannot be prepared (`not-preparable`): send
 * that file as a file.
 */
export async function prepareVideo(file: Blob, plan: VideoPlan, options: PrepareVideoOptions = {}): Promise<PreparedVideo> {
  if (plan.mode === "original") throw new VideoPrepareError("not-preparable", `The plan sends the file as it is (${plan.reason})`);
  const mode = plan.mode;
  const startedAt = performance.now();
  const onProgress = monotonic(options.onProgress);

  try {
    if (options.signal?.aborted) throw new VideoPrepareError("aborted");

    let converted: Converted;
    if (mode === "copy") {
      const { describeMp4 } = await import("./convert");
      const blob = file.type === "video/mp4" ? file : file.slice(0, file.size, "video/mp4");
      converted = { blob, description: await describeMp4(blob) };
      onProgress?.(1);
    } else {
      const run = { ...options, onProgress };
      converted = options.onMainThread ? await onPage(file, plan, run) : await inWorker(file, plan, run);
    }

    const { blob, description } = converted;
    if (Number.isFinite(plan.maxBytes) && blob.size > plan.maxBytes) {
      throw new VideoPrepareError("output-too-large", `The output is ${blob.size} bytes, over the ${plan.maxBytes} the server takes`);
    }
    recordPrepared(mode, {
      wallMs: performance.now() - startedAt,
      durationMs: description.durationMs,
      bytes: blob.size,
      width: description.width,
      height: description.height,
    });
    return { blob, ...description, mode };
  } catch (e) {
    const error =
      e instanceof VideoPrepareError
        ? e
        : new VideoPrepareError(options.signal?.aborted ? "aborted" : "conversion-failed", e instanceof Error ? e.message : String(e), {
            cause: e,
          });
    recordPrepareFailed(mode, error.code);
    throw error;
  }
}

/** A plan with what it produced; `prepared` is null when the plan sends the file as it is. */
export type PreparedWithinLimit =
  | { plan: VideoPlan & { mode: "copy" | "remux" | "transcode" }; prepared: PreparedVideo }
  | { plan: VideoPlan & { mode: "original" }; prepared: null };

/**
 * Plans and prepares `file`, and when the output comes out over `prefs.maxBytes` (a hardware encoder
 * overshooting its bitrate), plans once more one rung lower and prepares that. An `original` plan
 * (first or second) comes back with `prepared: null`. The progress of the second run continues from
 * where the first stopped rather than starting over. A user who asked for the original quality is
 * not stepped down: the `output-too-large` error is thrown instead.
 */
export async function prepareWithinLimit(
  file: Blob,
  probe: VideoProbe,
  prefs: VideoPrefs,
  encoders: VideoEncoderAvailability,
  options: PrepareVideoOptions = {},
): Promise<PreparedWithinLimit> {
  const onProgress = monotonic(options.onProgress);
  const attempt = async (plan: VideoPlan): Promise<PreparedWithinLimit> =>
    plan.mode === "original"
      ? { plan: plan as VideoPlan & { mode: "original" }, prepared: null }
      : { plan: plan as VideoPlan & { mode: "copy" | "remux" | "transcode" }, prepared: await prepareVideo(file, plan, { ...options, onProgress }) };

  const plan = planVideo(probe, prefs, encoders);
  try {
    return await attempt(plan);
  } catch (e) {
    if (!(e instanceof VideoPrepareError && e.code === "output-too-large") || prefs.quality === "original") throw e;
    const lower = rungBelow(plan.width, plan.height);
    if (lower === null) throw e;
    logger.info(`The video came out over the limit at ${plan.width}×${plan.height}; preparing it at ${lower}p`);
    return attempt(planVideo(probe, { ...prefs, quality: lower }, encoders));
  }
}
