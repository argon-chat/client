import { featherMask } from "@argon/media-editor/mask";
import { BG_MODEL } from "./model";

// Everything around the model that is plain arithmetic: squeeze the image to the model's input,
// normalise it, and turn the saliency map back into a mask at the size the editor asked for. The
// session is injected, so this runs (and is tested) without onnxruntime.

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** What the worker's ONNX session is reduced to. */
export interface SaliencySession {
  run(input: Float32Array, dims: readonly [number, number, number, number]): Promise<{ data: Float32Array; dims: readonly number[] }>;
}

/** Box average when shrinking both ways, bilinear otherwise. */
export function resampleRgba(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  if (sw === dw && sh === dh) {
    out.set(src.subarray(0, out.length));
    return out;
  }
  const kx = sw / dw;
  const ky = sh / dh;

  if (kx >= 1 && ky >= 1) {
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * ky);
      const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * ky)));
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * kx);
        const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * kx)));
        const n = (y1 - y0) * (x1 - x0);
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const at = (yy * sw + xx) * 4;
            r += src[at];
            g += src[at + 1];
            b += src[at + 2];
            a += src[at + 3];
          }
        }
        const o = (y * dw + x) * 4;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = Math.round(a / n);
      }
    }
    return out;
  }

  for (let y = 0; y < dh; y++) {
    const sy = Math.max(0, Math.min(sh - 1, (y + 0.5) * ky - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.max(0, Math.min(sw - 1, (x + 0.5) * kx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c];
        const p10 = src[(y0 * sw + x1) * 4 + c];
        const p01 = src[(y1 * sw + x0) * 4 + c];
        const p11 = src[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[o + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return out;
}

/**
 * NCHW float32 for the model: RGB scaled by the image's own brightest value, then standardised
 * with the ImageNet mean and deviation. Alpha is ignored, as the model was trained on RGB.
 */
export function toModelInput(rgba: Uint8ClampedArray, size: number, mean: readonly number[] = BG_MODEL.mean, std: readonly number[] = BG_MODEL.std): Float32Array {
  const plane = size * size;
  let max = 0;
  for (let i = 0; i < plane; i++) {
    const at = i * 4;
    max = Math.max(max, rgba[at], rgba[at + 1], rgba[at + 2]);
  }
  const scale = 1 / Math.max(max, 1e-6);
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    const at = i * 4;
    out[i] = (rgba[at] * scale - mean[0]) / std[0];
    out[plane + i] = (rgba[at + 1] * scale - mean[1]) / std[1];
    out[2 * plane + i] = (rgba[at + 2] * scale - mean[2]) / std[2];
  }
  return out;
}

/** Stretches the saliency map to 0–1 (the model's output is not calibrated). */
export function normalizeSaliency(data: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Float32Array(data.length);
  const range = max - min;
  if (!(range > 1e-12)) return out.fill(min > 0.5 ? 1 : 0);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] - min) / range;
  return out;
}

/** Bilinear, pixel centres aligned (as image resizers do, not "align corners"). */
export function upsampleBilinear(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const kx = sw / dw;
  const ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.max(0, Math.min(sh - 1, (y + 0.5) * ky - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.max(0, Math.min(sw - 1, (x + 0.5) * kx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const top = src[y0 * sw + x0] + (src[y0 * sw + x1] - src[y0 * sw + x0]) * fx;
      const bottom = src[y1 * sw + x0] + (src[y1 * sw + x1] - src[y1 * sw + x0]) * fx;
      out[y * dw + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

export function toMaskBytes(prob: Float32Array): Uint8Array {
  const out = new Uint8Array(prob.length);
  for (let i = 0; i < prob.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, prob[i])) * 255);
  return out;
}

export interface SegmentOptions {
  /** Edge softening in output pixels. */
  feather?: number;
  onProgress?: (stage: "prepare" | "infer" | "finish") => void;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Background removal was cancelled", "AbortError");
}

/** Image in, one-byte-per-pixel mask of `width × height` out. */
export async function segment(
  session: SaliencySession,
  image: RgbaImage,
  width: number,
  height: number,
  options: SegmentOptions = {},
): Promise<Uint8Array> {
  const size = BG_MODEL.inputSize;
  options.onProgress?.("prepare");
  const squeezed = resampleRgba(image.data, image.width, image.height, size, size);
  const input = toModelInput(squeezed, size);
  throwIfAborted(options.signal);

  options.onProgress?.("infer");
  const output = await session.run(input, [1, 3, size, size]);
  throwIfAborted(options.signal);

  options.onProgress?.("finish");
  const [oh, ow] = output.dims.slice(-2);
  if (!oh || !ow || output.data.length < oh * ow) throw new Error(`Unexpected model output ${output.dims.join("×")}`);
  const saliency = normalizeSaliency(output.data.subarray(0, oh * ow));
  let mask = toMaskBytes(upsampleBilinear(saliency, ow, oh, width, height));
  if (options.feather && options.feather > 0) mask = featherMask(mask, width, height, options.feather);
  return mask;
}
