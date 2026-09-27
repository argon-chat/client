// Feature probes for the Lottie renderer (ported from tweb's src/environment). Each one is a minimal
// module built from the opcodes it tests for; WebAssembly.validate compiles nothing and runs nothing.
// Lazy so importing this in a worker or a test does not probe anything.

const SIMD_TEST_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0xfd, 0x62, 0x0b,
]);

// bulk-memory (memory.copy), non-trapping float-to-int (i32.trunc_sat_f32_s) and sign-extension
// (i32.extend8_s): what both tlottie builds need. A browser failing this runs neither.
const BASELINE_TEST_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x0a, 0x16, 0x01, 0x14, 0x00, 0x41, 0x00, 0x41, 0x00, 0x41, 0x00, 0xfc, 0x0a, 0x00, 0x00,
  0x43, 0x00, 0x00, 0x00, 0x00, 0xfc, 0x00, 0xc0, 0x0b,
]);

function memo<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}

function isWasmFeatureSupported(module: Uint8Array<ArrayBuffer>): boolean {
  try {
    return typeof WebAssembly !== "undefined" && typeof WebAssembly.validate === "function" && WebAssembly.validate(module);
  } catch {
    return false;
  }
}

export const isWasmBaselineSupported = memo(() => isWasmFeatureSupported(BASELINE_TEST_MODULE));
export const isWasmSimdSupported = memo(() => isWasmFeatureSupported(SIMD_TEST_MODULE));

/** A canvas can hand its drawing to a worker, and the worker can draw 2D on it. */
export const isOffscreenCanvasSupported = memo(() => {
  try {
    if (typeof OffscreenCanvas === "undefined") return false;
    if (typeof HTMLCanvasElement !== "undefined" && !("transferControlToOffscreen" in HTMLCanvasElement.prototype))
      return false;
    return !!new OffscreenCanvas(1, 1).getContext("2d");
  } catch {
    return false;
  }
});

/**
 * Lottie can be rendered at all: wasm, a worker, ImageBitmap. OffscreenCanvas is optional — without
 * it the worker ships frames and the main thread draws them.
 */
export const isLottieSupported = memo(
  () =>
    isWasmBaselineSupported() &&
    typeof Worker !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof ImageData !== "undefined",
);
