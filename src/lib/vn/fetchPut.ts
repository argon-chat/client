/**
 * A PUT over fetch, for a runtime with no XMLHttpRequest (vue-native today; XHR with upload
 * progress is planned there). The uploads use XHR only for its upload progress, which fetch does not
 * report, so progress here is 0 when the request goes out and all of it once the storage answered:
 * a bar that waits, then fills, rather than one that never moves.
 * vue-native's research/reports/m26/client-gap.md §4, "uploads via fetch PUT if XHR is not done yet".
 */

/** Why no answer came. */
export type FetchPutFailure = "aborted" | "timeout" | "network";

export class FetchPutError extends Error {
  override name = "FetchPutError";
  constructor(
    readonly reason: FetchPutFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface FetchPutOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** No answer within this many milliseconds is a `timeout`; 0 or none waits as long as it takes. */
  timeoutMs?: number;
  /** Bytes sent of the body's size: 0 at the start, the size at the end. */
  onProgress?: (loaded: number, total: number) => void;
}

/** True where the uploads have to go over fetch. */
export const noXhr = () => typeof XMLHttpRequest === "undefined";

/** PUTs `body` and resolves with the storage's answer, whatever its status. */
export async function fetchPut(url: string, body: Blob, options: FetchPutOptions = {}): Promise<Response> {
  const { headers, signal, timeoutMs, onProgress } = options;
  if (signal?.aborted) throw new FetchPutError("aborted", "The upload was aborted");

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer =
    timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  onProgress?.(0, body.size);
  try {
    const response = await fetch(url, { method: "PUT", body, headers, signal: controller.signal });
    onProgress?.(body.size, body.size);
    return response;
  } catch (e) {
    if (timedOut) throw new FetchPutError("timeout", "The upload timed out");
    if (signal?.aborted) throw new FetchPutError("aborted", "The upload was aborted");
    throw new FetchPutError("network", e instanceof Error ? e.message : String(e));
  } finally {
    if (timer !== null) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
