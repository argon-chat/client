import { VideoUploadError } from "@argon/glue";

/**
 * Why a prepared video did not end up on the server: the server's refusal (a VideoUploadError; also
 * NOT_STREAMABLE when the client sees the header is beyond the server's reach before declaring), a
 * cancel, the transfer failing (`network`), the storage refusing the signed request (`forbidden`, a
 * 403) or refusing it otherwise (`storage`), or a bucket whose CORS hides the ETag.
 */
export type VideoUploadFailureCode = VideoUploadError | "aborted" | "network" | "forbidden" | "storage" | "etag-unavailable";

/** A stable, low-cardinality name for a failure code (`TOO_LARGE`, `aborted`, …). */
export function videoUploadFailureName(code: VideoUploadFailureCode): string {
  if (typeof code === "string") return code;
  return VideoUploadError[code] ?? `UNKNOWN_${code}`;
}

export class VideoUploadFailure extends Error {
  override name: string;
  constructor(
    public readonly code: VideoUploadFailureCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? videoUploadFailureName(code), options);
    this.name = code === "aborted" ? "AbortError" : "VideoUploadFailure";
  }
}
