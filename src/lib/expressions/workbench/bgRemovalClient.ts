import type { BackgroundRemovalInput, BackgroundRemovalOptions, MaskRaster } from "@argon/media-editor";
import type { BgRemovalBackend, BgRemovalEvent, BgRemovalRequest } from "./bgRemovalProtocol";

export interface BackgroundRemovalClient {
  /** The editor's `BackgroundRemover`. */
  remove(input: BackgroundRemovalInput, options?: BackgroundRemovalOptions): Promise<MaskRaster>;
  /** Stops the worker and frees the runtime; the next call starts a new one. */
  dispose(): void;
  /** The runtime the last result came from. */
  readonly lastBackend: BgRemovalBackend | null;
}

interface Pending {
  resolve(mask: MaskRaster): void;
  reject(error: unknown): void;
  onProgress?: (value: number) => void;
}

const abortError = () => new DOMException("Background removal was cancelled", "AbortError");

function defaultWorker(): Worker {
  return new Worker(new URL("./bgRemoval.worker.ts", import.meta.url), { type: "module", name: "bg-removal" });
}

/**
 * Runs background removal in a dedicated worker. Cancelling terminates the worker (onnxruntime
 * cannot stop a run halfway); the model stays cached in IndexedDB for the next one.
 */
export function createBackgroundRemovalClient(
  options: { createWorker?: () => Worker; backend?: BgRemovalBackend; feather?: number } = {},
): BackgroundRemovalClient {
  const createWorker = options.createWorker ?? defaultWorker;
  let worker: Worker | null = null;
  let seq = 0;
  const pending = new Map<number, Pending>();
  let lastBackend: BgRemovalBackend | null = null;

  function failAll(error: unknown) {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  }

  function stop(error: unknown) {
    worker?.terminate();
    worker = null;
    failAll(error);
  }

  function ensureWorker(): Worker {
    if (worker) return worker;
    const w = createWorker();
    w.onmessage = (e: MessageEvent<BgRemovalEvent>) => {
      const event = e.data;
      const p = pending.get(event.id);
      if (!p) return;
      if (event.type === "progress") {
        p.onProgress?.(event.value);
        return;
      }
      pending.delete(event.id);
      if (event.type === "result") {
        lastBackend = event.backend;
        p.resolve({ width: event.width, height: event.height, data: event.mask });
      } else {
        p.reject(new Error(event.message));
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      stop(new Error(e.message || "The background removal worker failed"));
    };
    worker = w;
    return w;
  }

  function remove(input: BackgroundRemovalInput, opts: BackgroundRemovalOptions = {}): Promise<MaskRaster> {
    const { signal } = opts;
    if (signal?.aborted) return Promise.reject(abortError());
    const id = ++seq;
    return new Promise<MaskRaster>((resolve, reject) => {
      const onAbort = () => {
        if (!pending.has(id)) return;
        stop(abortError());
      };
      const settle = <T>(fn: (v: T) => void) => (v: T) => {
        signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      pending.set(id, { resolve: settle(resolve), reject: settle(reject), onProgress: opts.onProgress });
      signal?.addEventListener("abort", onAbort, { once: true });

      const request: BgRemovalRequest = {
        type: "segment",
        id,
        image: input.image,
        width: input.width,
        height: input.height,
        feather: options.feather,
        backend: options.backend,
      };
      try {
        ensureWorker().postMessage(request, [input.image]);
      } catch (e) {
        pending.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      }
    });
  }

  return {
    remove,
    dispose: () => stop(abortError()),
    get lastBackend() {
      return lastBackend;
    },
  };
}
