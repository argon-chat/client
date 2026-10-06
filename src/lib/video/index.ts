/**
 * Video preparation and upload (VideoUpload.ion). The sending client does the heavy work; the server
 * only checks the MP4's header against the declaration and serves the bytes by range.
 *
 *   probe   → probeVideo(file): container, display size, pixel aspect, duration (packets and mvhd),
 *             codecs, bitrate, fast start as the server reads it.
 *   plan    → planVideo(probe, prefs, await videoCodecAvailability()): copy | remux | transcode |
 *             original. Pure. A transcode is planned against 90 % of maxBytes and the memory budget
 *             (videoMemoryBudget). `original` means "send it as a plain file" (recordVideoSentAsFile).
 *   prepare → prepareWithinLimit(file, probe, prefs, encoders, { onProgress, signal }): plan +
 *             prepareVideo, re-planned one rung lower when the output overshoots maxBytes. One
 *             fast-start MP4 (H.264 + AAC or silent), converted by mediabunny in a worker; `copy`
 *             sends the file's own bytes.
 *   poster  → extractPoster(prepared.blob, atMs, { signal }): WebP ≤ 720 px + ThumbHash.
 *   board   → buildStoryboard(prepared.blob, durationMs, { signal }): WebP sprite for scrubbing
 *             (≥ 8 s only). Both decode, and reject with VideoPrepareError `undecodable` at once on
 *             a browser that cannot decode the codec. A transcode's source was decodable, so take
 *             them from the source there. In copy/remux the source is H.264 too, so on a browser
 *             that cannot decode H.264 they are simply skipped (thumbHash null).
 *   upload  → uploadVideo(target, { ...prepared, fileName, poster, storyboard }, { onProgress,
 *             signal }): header checked to be within the server's reach (else NOT_STREAMABLE
 *             before anything is sent), poster and storyboard as attachments, PrepareVideoUpload
 *             (POSTER_REJECTED retried without them), the parts (one PUT for an older server),
 *             CompleteVideoUpload → VideoInfo.
 *   entity  → videoEntityOf(info) for the message; videoEntityFromOptimistic(...) for the bubble
 *             shown before the upload finishes.
 *
 * Failures are typed codes (VideoProbeError, VideoPrepareError, VideoUploadFailure); the UI
 * translates them. A cancel through the signal rejects with name `AbortError`. Every progress
 * callback only goes up, across retries and re-runs.
 *
 * Import this module lazily (`await import("@/lib/video")`): it pulls in mediabunny.
 */

export type { VideoProbe, VideoContainer } from "./probe";
export { probeVideo } from "./probe";

export type {
  VideoQuality,
  VideoRung,
  VideoPrepareMode,
  VideoOriginalReason,
  VideoRotation,
  VideoCrop,
  VideoTrim,
  VideoPrefs,
  VideoEncoderAvailability,
  VideoEncodePlan,
  VideoAudioPlan,
  VideoPlan,
} from "./plan";
export {
  VIDEO_LADDER,
  KEYFRAME_INTERVAL_SEC,
  MAX_FRAME_RATE,
  AAC_BITRATE,
  SIZE_MARGIN,
  MEMORY_BUDGET_BYTES,
  LOW_MEMORY_BUDGET_BYTES,
  planVideo,
  estimateOutputBytes,
  videoBitrate,
  scaledDimensions,
  tierOf,
  rungOf,
  rungBelow,
  videoMemoryBudget,
  durationsAgree,
} from "./plan";

export type { VideoCodecAvailability } from "./codecs";
export { videoCodecAvailability, ensureAacEncoder } from "./codecs";

export type { PreparedVideo, PrepareVideoOptions, PreparedWithinLimit } from "./transcode";
export { prepareVideo, prepareWithinLimit } from "./transcode";

export { SERVER_HEAD_BYTES, VIDEO_PROBE_BYTES } from "./mp4Boxes";
export { FRAME_TIMEOUT_MS } from "./frames";

export type { VideoPoster } from "./poster";
export { extractPoster } from "./poster";

export type { StoryboardGeometry, VideoStoryboardSprite } from "./storyboard";
export { buildStoryboard, storyboardGeometry } from "./storyboard";

export { computePreloadPrefixSize } from "./preloadPrefix";

export type { PartPut, PartPutResult, UploadPartsOptions, UploadSingleOptions } from "./multipartUpload";
export { uploadVideoParts, uploadVideoSingle, partRanges, PART_TIMEOUT_MS } from "./multipartUpload";

export type { VideoUploadTarget, VideoUploadApi, VideoUploadStage, VideoUploadInput, UploadVideoOptions } from "./videoUpload";
export { uploadVideo, mp4FileName } from "./videoUpload";

export { videoEntityOf, isVideoEntity, videoEntityFromOptimistic, PLACEHOLDER_FILE_ID } from "./entity";

export { videoUploadQuality, VIDEO_UPLOAD_QUALITY_KEY, DEFAULT_VIDEO_UPLOAD_QUALITY, isVideoQuality } from "./settings";

export type { VideoProbeErrorCode, VideoPrepareErrorCode, VideoPartUploadErrorCode } from "./errors";
export { VideoProbeError, VideoPrepareError, VideoPartUploadError, isAbortError } from "./errors";
export type { VideoUploadFailureCode } from "./uploadErrors";
export { VideoUploadFailure, videoUploadFailureName } from "./uploadErrors";

export { recordVideoSentAsFile } from "./telemetry";

/** The steps between a video being picked and being sent, in order, for a progress UI. */
export type VideoPrepareStage = "probe" | "prepare" | "poster" | "storyboard" | "upload";
export const VIDEO_PREPARE_STAGES: readonly VideoPrepareStage[] = ["probe", "prepare", "poster", "storyboard", "upload"];
