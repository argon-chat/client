import { SuccessUploadFile, type UploadedPart, type VideoUploadTicket } from "@argon/glue";
import { uploadFile } from "@/lib/uploadFile";
import { VideoPartUploadError } from "./errors";

export interface PartPutResult {
  status: number;
  /** The response's ETag header, or null when the response does not expose it. */
  etag: string | null;
}

/**
 * One PUT of one part: exactly the slot's bytes, no headers of its own (the URL signs the length).
 * Resolves with whatever the storage answered; rejects only when no answer came (`network`, also on
 * a timeout) or the request was cancelled (`aborted`).
 */
export type PartPut = (
  url: string,
  body: Blob,
  options: { onProgress?: (loadedBytes: number) => void; signal: AbortSignal; timeoutMs: number },
) => Promise<PartPutResult>;

export interface UploadPartsOptions {
  /** Parts in flight at once. */
  parallel?: number;
  /** Extra attempts per part after a 5xx/408/429 answer, a network failure or a timeout. */
  retries?: number;
  /** How long a part may go without upload progress (or without an answer once sent). */
  timeoutMs?: number;
  /** Bytes sent so far across the parts; never goes down, not even when a part is retried. */
  onProgress?: (bytesSent: number, total: number) => void;
  signal?: AbortSignal;
  /** The transport; XMLHttpRequest by default, since fetch reports no upload progress. */
  put?: PartPut;
  /** Wait before retry `attempt` (0-based). */
  backoffMs?: (attempt: number) => number;
}

export interface PartRange {
  partNumber: number;
  start: number;
  end: number;
}

export const PART_TIMEOUT_MS = 60_000;

const defaultBackoff = (attempt: number) => 500 * 2 ** attempt + Math.random() * 250;

/** Part n carries bytes [(n - 1) · partSize, n · partSize), the last one shorter. */
export function partRanges(size: number, partSize: number): PartRange[] {
  if (!(partSize > 0)) throw new VideoPartUploadError("bad-ticket", `Invalid part size ${partSize}`);
  const count = Math.max(1, Math.ceil(size / partSize));
  return Array.from({ length: count }, (_, i) => ({
    partNumber: i + 1,
    start: i * partSize,
    end: Math.min(size, (i + 1) * partSize),
  }));
}

/** S3 and R2 quote their ETags, some proxies mark them weak; CompleteVideoUpload takes the bare value. */
export function stripEtagQuotes(etag: string): string {
  return etag
    .trim()
    .replace(/^W\//i, "")
    .replace(/^"(.*)"$/, "$1");
}

const isRetryableStatus = (status: number) => status >= 500 || status === 408 || status === 429;

/** The typed error for a refusal: a 403 is the storage refusing the signed request. */
function refusal(status: number, partNumber?: number): VideoPartUploadError {
  const what = partNumber === undefined ? "The upload" : `Part ${partNumber}`;
  return status === 403
    ? new VideoPartUploadError("forbidden", `${what} was refused by the storage (403)`, status, partNumber)
    : new VideoPartUploadError("http", `${what} was refused (${status})`, status, partNumber);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new VideoPartUploadError("aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new VideoPartUploadError("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A progress callback that never reports less than it already has. */
export function highWater<A extends unknown[]>(report: ((value: number, ...rest: A) => void) | undefined): (value: number, ...rest: A) => void {
  let best = Number.NEGATIVE_INFINITY;
  return (value, ...rest) => {
    if (!report || !(value >= best)) return;
    best = value;
    report(value, ...rest);
  };
}

/**
 * PUT through XMLHttpRequest, reading the ETag header (null when CORS does not expose it). The
 * timeout slides: each progress event gives the request another `timeoutMs`, so a slow link is not
 * cut off while a stalled one is.
 */
export const xhrPut: PartPut = (url, body, { onProgress, signal, timeoutMs }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new VideoPartUploadError("aborted"));
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    xhr.onloadend = () => signal.removeEventListener("abort", onAbort);
    xhr.open("PUT", url);
    const startedAt = performance.now();
    xhr.timeout = timeoutMs;
    xhr.upload.onprogress = (e) => {
      xhr.timeout = Math.ceil(performance.now() - startedAt) + timeoutMs;
      if (e.lengthComputable) onProgress?.(e.loaded);
    };
    xhr.onload = () => resolve({ status: xhr.status, etag: xhr.getResponseHeader("ETag") });
    xhr.onerror = () => reject(new VideoPartUploadError("network", "The part upload failed on the network"));
    xhr.ontimeout = () => reject(new VideoPartUploadError("network", "The part upload timed out"));
    xhr.onabort = () => reject(new VideoPartUploadError("aborted"));
    xhr.send(body);
  });

/**
 * Uploads `blob` to the part URLs of a multipart ticket, `parallel` at a time, each retried with
 * exponential backoff on a 5xx/408/429, a network failure or a timeout, and returns the parts' ETags
 * in order for CompleteVideoUpload. A 403 fails at once with `forbidden`, another 4xx with `http`. A
 * part answered without a readable ETag fails with `etag-unavailable`: the bucket's CORS must list
 * ETag in Access-Control-Expose-Headers.
 */
export async function uploadVideoParts(blob: Blob, ticket: VideoUploadTicket, options: UploadPartsOptions = {}): Promise<UploadedPart[]> {
  const { parallel = 4, retries = 3, timeoutMs = PART_TIMEOUT_MS, put = xhrPut, backoffMs = defaultBackoff } = options;
  const ranges = partRanges(blob.size, Number(ticket.partSize));
  if (ranges.length !== ticket.partUrls.length) {
    throw new VideoPartUploadError("bad-ticket", `The ticket has ${ticket.partUrls.length} part URLs for ${ranges.length} parts`);
  }

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (options.signal?.aborted) throw new VideoPartUploadError("aborted");
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const loaded = new Array<number>(ranges.length).fill(0);
  const progress = highWater(options.onProgress);
  const report = () => progress(loaded.reduce((a, b) => a + b, 0), blob.size);

  async function uploadPart(index: number): Promise<UploadedPart> {
    const { partNumber, start, end } = ranges[index];
    const url = ticket.partUrls[index];
    // Untyped, so no Content-Type goes with it: the part URL signs the length and nothing else.
    const body = blob.slice(start, end);

    for (let attempt = 0; ; attempt++) {
      if (controller.signal.aborted) throw new VideoPartUploadError("aborted");
      let failure: VideoPartUploadError;
      try {
        const { status, etag } = await put(url, body, {
          signal: controller.signal,
          timeoutMs,
          onProgress: (bytes) => {
            loaded[index] = Math.min(bytes, end - start);
            report();
          },
        });
        if (status >= 200 && status < 300) {
          if (!etag) {
            throw new VideoPartUploadError(
              "etag-unavailable",
              `Part ${partNumber} was stored but its ETag header is not readable: the bucket's CORS must expose ETag (Access-Control-Expose-Headers: ETag)`,
              status,
              partNumber,
            );
          }
          loaded[index] = end - start;
          report();
          return { partNumber, etag: stripEtagQuotes(etag) };
        }
        failure = refusal(status, partNumber);
        if (!isRetryableStatus(status)) throw failure;
      } catch (e) {
        if (controller.signal.aborted) throw new VideoPartUploadError("aborted");
        if (e instanceof VideoPartUploadError && e.code !== "network") throw e;
        failure = e instanceof VideoPartUploadError ? e : new VideoPartUploadError("network", e instanceof Error ? e.message : String(e));
      }

      if (attempt >= retries) throw failure;
      loaded[index] = 0;
      await sleep(backoffMs(attempt), controller.signal);
    }
  }

  const results = new Array<UploadedPart>(ranges.length);
  let next = 0;
  const lane = async () => {
    while (next < ranges.length) {
      const index = next++;
      results[index] = await uploadPart(index);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(Math.max(1, parallel), ranges.length) }, lane));
    return results;
  } catch (e) {
    controller.abort();
    if (options.signal?.aborted) throw new VideoPartUploadError("aborted");
    throw e;
  } finally {
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export interface UploadSingleOptions {
  /** Never goes down, not even when the PUT is retried. */
  onProgress?: (bytesSent: number, total: number) => void;
  signal?: AbortSignal;
  /** Extra attempts after a 5xx/408/429, a network failure or a timeout. */
  retries?: number;
  backoffMs?: (attempt: number) => number;
}

/** The status of uploadFile's UploadHttpError (by name, so a mocked uploadFile module needs no class). */
function httpStatusOf(e: unknown): number | null {
  const { name, status } = (e ?? {}) as { name?: unknown; status?: unknown };
  return name === "UploadHttpError" && typeof status === "number" ? status : null;
}

/** A whole-file PUT may take this long: a minute plus the file at 256 kbit/s. */
export function singlePutTimeoutMs(bytes: number): number {
  return PART_TIMEOUT_MS + Math.ceil(bytes / 32_000) * 1000;
}

/**
 * The single-PUT ticket of an older server (no part URLs): the bytes go to `uploadUrl` with
 * `formFields` as headers, through the same uploadFile the attachments use. A 4xx is not retried.
 */
export async function uploadVideoSingle(blob: Blob, ticket: VideoUploadTicket, options: UploadSingleOptions = {}): Promise<void> {
  const { signal, retries = 2, backoffMs = defaultBackoff } = options;
  if (!ticket.uploadUrl) throw new VideoPartUploadError("bad-ticket", "The ticket has neither an upload URL nor part URLs");
  const begin = new SuccessUploadFile(ticket.fileId, ticket.uploadUrl, ticket.formFields, ticket.ttlSeconds);
  const sleepSignal = signal ?? new AbortController().signal;
  const progress = highWater(options.onProgress);

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new VideoPartUploadError("aborted");
    try {
      await uploadFile(begin, blob, "Video", {
        signal,
        timeout: singlePutTimeoutMs(blob.size),
        onProgress: (f) => progress(Math.round(f * blob.size), blob.size),
      });
      progress(blob.size, blob.size);
      return;
    } catch (e) {
      if (signal?.aborted) throw new VideoPartUploadError("aborted");
      const status = httpStatusOf(e);
      if (status !== null && !isRetryableStatus(status)) throw refusal(status);
      if (attempt >= retries) {
        throw status !== null ? refusal(status) : new VideoPartUploadError("network", e instanceof Error ? e.message : String(e));
      }
    }
    await sleep(backoffMs(attempt), sleepSignal);
  }
}
