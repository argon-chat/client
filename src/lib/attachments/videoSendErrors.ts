import { VideoUploadError } from "@argon/glue";
import type { VideoUploadFailureCode } from "@/lib/video/uploadErrors";

/** The message for a video upload that failed with `code` (the server's refusal or the transfer's). */
export function videoUploadErrorKey(code: VideoUploadFailureCode): string {
  switch (code) {
    case VideoUploadError.TOO_LARGE:
      return "video_upload_error_too_large";
    case VideoUploadError.TOO_LONG:
      return "video_upload_error_too_long";
    case VideoUploadError.NOT_STREAMABLE:
      return "video_upload_error_not_streamable";
    case VideoUploadError.DECLARATION_MISMATCH:
      return "video_upload_error_mismatch";
    case VideoUploadError.POSTER_REJECTED:
      return "video_upload_error_poster";
    case VideoUploadError.TICKET_EXPIRED:
      return "video_upload_error_expired";
    case VideoUploadError.NOT_AUTHORIZED:
      return "video_upload_error_not_authorized";
    case "network":
      return "video_upload_error_network";
    case "forbidden":
      return "video_upload_error_forbidden";
    case "storage":
    case "etag-unavailable":
      return "video_upload_error_storage";
    case "aborted":
      return "video_upload_error_aborted";
    default:
      return "video_upload_error_generic";
  }
}

const UPLOAD_CODES = new Set<unknown>(["aborted", "network", "forbidden", "storage", "etag-unavailable"]);

/**
 * The message for whatever stopped a video from being sent: an upload failure by its code, a
 * preparation that failed (or could not get under the size limit) or was cancelled, or anything
 * else. Messages may name the target's limits as `{limit}` and `{duration}`.
 */
export function videoSendErrorKey(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown } | null;
  if (e && typeof e === "object") {
    if (e.name === "VideoUploadFailure" || (e.name === "AbortError" && isUploadCode(e.code))) return videoUploadErrorKey(e.code as VideoUploadFailureCode);
    if (e.name === "VideoPrepareError") return e.code === "output-too-large" ? "video_send_error_output_too_large" : "video_send_error_prepare";
    if (e.name === "AbortError") return "video_upload_error_aborted";
  }
  return "video_upload_error_generic";
}

function isUploadCode(code: unknown): boolean {
  return typeof code === "number" || UPLOAD_CODES.has(code);
}
