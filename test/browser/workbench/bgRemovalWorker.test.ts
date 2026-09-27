/**
 * Background removal for real: the worker loads onnxruntime-web's wasm runtime and the vendored
 * U²-Netp model (public/models), keeps the model in IndexedDB, and finds the obvious subject of a
 * synthetic picture — a red disc on a grey background.
 *
 * Skipped when the model is not served (a checkout without public/models/u2netp.onnx). The WebGPU
 * run needs an adapter: set ARGON_TEST_GPU=1.
 */

import { describe, test, expect, afterEach } from "vitest";
import BgRemovalWorker from "@/lib/expressions/workbench/bgRemoval.worker?worker";
import type { BgRemovalBackend, BgRemovalEvent, BgRemovalRequest } from "@/lib/expressions/workbench/bgRemovalProtocol";
import { BG_MODEL } from "@/lib/expressions/workbench/model";

const modelServed = await fetch(BG_MODEL.path, { method: "HEAD" })
  .then((r) => r.ok)
  .catch(() => false);
const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const jspi = typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending === "function";

const workers: Worker[] = [];
afterEach(() => {
  for (const w of workers.splice(0)) w.terminate();
});

async function subject(): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(400, 300);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(214, 214, 210)";
  ctx.fillRect(0, 0, 400, 300);
  const g = ctx.createRadialGradient(180, 130, 10, 200, 150, 95);
  g.addColorStop(0, "rgb(255, 90, 60)");
  g.addColorStop(1, "rgb(200, 20, 20)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(200, 150, 90, 0, Math.PI * 2);
  ctx.fill();
  return createImageBitmap(canvas);
}

function run(worker: Worker, request: Omit<BgRemovalRequest, "type" | "id" | "image">, image: ImageBitmap) {
  const id = Math.floor(Math.random() * 1e9);
  const progress: number[] = [];
  const done = new Promise<Extract<BgRemovalEvent, { type: "result" }>>((resolve, reject) => {
    worker.addEventListener("message", (e: MessageEvent<BgRemovalEvent>) => {
      const event = e.data;
      if (event.id !== id) return;
      if (event.type === "progress") progress.push(event.value);
      else if (event.type === "result") resolve(event);
      else reject(new Error(event.message));
    });
    worker.addEventListener("error", (e) => reject(new Error(e.message)));
  });
  worker.postMessage({ type: "segment", id, image, ...request } satisfies BgRemovalRequest, [image]);
  return { done, progress };
}

function start(): Worker {
  const worker = new BgRemovalWorker();
  workers.push(worker);
  return worker;
}

/** The disc (centre (200, 150), radius 90 in the 400×300 picture) is kept, the background is not. */
function expectDisc(mask: Uint8Array, width: number, height: number) {
  const k = width / 400;
  const v = (x: number, y: number) => mask[Math.round(y * k) * width + Math.round(x * k)];
  expect(v(200, 150)).toBeGreaterThan(200);
  expect(v(260, 110)).toBeGreaterThan(200);
  expect(v(140, 200)).toBeGreaterThan(200);
  for (const [x, y] of [[10, 10], [390, 10], [10, 290], [390, 290], [200, 20], [340, 150]]) expect(v(x, y)).toBeLessThan(40);
  // Roughly the disc's share of the picture: π·90² / (400·300) ≈ 21 %.
  let sum = 0;
  for (const b of mask) sum += b;
  const coverage = sum / 255 / mask.length;
  expect(coverage).toBeGreaterThan(0.15);
  expect(coverage).toBeLessThan(0.28);
}

describe.skipIf(!modelServed)(`background removal worker${modelServed ? "" : " — skipped: public/models/u2netp.onnx is not served"}`, () => {
  test("wasm runtime: finds the subject, reports progress, keeps the model for next time", async () => {
    const first = run(start(), { width: 200, height: 150, backend: "wasm" as BgRemovalBackend }, await subject());
    const result = await first.done;
    expect(result).toMatchObject({ width: 200, height: 150, backend: "wasm", model: "network" });
    expect(result.mask.length).toBe(200 * 150);
    expectDisc(result.mask, 200, 150);
    expect(first.progress.length).toBeGreaterThan(3);
    for (let i = 1; i < first.progress.length; i++) expect(first.progress[i]).toBeGreaterThanOrEqual(first.progress[i - 1] - 1e-9);

    // A new worker (the editor reopened) reads the model from IndexedDB.
    const second = run(start(), { width: 100, height: 75, backend: "wasm" }, await subject());
    const again = await second.done;
    expect(again.model).toBe("cache");
    expectDisc(again.mask, 100, 75);
  }, 120_000);

  test.skipIf(!adapter || !jspi)(`WebGPU runtime${adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)"}`, async () => {
    const { done } = run(start(), { width: 200, height: 150 }, await subject());
    const result = await done;
    expect(result.backend).toBe("webgpu");
    expectDisc(result.mask, 200, 150);
  }, 120_000);
});
