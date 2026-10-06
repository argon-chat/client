/** What the user reads when a video could not be sent, by the code that stopped it. */
import { describe, test, expect } from "vitest";
import { VideoUploadError } from "@argon/glue";
import { VideoUploadFailure } from "@/lib/video/uploadErrors";
import { VideoPrepareError } from "@/lib/video/errors";
import { videoSendErrorKey, videoUploadErrorKey } from "@/lib/attachments/videoSendErrors";
import en from "../../../packages/i18n/src/core/en.json";

describe("videoUploadErrorKey", () => {
  test.each([
    [VideoUploadError.TOO_LARGE, "video_upload_error_too_large"],
    [VideoUploadError.TOO_LONG, "video_upload_error_too_long"],
    [VideoUploadError.NOT_STREAMABLE, "video_upload_error_not_streamable"],
    [VideoUploadError.DECLARATION_MISMATCH, "video_upload_error_mismatch"],
    [VideoUploadError.POSTER_REJECTED, "video_upload_error_poster"],
    [VideoUploadError.TICKET_EXPIRED, "video_upload_error_expired"],
    [VideoUploadError.NOT_AUTHORIZED, "video_upload_error_not_authorized"],
    ["network", "video_upload_error_network"],
    ["etag-unavailable", "video_upload_error_storage"],
    ["storage", "video_upload_error_storage"],
    ["forbidden", "video_upload_error_forbidden"],
    ["aborted", "video_upload_error_aborted"],
    [VideoUploadError.CONTENT_TYPE_REJECTED, "video_upload_error_generic"],
    [VideoUploadError.NOT_FOUND, "video_upload_error_generic"],
    [VideoUploadError.INTERNAL_ERROR, "video_upload_error_generic"],
    [99 as VideoUploadError, "video_upload_error_generic"],
  ] as const)("%s → %s", (code, key) => {
    expect(videoUploadErrorKey(code)).toBe(key);
    expect((en as unknown as Record<string, string>)[key], `${key} is in en.json`).toBeTruthy();
  });
});

describe("videoSendErrorKey", () => {
  test("an upload failure by its code, a cancel included", () => {
    expect(videoSendErrorKey(new VideoUploadFailure(VideoUploadError.TOO_LONG))).toBe("video_upload_error_too_long");
    expect(videoSendErrorKey(new VideoUploadFailure("aborted"))).toBe("video_upload_error_aborted");
    expect(videoSendErrorKey(new VideoUploadFailure("network"))).toBe("video_upload_error_network");
    expect(videoSendErrorKey(new VideoUploadFailure("forbidden"))).toBe("video_upload_error_forbidden");
    expect(videoSendErrorKey(new VideoUploadFailure("storage"))).toBe("video_upload_error_storage");
  });

  test("a video that could not be brought under the limit names the limit", () => {
    expect(videoSendErrorKey(new VideoPrepareError("output-too-large"))).toBe("video_send_error_output_too_large");
    expect((en as unknown as Record<string, string>).video_send_error_output_too_large).toContain("{limit}");
  });

  test("a preparation that failed, or was cancelled", () => {
    expect(videoSendErrorKey(new VideoPrepareError("conversion-failed"))).toBe("video_send_error_prepare");
    expect(videoSendErrorKey(new VideoPrepareError("aborted"))).toBe("video_upload_error_aborted");
    expect(videoSendErrorKey(new DOMException("stopped", "AbortError"))).toBe("video_upload_error_aborted");
  });

  test("anything else", () => {
    expect(videoSendErrorKey(new Error("boom"))).toBe("video_upload_error_generic");
    expect(videoSendErrorKey(null)).toBe("video_upload_error_generic");
    expect((en as unknown as Record<string, string>).video_send_error_prepare).toBeTruthy();
  });
});
