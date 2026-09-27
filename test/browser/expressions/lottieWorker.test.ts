/**
 * The Lottie worker in a real browser: it instantiates the vendored tlottie wasm (both builds),
 * renders a tiny one-layer animation — as plain JSON and gzipped like a TGS — and puts pixels on a
 * canvas handed to it, or posts frames back when it has none.
 */

import { describe, test, expect, afterEach } from "vitest";
import LottieWorker from "@/workers/lottie.worker?worker";
import simdUrl from "@/vendor/tlottie/tlottie.wasm?url";
import noSimdUrl from "@/vendor/tlottie/tlottie.nosimd.wasm?url";
import { tlottieWasmUrl } from "@/lib/expressions/lottie/tlottieWasm";
import { LottiePool } from "@/lib/expressions/lottie/LottiePool";
import { AnimationIntersector } from "@/lib/expressions/animationIntersector";
import type { LottieFromWorker, LottieLoadMessage, LottieToWorker } from "@/lib/expressions/lottie/protocol";
import fixture from "../fixtures/tiny-lottie.json?raw";

const SIZE = 100;
const workers: Worker[] = [];

function start(wasmUrl = tlottieWasmUrl()) {
  const worker = new LottieWorker();
  workers.push(worker);
  const messages: LottieFromWorker[] = [];
  const waiters: { predicate: (m: LottieFromWorker) => boolean; resolve: (m: LottieFromWorker) => void }[] = [];
  worker.addEventListener("message", (event: MessageEvent<LottieFromWorker>) => {
    messages.push(event.data);
    for (const w of [...waiters]) {
      if (w.predicate(event.data)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(event.data);
      }
    }
  });
  const post = (msg: LottieToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
  post({ type: "init", wasmUrl: new URL(wasmUrl, location.href).href });

  const next = <T extends LottieFromWorker["type"]>(type: T, timeout = 10_000) =>
    new Promise<Extract<LottieFromWorker, { type: T }>>((resolve, reject) => {
      const seen = messages.find((m) => m.type === type || m.type === "error");
      if (seen) return seen.type === "error" ? reject(new Error((seen as any).message)) : resolve(seen as any);
      const timer = setTimeout(() => reject(new Error(`no ${type} within ${timeout} ms`)), timeout);
      waiters.push({
        predicate: (m) => m.type === type || m.type === "error",
        resolve: (m) => {
          clearTimeout(timer);
          if (m.type === "error") reject(new Error(m.message));
          else resolve(m as any);
        },
      });
    });

  return { worker, post, messages, next };
}

function load(overrides: Partial<LottieLoadMessage> = {}): LottieLoadMessage {
  return {
    type: "load",
    playerId: 1,
    fileId: "tiny",
    bytes: new TextEncoder().encode(fixture).buffer as ArrayBuffer,
    width: SIZE,
    height: SIZE,
    ...overrides,
  };
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const source = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(source).arrayBuffer();
}

/** RGBA of the pixel at (x, y) of anything drawable. */
function pixels(source: CanvasImageSource, width = SIZE, height = SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  return {
    at: (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)),
    opaque: () => {
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
      return n;
    },
  };
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

afterEach(() => {
  for (const w of workers.splice(0)) w.terminate();
});

describe("lottie worker", () => {
  test("renders the first frame of a plain Lottie JSON", async () => {
    const { post, next } = start();
    post(load({ wantFirstFrame: true }));
    const { bitmap } = await next("firstFrame");
    const loaded = await next("loaded");

    expect(loaded.frameCount).toBe(30);
    expect(loaded.fps).toBe(30);
    expect([bitmap.width, bitmap.height]).toEqual([SIZE, SIZE]);
    const p = pixels(bitmap);
    expect(p.at(50, 50)).toEqual([255, 0, 0, 255]); // the red square's centre
    expect(p.at(2, 2)[3]).toBe(0); // outside it
    expect(p.opaque()).toBeGreaterThan(30 * 30);
  });

  test("gunzips a TGS", async () => {
    const { post, next } = start();
    post(load({ bytes: await gzip(fixture), wantFirstFrame: true }));
    const { bitmap } = await next("firstFrame");
    expect(pixels(bitmap).at(50, 50)).toEqual([255, 0, 0, 255]);
  });

  test("both wasm builds render the same frame", async () => {
    const renders: number[][] = [];
    for (const url of [simdUrl, noSimdUrl]) {
      const { post, next } = start(url);
      post(load({ wantFirstFrame: true }));
      const { bitmap } = await next("firstFrame");
      const p = pixels(bitmap);
      renders.push([...p.at(50, 50), ...p.at(22, 22), ...p.at(79, 50), p.opaque()]);
    }
    expect(renders[0]).toEqual(renders[1]);
  });

  test("presents on a canvas handed over to it", async () => {
    const canvas = document.createElement("canvas");
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    document.body.appendChild(canvas);
    try {
      const offscreen = canvas.transferControlToOffscreen();
      const { post, next } = start();
      post(load({ canvas: offscreen }), [offscreen]);
      await next("loaded");
      for (let i = 0; i < 4; i++) await frame();

      expect([canvas.width, canvas.height]).toEqual([SIZE, SIZE]);
      const p = pixels(canvas);
      expect(p.at(50, 50)).toEqual([255, 0, 0, 255]);
      expect(p.opaque()).toBeGreaterThan(30 * 30);
    } finally {
      canvas.remove();
    }
  });

  test("tints with a text colour", async () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    try {
      const offscreen = canvas.transferControlToOffscreen();
      const { post, next } = start();
      post(load({ canvas: offscreen, textColor: "rgb(0, 0, 255)" }), [offscreen]);
      await next("loaded");
      for (let i = 0; i < 4; i++) await frame();
      const p = pixels(canvas);
      expect(p.at(50, 50)).toEqual([0, 0, 255, 255]);
      expect(p.at(2, 2)[3]).toBe(0);
    } finally {
      canvas.remove();
    }
  });

  test("without a canvas it plays by posting frames, one per ack", async () => {
    const { post, next, messages } = start();
    post(load({ playerId: 7 }));
    await next("loaded");
    post({ type: "play", playerId: 7 });

    const seen: number[] = [];
    const deadline = performance.now() + 2000;
    let acked = 0;
    while (seen.length < 5 && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      const frames = messages.filter((m) => m.type === "frame" && m.requestId === undefined) as Extract<
        LottieFromWorker,
        { type: "frame" }
      >[];
      for (const f of frames.slice(acked)) {
        seen.push(f.frameNo);
        f.bitmap.close();
        post({ type: "ack", playerId: 7 });
      }
      acked = frames.length;
    }
    post({ type: "pause", playerId: 7 });

    expect(seen[0]).toBe(0); // the first frame, sent on load
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(new Set(seen).size).toBeGreaterThan(2); // it moves
  });

  test("renderFrame replies with that frame", async () => {
    const { post, next, messages } = start();
    post(load());
    await next("loaded");
    post({ type: "renderFrame", playerId: 1, frameNo: 15, requestId: 3 });
    const deadline = performance.now() + 5000;
    let reply: Extract<LottieFromWorker, { type: "frame" }> | undefined;
    while (!reply && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      reply = messages.find((m) => m.type === "frame" && m.requestId === 3) as any;
    }
    expect(reply?.frameNo).toBe(15);
    // Half way the square is turned 45°: its corner is out at the edge where frame 0 had nothing.
    const p = pixels(reply!.bitmap);
    expect(p.at(50, 50)).toEqual([255, 0, 0, 255]);
    expect(p.at(50, 12)[3]).toBeGreaterThan(0);
  });

  test("without OffscreenCanvas the pool draws the worker's frames on the page", async () => {
    const intersector = new AnimationIntersector();
    const pool = new LottiePool({ workerCount: 1, offscreenCanvas: false, intersector });
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    try {
      const handle = pool.createPlayer({
        canvas,
        fileId: "draw-mode",
        load: async () => new TextEncoder().encode(fixture).buffer as ArrayBuffer,
        width: 50,
        height: 50,
        pixelRatio: 1,
        textColor: "rgb(0, 0, 255)",
      });
      await handle.ready;
      expect([canvas.width, canvas.height]).toEqual([50, 50]);
      expect(pixels(canvas, 50, 50).at(25, 25)).toEqual([0, 0, 255, 255]);
    } finally {
      pool.terminate();
      intersector.destroy();
      canvas.remove();
    }
  });

  test("refuses JSON past the 8 MiB cap", async () => {
    const { post, next } = start();
    post(load({ bytes: new ArrayBuffer(8 * 1024 * 1024 + 1) }));
    await expect(next("loaded")).rejects.toThrow(/exceeds/);
  });

  test("reports a file that is not Lottie", async () => {
    const { post, next } = start();
    post(load({ bytes: new TextEncoder().encode('{"hello":"world"}').buffer as ArrayBuffer }));
    await expect(next("loaded")).rejects.toThrow();
  });
});
