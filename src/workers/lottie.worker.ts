// Lottie renderer worker: one tlottie wasm instance, a frame cache shared by its players, and a
// self-clocked playback loop per player. Mechanisms ported from tweb's tlottie.worker.ts.
//
// A player loaded with a canvas (an OffscreenCanvas transferred from the page) is presented here.
// One loaded without a canvas gets its frames posted back as ImageBitmaps, one at a time: the next is
// only sent after the page acks the previous one, so a busy page skips frames instead of queueing.

import { loadTLottieWasm, type TLottieFitzModifier, type TLottieWasm } from "@/lib/expressions/lottie/tlottieWasm";
import { FrameCache, type FrameCacheEntry } from "@/lib/expressions/lottie/frameCache";
import { decodeLottieBytes } from "@/lib/expressions/lottie/decode";
import { paintFrameTinted } from "@/lib/expressions/tint";
import type { LottieFromWorker, LottieLoadMessage, LottieToWorker } from "@/lib/expressions/lottie/protocol";

interface WorkerScope {
  postMessage(message: LottieFromWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<LottieToWorker>) => void): void;
}

const scope = self as unknown as WorkerScope;

let wasmUrl: string | null = null;
const cache = new FrameCache<ImageBitmap>((frame) => frame.width * frame.height * 4);
const items = new Map<number, Item>();

function post(message: LottieFromWorker, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

class DestroyedError extends Error {
  constructor() {
    super("player destroyed");
  }
}

interface Rendered {
  bitmap: ImageBitmap;
  /** Owned by the cache: copy it before transferring, never close it. */
  cached: boolean;
}

class Item {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  private readonly tone: TLottieFitzModifier;
  private readonly cachingDelta: number;
  private readonly skipRatio: number | undefined;
  private readonly wantFirstFrame: boolean;
  private readonly ctx: OffscreenCanvasRenderingContext2D | null;
  private color: string | null;
  private loop: boolean;

  private wasm: TLottieWasm | null = null;
  private handle: number | undefined;
  private imageData: ImageData | null = null;
  private entry: FrameCacheEntry<ImageBitmap> | null = null;

  frameCount = 1;
  fps = 60;
  private skipDelta = 1;
  private frInterval = 1000 / 60;
  private curFrame = 0;

  private playing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private frThen = 0;
  private awaitingAck = false;
  /** Loaded and its first frame shown; play/seek/colour before that are remembered, not run. */
  private ready = false;
  dead = false;

  constructor(msg: LottieLoadMessage) {
    this.id = msg.playerId;
    this.width = Math.max(1, Math.round(msg.width));
    this.height = Math.max(1, Math.round(msg.height));
    const tone = msg.toneIndex ?? 0;
    this.tone = (Number.isInteger(tone) && tone >= 1 && tone <= 5 ? tone : 0) as TLottieFitzModifier;
    this.cachingDelta = msg.cachingDelta ?? 0;
    this.skipRatio = msg.skipRatio;
    this.wantFirstFrame = !!msg.wantFirstFrame;
    this.color = msg.textColor ?? null;
    this.loop = msg.loop ?? true;

    const canvas = msg.canvas ?? null;
    if (canvas) {
      if (canvas.width !== this.width) canvas.width = this.width;
      if (canvas.height !== this.height) canvas.height = this.height;
      this.ctx = canvas.getContext("2d");
    } else {
      this.ctx = null;
    }

    if (this.cachingDelta) {
      this.entry = cache.acquire(`${msg.fileId}-${this.width}-${this.height}-${this.tone}`, this.id);
    }
  }

  get delivers(): boolean {
    return !this.ctx;
  }

  init(json: string, wasm: TLottieWasm) {
    const animation = wasm.createAnimation(json, this.tone);
    this.wasm = wasm;
    this.handle = animation.handle;
    this.frameCount = Math.max(1, animation.frameCount);
    this.fps = Math.max(1, Math.min(60, animation.frameRate || 60));

    // Every other frame of a 60 fps file; a 30 fps one is already at that rate.
    let skipDelta = this.skipRatio ? (1 / this.skipRatio) | 0 : 1;
    if (this.fps < 60 && skipDelta !== 1) skipDelta = (skipDelta / (60 / this.fps)) | 0;
    this.skipDelta = Math.max(1, skipDelta);
    this.frInterval = (1000 / this.fps) * this.skipDelta;
    this.imageData = new ImageData(this.width, this.height);
  }

  private get lastFrame() {
    return this.frameCount - 1;
  }

  async render(frameNo: number): Promise<Rendered> {
    if (this.dead) throw new DestroyedError();
    if (!this.wasm || this.handle === undefined || !this.imageData) throw new Error("player not loaded");
    frameNo = Math.max(0, Math.min(this.lastFrame, frameNo | 0));

    const entry = this.entry;
    const hit = entry && cache.get(entry, frameNo);
    if (hit) return { bitmap: hit, cached: true };

    this.imageData.data.set(this.wasm.render(this.handle, frameNo, this.width, this.height));
    const bitmap = await createImageBitmap(this.imageData);
    if (this.dead) {
      bitmap.close();
      throw new DestroyedError();
    }

    // tweb's rule: cachingDelta Infinity caches every frame, n caches all but every n-th.
    const cacheable = !!entry && !!this.cachingDelta && (frameNo % this.cachingDelta !== 0 || frameNo === 0);
    if (cacheable && cache.put(entry!, frameNo, bitmap)) return { bitmap, cached: true };
    return { bitmap, cached: false };
  }

  private paint(bitmap: ImageBitmap) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    paintFrameTinted(ctx, bitmap, this.color);
  }

  /** A bitmap that can be transferred: the frame itself when nothing else holds it, else a copy. */
  private async transferable(frame: Rendered, keepOriginal: boolean): Promise<ImageBitmap> {
    return frame.cached || keepOriginal ? createImageBitmap(frame.bitmap) : frame.bitmap;
  }

  /** Presents (canvas) or delivers (no canvas) one frame. */
  private async show(frameNo: number) {
    const frame = await this.render(frameNo);
    this.curFrame = frameNo;
    if (this.ctx) {
      this.paint(frame.bitmap);
      if (!frame.cached) frame.bitmap.close();
      return;
    }
    const bitmap = await this.transferable(frame, false);
    if (this.dead) {
      bitmap.close();
      return;
    }
    this.awaitingAck = true;
    post({ type: "frame", playerId: this.id, frameNo, bitmap }, [bitmap]);
  }

  async showFirstFrame() {
    const frame = await this.render(0);
    this.curFrame = 0;
    this.paint(frame.bitmap);

    if (this.wantFirstFrame) {
      const copy = await createImageBitmap(frame.bitmap);
      if (!this.dead) post({ type: "firstFrame", playerId: this.id, bitmap: copy }, [copy]);
      else copy.close();
    }

    if (this.delivers && !this.dead) {
      const bitmap = await this.transferable(frame, false);
      this.awaitingAck = true;
      post({ type: "frame", playerId: this.id, frameNo: 0, bitmap }, [bitmap]);
    } else if (!frame.cached) {
      frame.bitmap.close();
    }
  }

  async renderFrameFor(requestId: number, frameNo: number) {
    const frame = await this.render(frameNo);
    this.curFrame = Math.max(0, Math.min(this.lastFrame, frameNo | 0));
    this.paint(frame.bitmap);
    const bitmap = await this.transferable(frame, false);
    if (this.dead) {
      bitmap.close();
      return;
    }
    post({ type: "frame", playerId: this.id, frameNo: this.curFrame, bitmap, requestId }, [bitmap]);
  }

  ack() {
    this.awaitingAck = false;
  }

  setLoop(loop: boolean) {
    this.loop = loop;
  }

  setColor(color: string | null) {
    this.color = color;
    if (this.ready && this.ctx && !this.playing) void this.show(this.curFrame).catch(() => {});
  }

  seek(frameNo: number) {
    if (!this.ready) return;
    this.curFrame = Math.max(0, Math.min(this.lastFrame, frameNo | 0));
    void this.show(this.curFrame).catch(() => {});
  }

  play() {
    if (this.playing || this.dead) return;
    this.playing = true;
    this.frThen = Date.now();
    this.arm();
  }

  markReady() {
    this.ready = true;
    if (this.playing) {
      this.frThen = Date.now();
      this.arm();
    }
  }

  pause() {
    this.playing = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  // Deadline-corrected cadence: the next tick is one interval after the previous deadline, or now
  // when that is already past (no catch-up burst after a stall).
  private arm() {
    if (!this.playing || !this.ready || this.timer !== undefined) return;
    const now = Date.now();
    this.frThen = Math.max(now, this.frThen + this.frInterval);
    this.timer = setTimeout(this.tick, this.frThen - now);
  }

  private tick = async () => {
    this.timer = undefined;
    if (!this.playing || this.dead) return;

    const max = this.lastFrame;
    let next = this.curFrame + this.skipDelta;
    if (next > max) next = this.loop ? 0 : max;
    const ended = !this.loop && next + this.skipDelta > max;

    try {
      if (this.delivers && this.awaitingAck && !ended) {
        this.curFrame = next; // the page is behind: keep time, skip the frame
      } else {
        await this.show(next);
      }
    } catch (err) {
      if (err instanceof DestroyedError || this.dead) return;
      this.pause();
      post({ type: "error", playerId: this.id, message: String((err as Error)?.message ?? err) });
      return;
    }

    if (!this.playing || this.dead) return;
    if (ended) {
      this.pause();
      post({ type: "ended", playerId: this.id, frameNo: next });
      return;
    }
    this.arm();
  };

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.pause();
    if (this.wasm && this.handle !== undefined) this.wasm.destroyAnimation(this.handle);
    this.handle = undefined;
    if (this.entry) cache.release(this.entry, this.id);
    this.entry = null;
  }
}

async function load(msg: LottieLoadMessage) {
  const item = new Item(msg);
  items.get(msg.playerId)?.destroy();
  items.set(msg.playerId, item);
  try {
    if (!wasmUrl) throw new Error("lottie worker not initialised");
    const [json, wasm] = await Promise.all([decodeLottieBytes(msg.bytes), loadTLottieWasm(wasmUrl)]);
    if (item.dead) return;
    item.init(json, wasm);
    await item.showFirstFrame();
    if (item.dead) return;
    post({ type: "loaded", playerId: item.id, frameCount: item.frameCount, fps: item.fps });
    item.markReady();
  } catch (err) {
    if (err instanceof DestroyedError || item.dead) return;
    item.destroy();
    if (items.get(item.id) === item) items.delete(item.id);
    post({ type: "error", playerId: item.id, message: String((err as Error)?.message ?? err) });
  }
}

scope.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      wasmUrl = msg.wasmUrl;
      if (msg.cacheBudgetBytes) cache.setBudget(msg.cacheBudgetBytes);
      return;
    case "load":
      void load(msg);
      return;
    case "destroy":
      items.get(msg.playerId)?.destroy();
      items.delete(msg.playerId);
      return;
  }

  const item = items.get(msg.playerId);
  if (!item) {
    if (msg.type === "renderFrame")
      post({ type: "error", playerId: msg.playerId, message: "unknown player", requestId: msg.requestId });
    return;
  }

  switch (msg.type) {
    case "play":
      item.play();
      break;
    case "pause":
      item.pause();
      break;
    case "seek":
      item.seek(msg.frameNo);
      break;
    case "setLoop":
      item.setLoop(msg.loop);
      break;
    case "setTextColor":
      item.setColor(msg.color);
      break;
    case "ack":
      item.ack();
      break;
    case "renderFrame":
      item.renderFrameFor(msg.requestId, msg.frameNo).catch((err) => {
        post({
          type: "error",
          playerId: msg.playerId,
          message: String((err as Error)?.message ?? err),
          requestId: msg.requestId,
        });
      });
      break;
  }
});
