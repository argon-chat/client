import type { VideoProbe } from "./probe";

/**
 * What to do with a source video before upload. Pure: the probe, the user's choices and what the
 * browser can encode in, a plan out.
 *
 * - `copy`: the file already is what the server takes (MP4, H.264 + AAC or silent, moov first,
 *   within the quality cap) and goes up byte for byte.
 * - `remux`: the H.264 packets are right but the box around them is not (MOV/MKV/WebM, moov at the
 *   end, extra tracks, audio to drop or to turn into AAC): packets are copied into a fresh MP4.
 * - `transcode`: re-encoded to H.264 on a Telegram-style ladder, edits applied.
 * - `original`: cannot be made playable here (no encoder, cannot decode, will not fit, or the user
 *   asked for the original and it is not already playable): send it as a plain file.
 */

export const VIDEO_LADDER = [360, 480, 720, 1080] as const;
export type VideoRung = (typeof VIDEO_LADDER)[number];
export type VideoQuality = "auto" | VideoRung | "original";
export type VideoPrepareMode = "copy" | "remux" | "transcode" | "original";
export type VideoOriginalReason = "user-original" | "no-encoder" | "undecodable" | "too-large";
export type VideoRotation = 0 | 90 | 180 | 270;

/** In display pixels of the (rotated) source, as mediabunny takes it. */
export interface VideoCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface VideoTrim {
  startMs: number;
  endMs: number;
}

export interface VideoPrefs {
  quality: VideoQuality;
  mute?: boolean;
  trim?: VideoTrim | null;
  crop?: VideoCrop | null;
  /** Clockwise, on top of the file's own rotation. */
  rotate?: VideoRotation;
  /** Mirrored horizontally after the rotation (the crop is in the mirrored frame). */
  flip?: boolean;
  /** The largest video the server takes from this user (its size tier). */
  maxBytes: number;
}

/** What this browser can encode, from {@link videoCodecAvailability}. */
export interface VideoEncoderAvailability {
  avc: boolean;
  aac: boolean;
  /** The largest output prepared in memory; {@link videoMemoryBudget} when not given. */
  memoryBudgetBytes?: number;
}

export interface VideoEncodePlan {
  codec: "avc";
  width: number;
  height: number;
  /** Bits per second. */
  bitrate: number;
  keyFrameIntervalSec: number;
  /** Set only when the source is faster than {@link MAX_FRAME_RATE}. */
  frameRate: number | null;
}

/** `copy` keeps the source's AAC packets, `aac` re-encodes to AAC, `none` drops the audio. */
export type VideoAudioPlan = "copy" | "aac" | "none";

export interface VideoPlan {
  mode: VideoPrepareMode;
  /** Set when mode is `original`. */
  reason: VideoOriginalReason | null;
  /** Display size of the output. */
  width: number;
  height: number;
  durationMs: number;
  /** null: the video packets are copied (or the file is sent as it is). */
  video: VideoEncodePlan | null;
  audio: VideoAudioPlan;
  /** Bits per second the audio adds to the output. */
  audioBitrate: number;
  trim: VideoTrim | null;
  crop: VideoCrop | null;
  rotate: VideoRotation;
  flip: boolean;
  sourceBytes: number;
  estimatedBytes: number;
  /** The server's limit the output is checked against after preparing (Infinity when none was given). */
  maxBytes: number;
  /** The requested rung did not fit the limit and a lower one was taken. */
  downscaledToFit: boolean;
}

export const KEYFRAME_INTERVAL_SEC = 2;
export const MAX_FRAME_RATE = 60;
export const AAC_BITRATE = 128_000;
export const AAC_CHANNELS = 2;
export const AAC_SAMPLE_RATE = 48_000;

/** Telegram Android's makeVideoBitrate tiers: cap, compress factor, floor factor. */
const LADDER_MAX_BITRATE: Record<VideoRung, number> = { 1080: 6_800_000, 720: 2_600_000, 480: 1_000_000, 360: 750_000 };
const COMPRESS_FACTOR: Record<VideoRung, number> = { 1080: 1, 720: 1, 480: 0.75, 360: 0.6 };
const MIN_COMPRESS_FACTOR: Record<VideoRung, number> = { 1080: 1, 720: 1, 480: 0.9, 360: 0.7 };
/** Telegram's reference bitrate at 1280×720 (2 Mbps × 1.13) that the floor scales by pixel count. */
const REFERENCE_BITRATE_720P = 2_260_000;
const REFERENCE_PIXELS = 1280 * 720;
const MIN_VIDEO_BITRATE = 100_000;
/** A copy may run this much over its tier's cap before it is worth re-encoding. */
const COPY_BITRATE_HEADROOM = 1.25;
const CONTAINER_OVERHEAD = 1.02;
const MIN_TRIM_MS = 100;
/** H.264 profiles every browser plays: Baseline, Main, High. */
const PLAYABLE_AVC_PROFILES = new Set([66, 77, 100]);
/** A transcode is planned against this share of the limit: hardware encoders overshoot their bitrate. */
export const SIZE_MARGIN = 0.9;
/** Pixels this close to square are square (a copy keeps the coded size, which must be the display size). */
const SQUARE_PIXEL_TOLERANCE = 0.01;

const MIB = 1024 * 1024;
/** The largest output prepared in memory (it peaks at about three times its size while finalized). */
export const MEMORY_BUDGET_BYTES = 512 * MIB;
export const LOW_MEMORY_BUDGET_BYTES = 256 * MIB;

/** 256 MiB on a device reporting ≤ 4 GB of memory, else 512 MiB. */
export function videoMemoryBudget(
  deviceMemory: number | undefined = typeof navigator === "undefined" ? undefined : (navigator as { deviceMemory?: number }).deviceMemory,
): number {
  return deviceMemory !== undefined && deviceMemory <= 4 ? LOW_MEMORY_BUDGET_BYTES : MEMORY_BUDGET_BYTES;
}

/** Whether two durations agree as the server checks them: within max(1 s, 2 %). */
export function durationsAgree(aMs: number, bMs: number): boolean {
  return Math.abs(aMs - bMs) <= Math.max(1_000, 0.02 * Math.max(aMs, bMs));
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
const isEven = (x: number) => x % 2 === 0;

/** The ladder tier a frame belongs to, by its short side. */
export function tierOf(width: number, height: number): VideoRung {
  const short = Math.min(width, height);
  if (short >= 1080) return 1080;
  if (short >= 720) return 720;
  if (short >= 480) return 480;
  return 360;
}

/** The short-side cap a quality setting stands for. `auto` and `original` (when it must encode) cap at 1080. */
export function rungOf(quality: VideoQuality): VideoRung {
  return typeof quality === "number" ? quality : 1080;
}

/** The profile_idc of an `avc1.PPCCLL` string, or null. */
export function avcProfileOf(codecString: string | null): number | null {
  const m = codecString ? /^avc[13]\.([0-9a-f]{2})[0-9a-f]{4}$/i.exec(codecString) : null;
  return m ? Number.parseInt(m[1], 16) : null;
}

/**
 * Telegram Android's makeVideoBitrate: the source bitrate rescaled to the output frame and
 * compressed per tier, clamped to the tier's cap and a floor proportional to the pixel count. A
 * source already below the floor keeps its (rescaled) rate rather than being inflated.
 */
export function videoBitrate(
  source: { width: number; height: number; bitrate: number },
  out: { width: number; height: number },
): number {
  const tier = tierOf(out.width, out.height);
  const max = LADDER_MAX_BITRATE[tier];
  if (!(source.bitrate > 0)) return max;

  const scale = Math.min(source.height / out.height, source.width / out.width);
  const remeasured = Math.round((source.bitrate / scale) * COMPRESS_FACTOR[tier]);
  // A frame longer than 16:9 (a 20:9 phone) would put the pixel-count floor above the tier's cap.
  const min = Math.min(max, Math.round((MIN_COMPRESS_FACTOR[tier] * REFERENCE_BITRATE_720P * out.width * out.height) / REFERENCE_PIXELS));

  let bitrate: number;
  if (source.bitrate < min) bitrate = remeasured;
  else if (remeasured > max) bitrate = max;
  else bitrate = Math.max(remeasured, min);
  return Math.max(MIN_VIDEO_BITRATE, bitrate);
}

/** Output size for a frame capped at `rung` on its short side: never upscaled, even on both sides. */
export function scaledDimensions(width: number, height: number, rung: number): { width: number; height: number } {
  const short = Math.min(width, height);
  const scale = short > rung ? rung / short : 1;
  return { width: even(width * scale), height: even(height * scale) };
}

/** Bytes a plan is expected to produce over `durationMs` (by default its own duration). */
export function estimateOutputBytes(plan: VideoPlan, durationMs: number = plan.durationMs): number {
  if (plan.video) return bitrateBytes(plan.video.bitrate + plan.audioBitrate, durationMs);
  if (plan.durationMs <= 0) return plan.estimatedBytes;
  return Math.ceil((plan.estimatedBytes * durationMs) / plan.durationMs);
}

const bitrateBytes = (bps: number, durationMs: number) => Math.ceil(((bps * durationMs) / 8000) * CONTAINER_OVERHEAD);

function normalizeRotation(rotate: number | undefined): VideoRotation {
  const r = (((Math.round((rotate ?? 0) / 90) * 90) % 360) + 360) % 360;
  return r as VideoRotation;
}

function normalizeTrim(trim: VideoTrim | null | undefined, durationMs: number): VideoTrim | null {
  if (!trim) return null;
  const startMs = Math.min(Math.max(0, Math.round(trim.startMs)), durationMs);
  const endMs = Math.min(Math.max(0, Math.round(trim.endMs)), durationMs);
  if (endMs - startMs < MIN_TRIM_MS) throw new RangeError(`The trim keeps ${endMs - startMs} ms; at least ${MIN_TRIM_MS} ms are needed.`);
  if (startMs === 0 && endMs === durationMs) return null;
  return { startMs, endMs };
}

function normalizeCrop(crop: VideoCrop | null | undefined, width: number, height: number): VideoCrop | null {
  if (!crop) return null;
  const left = Math.min(Math.max(0, Math.round(crop.left)), width - 2);
  const top = Math.min(Math.max(0, Math.round(crop.top)), height - 2);
  const w = Math.min(Math.max(2, Math.round(crop.width)), width - left);
  const h = Math.min(Math.max(2, Math.round(crop.height)), height - top);
  if (left === 0 && top === 0 && w === width && h === height) return null;
  return { left, top, width: w, height: h };
}

function original(probe: VideoProbe, reason: VideoOriginalReason, rotate: VideoRotation, maxBytes: number): VideoPlan {
  return {
    mode: "original",
    reason,
    width: probe.width,
    height: probe.height,
    durationMs: probe.durationMs,
    video: null,
    audio: probe.hasAudio ? "copy" : "none",
    audioBitrate: probe.audioBitrate,
    trim: null,
    crop: null,
    rotate,
    flip: false,
    sourceBytes: probe.size,
    estimatedBytes: probe.size,
    maxBytes,
    downscaledToFit: false,
  };
}

/**
 * Decides how to prepare `probe`'s file. A copy must fit `maxBytes`; a remux also the memory budget;
 * a transcode is estimated against 90 % of `maxBytes` (and the budget), stepping down the ladder
 * until it fits, else `original` / `too-large`. Throws RangeError for a trim under 100 ms.
 */
export function planVideo(probe: VideoProbe, prefs: VideoPrefs, encoders: VideoEncoderAvailability): VideoPlan {
  const maxBytes = prefs.maxBytes > 0 ? prefs.maxBytes : Number.POSITIVE_INFINITY;
  // What is built in memory (remux, transcode) also has to fit the memory budget.
  const memoryLimit = Math.min(maxBytes, encoders.memoryBudgetBytes ?? videoMemoryBudget());
  const transcodeLimit = Math.min(maxBytes * SIZE_MARGIN, memoryLimit);
  const rotate = normalizeRotation(prefs.rotate);
  const [rotatedW, rotatedH] = rotate % 180 === 0 ? [probe.width, probe.height] : [probe.height, probe.width];
  const trim = normalizeTrim(prefs.trim, probe.durationMs);
  const crop = normalizeCrop(prefs.crop, rotatedW, rotatedH);
  const flip = !!prefs.flip;
  const edited = !!trim || !!crop || rotate !== 0 || flip;
  const keepOriginal = prefs.quality === "original";
  const rung = rungOf(prefs.quality);
  const tooFast = probe.fps !== null && probe.fps > MAX_FRAME_RATE + 0.5;

  const wantAudio = probe.hasAudio && !prefs.mute;
  const audioCodecOk = probe.audioCodec === "aac";
  const audioTranscodable = probe.canDecodeAudio && encoders.aac;
  /** The audio a packet-copied or re-encoded output carries, or why it cannot carry it. */
  const audioPlan: VideoAudioPlan | VideoOriginalReason = !wantAudio
    ? "none"
    : audioCodecOk
      ? "copy"
      : audioTranscodable
        ? "aac"
        : probe.canDecodeAudio
          ? "no-encoder"
          : "undecodable";
  const audioBitrate = audioPlan === "copy" ? probe.audioBitrate || AAC_BITRATE : audioPlan === "aac" ? AAC_BITRATE : 0;

  // Packet copy: H.264 every browser plays, square even-sized pixels at ≤ 60 fps, nothing to cut,
  // within the quality cap. (A copy keeps the coded size in tkhd, which the server compares with the
  // declared display size.)
  const profile = avcProfileOf(probe.videoCodecString);
  const videoCopyable =
    probe.videoCodec === "avc" &&
    profile !== null &&
    PLAYABLE_AVC_PROFILES.has(profile) &&
    isEven(probe.width) &&
    isEven(probe.height) &&
    Math.abs(probe.pixelAspectRatio - 1) <= SQUARE_PIXEL_TOLERANCE &&
    !tooFast &&
    !edited &&
    (keepOriginal ||
      (Math.min(probe.width, probe.height) <= rung &&
        probe.bitrate <= LADDER_MAX_BITRATE[tierOf(probe.width, probe.height)] * COPY_BITRATE_HEADROOM));

  if (videoCopyable && (audioPlan === "none" || audioPlan === "copy" || audioPlan === "aac")) {
    const packetCopy = (mode: "copy" | "remux", estimatedBytes: number): VideoPlan => ({
      mode,
      reason: null,
      width: probe.width,
      height: probe.height,
      durationMs: probe.durationMs,
      video: null,
      audio: audioPlan,
      audioBitrate,
      trim: null,
      crop: null,
      rotate: 0,
      flip: false,
      sourceBytes: probe.size,
      estimatedBytes,
      maxBytes,
      downscaledToFit: false,
    });

    // As it is: also its mvhd must state the duration the packets have (an edit list can make them
    // differ, and the server reads mvhd). The bytes are not rebuilt in memory, so no budget applies.
    const asIs =
      probe.container === "mp4" &&
      probe.fastStart &&
      probe.headerDurationMs !== null &&
      durationsAgree(probe.headerDurationMs, probe.durationMs) &&
      probe.videoTrackCount === 1 &&
      probe.audioTrackCount <= 1 &&
      (audioPlan === "copy" || (audioPlan === "none" && !probe.hasAudio));
    if (asIs && probe.size <= maxBytes) return packetCopy("copy", probe.size);

    const sourceAudioBytes = bitrateBytes(probe.audioBitrate, probe.durationMs);
    const remuxBytes =
      audioPlan === "copy"
        ? probe.size
        : Math.max(0, probe.size - sourceAudioBytes) + (audioPlan === "aac" ? bitrateBytes(AAC_BITRATE, probe.durationMs) : 0);
    if (remuxBytes <= memoryLimit) return packetCopy("remux", remuxBytes);
  }

  if (keepOriginal && !edited) return original(probe, "user-original", rotate, maxBytes);
  if (!probe.canDecodeVideo) return original(probe, "undecodable", rotate, maxBytes);
  if (!encoders.avc) return original(probe, "no-encoder", rotate, maxBytes);
  if (audioPlan === "no-encoder" || audioPlan === "undecodable") return original(probe, audioPlan, rotate, maxBytes);

  // Re-encode: the frame after rotation and crop, capped at the rung, stepping down until it fits.
  const frameW = crop?.width ?? rotatedW;
  const frameH = crop?.height ?? rotatedH;
  const cropShare = crop ? (crop.width * crop.height) / (rotatedW * rotatedH) : 1;
  const source = { width: frameW, height: frameH, bitrate: probe.bitrate * cropShare };
  const durationMs = trim ? trim.endMs - trim.startMs : probe.durationMs;
  const frameRate = tooFast ? MAX_FRAME_RATE : null;

  const rungs = [rung, ...VIDEO_LADDER.filter((r) => r < rung).reverse()];
  let first: { width: number; height: number } | null = null;
  for (const candidate of rungs) {
    const dims = scaledDimensions(frameW, frameH, candidate);
    if (first && dims.width === first.width && dims.height === first.height) continue;
    first ??= dims;
    const bitrate = videoBitrate(source, dims);
    const estimatedBytes = bitrateBytes(bitrate + audioBitrate, durationMs);
    if (estimatedBytes > transcodeLimit) continue;
    return {
      mode: "transcode",
      reason: null,
      width: dims.width,
      height: dims.height,
      durationMs,
      video: { codec: "avc", width: dims.width, height: dims.height, bitrate, keyFrameIntervalSec: KEYFRAME_INTERVAL_SEC, frameRate },
      audio: audioPlan,
      audioBitrate,
      trim,
      crop,
      rotate,
      flip,
      sourceBytes: probe.size,
      estimatedBytes,
      maxBytes,
      downscaledToFit: dims.width !== first.width || dims.height !== first.height,
    };
  }

  return original(probe, "too-large", rotate, maxBytes);
}

/** The ladder rung below a frame's short side, or null below 360p: where a too-large output steps down to. */
export function rungBelow(width: number, height: number): VideoRung | null {
  const short = Math.min(width, height);
  const lower = VIDEO_LADDER.filter((r) => r < short);
  return lower.length ? lower[lower.length - 1] : null;
}
