// No runtime import of @argon/glue here: the transcode worker imports this file.

/** Why a file could not be read as a video. */
export type VideoProbeErrorCode = "unsupported-format" | "no-video-track" | "unreadable";

export class VideoProbeError extends Error {
  override name = "VideoProbeError";
  constructor(
    public readonly code: VideoProbeErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
  }
}

/** Why preparing a video failed. `aborted` is a cancel, not a failure. */
export type VideoPrepareErrorCode =
  | "aborted"
  | "not-preparable"
  | "unsupported-codec"
  | "undecodable"
  | "no-encoder"
  | "invalid-conversion"
  | "conversion-failed"
  | "empty-output"
  /** The output came out over the plan's maxBytes (an encoder overshot); prepareWithinLimit steps down. */
  | "output-too-large"
  | "worker-failed";

export class VideoPrepareError extends Error {
  override name: string;
  constructor(
    public readonly code: VideoPrepareErrorCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    // Callers that only know the DOM convention still see a cancel as one.
    this.name = code === "aborted" ? "AbortError" : "VideoPrepareError";
  }
}

/**
 * Why one part (or the single PUT) of the video bytes could not be stored: `forbidden` is a 403 from
 * the storage (expired or mismatched signature), `http` any other refusal, `network` no answer (or a
 * timeout) after the retries.
 */
export type VideoPartUploadErrorCode = "aborted" | "network" | "http" | "forbidden" | "etag-unavailable" | "bad-ticket";

export class VideoPartUploadError extends Error {
  override name: string;
  constructor(
    public readonly code: VideoPartUploadErrorCode,
    message?: string,
    public readonly status?: number,
    public readonly partNumber?: number,
  ) {
    super(message ?? code);
    this.name = code === "aborted" ? "AbortError" : "VideoPartUploadError";
  }
}

/** Whether `e` is a cancel, whichever layer threw it. */
export function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}
