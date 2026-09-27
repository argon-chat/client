// JS binding for the vendored tlottie renderer (src/vendor/tlottie, MIT). Ported from tweb's
// src/lib/lottie/tlottieWasm.ts.
import tlottieSimdUrl from "@/vendor/tlottie/tlottie.wasm?url";
import tlottieNoSimdUrl from "@/vendor/tlottie/tlottie.nosimd.wasm?url";
import { isWasmSimdSupported } from "./support";

export type TLottieHandle = number;
/** Skin tone modifier: 0 = none, 1..5 = Fitzpatrick types. */
export type TLottieFitzModifier = 0 | 1 | 2 | 3 | 4 | 5;

type TLottieExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  tlottie_alloc: (length: number) => number;
  tlottie_free: (pointer: number, length: number) => void;
  tlottie_new_with_options: (
    pointer: number,
    length: number,
    fitzModifier: TLottieFitzModifier,
    replacementsPointer: number,
    replacementsLength: number,
  ) => TLottieHandle;
  tlottie_drop: (handle: TLottieHandle) => void;
  tlottie_width: (handle: TLottieHandle) => number;
  tlottie_height: (handle: TLottieHandle) => number;
  tlottie_frame_rate: (handle: TLottieHandle) => number;
  tlottie_frame_count: (handle: TLottieHandle) => number;
  tlottie_render: (handle: TLottieHandle, frame: number, width: number, height: number, antialias: number) => number;
};

export interface TLottieAnimation {
  handle: TLottieHandle;
  width: number;
  height: number;
  frameRate: number;
  frameCount: number;
}

/** The wasm build for this browser, as a URL the worker can fetch. */
export function tlottieWasmUrl(): string {
  const url = isWasmSimdSupported() ? tlottieSimdUrl : tlottieNoSimdUrl;
  const base = typeof location !== "undefined" ? location.href : undefined;
  return base ? new URL(url, base).href : url;
}

// Upstream collapses proven-static compositions to one render frame; keep the authored duration so
// loop timing and "ended" still follow the file.
function authoredFrameCount(json: string, frameCount: number): number {
  if (frameCount !== 1) return frameCount;
  try {
    const data = JSON.parse(json);
    if (typeof data?.ip !== "number" || typeof data?.op !== "number") return frameCount;
    const n = Math.floor(Math.fround(data.op) - Math.fround(data.ip));
    if (Number.isNaN(n)) return frameCount;
    return Math.min(0xffffffff, Math.max(1, n));
  } catch {
    return frameCount;
  }
}

async function instantiate(wasmUrl: string): Promise<WebAssembly.Instance> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Failed to load tlottie WebAssembly: ${response.status}`);

  if (typeof WebAssembly.instantiateStreaming === "function") {
    try {
      return (await WebAssembly.instantiateStreaming(response.clone(), {})).instance;
    } catch (err) {
      if (err instanceof WebAssembly.CompileError) throw err;
      // A server that does not send application/wasm: compile the same bytes the slow way.
    }
  }

  return (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance;
}

export class TLottieWasm {
  private readonly encoder = new TextEncoder();
  private readonly staticAnimations = new Set<TLottieHandle>();

  private constructor(private readonly exports: TLottieExports) {}

  static async create(wasmUrl: string): Promise<TLottieWasm> {
    const instance = await instantiate(wasmUrl);
    return new TLottieWasm(instance.exports as TLottieExports);
  }

  /** The wasm heap only grows: this is the high-water mark of everything decoded at once. */
  get heapBytes(): number {
    return this.exports.memory.buffer.byteLength;
  }

  createAnimation(json: string, fitzModifier: TLottieFitzModifier = 0): TLottieAnimation {
    if (!Number.isInteger(fitzModifier) || fitzModifier < 0 || fitzModifier > 5)
      throw new RangeError(`Invalid tlottie Fitz modifier: ${fitzModifier}`);

    const bytes = this.encoder.encode(json);
    const pointer = this.exports.tlottie_alloc(bytes.length);
    if (!pointer) throw new Error("tlottie input allocation failed");

    let handle: TLottieHandle;
    try {
      new Uint8Array(this.exports.memory.buffer, pointer, bytes.length).set(bytes);
      handle = this.exports.tlottie_new_with_options(pointer, bytes.length, fitzModifier, 0, 0);
    } finally {
      this.exports.tlottie_free(pointer, bytes.length);
    }

    if (!handle) throw new Error("tlottie rejected the animation");

    const rendererFrameCount = this.exports.tlottie_frame_count(handle);
    const frameCount = authoredFrameCount(json, rendererFrameCount);
    if (rendererFrameCount === 1 && frameCount > 1) this.staticAnimations.add(handle);

    return {
      handle,
      width: this.exports.tlottie_width(handle),
      height: this.exports.tlottie_height(handle),
      frameRate: this.exports.tlottie_frame_rate(handle),
      frameCount,
    };
  }

  destroyAnimation(handle: TLottieHandle): void {
    this.staticAnimations.delete(handle);
    this.exports.tlottie_drop(handle);
  }

  /**
   * Renders one frame and returns a view of the RGBA pixels (straight alpha) in wasm memory. The
   * view is only valid until the next call into the module: copy it out at once.
   */
  render(handle: TLottieHandle, frame: number, width: number, height: number): Uint8Array {
    const rendererFrame = this.staticAnimations.has(handle) ? 0 : frame;
    const pointer = this.exports.tlottie_render(handle, rendererFrame, width, height, 1);
    if (!pointer) throw new Error("tlottie frame render failed");
    // tlottie_render can grow memory, so the view is taken after the call.
    return new Uint8Array(this.exports.memory.buffer, pointer, width * height * 4);
  }
}

const instances = new Map<string, Promise<TLottieWasm>>();

/** One instance per URL per thread; a failed load is forgotten so the next call retries. */
export function loadTLottieWasm(wasmUrl: string): Promise<TLottieWasm> {
  let promise = instances.get(wasmUrl);
  if (!promise) {
    promise = TLottieWasm.create(wasmUrl);
    instances.set(wasmUrl, promise);
    promise.catch(() => {
      if (instances.get(wasmUrl) === promise) instances.delete(wasmUrl);
    });
  }
  return promise;
}
