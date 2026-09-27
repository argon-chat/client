import { AnimationIntersector, getAnimationIntersector, type AnimationControl } from "../animationIntersector";
import { prefersReducedMotion } from "../settings";
import { paintFrameTinted } from "../tint";
import type { LottieFromWorker, LottieLoadMessage, LottieToWorker } from "./protocol";
import { isOffscreenCanvasSupported } from "./support";
import { tlottieWasmUrl } from "./tlottieWasm";

export interface LottiePlayerOptions {
  /**
   * Where frames are shown. Handed to a worker when OffscreenCanvas works, drawn here otherwise.
   * Without one, frames come to `onFrame` (the custom emoji overlay draws them itself).
   */
  canvas?: HTMLCanvasElement | null;
  fileId: string;
  /** The TGS / JSON bytes. Not transferred: a cached buffer is safe to return. */
  load: () => Promise<ArrayBuffer>;
  /** CSS pixels; the backing size is this × the clamped pixel ratio. */
  width: number;
  height: number;
  loop?: boolean;
  /** Default: on, unless the OS prefers reduced motion. */
  autoplay?: boolean;
  group?: string;
  toneIndex?: number | null;
  /** A CSS colour to recolour the frames with (monochrome emoji); null for none. */
  textColor?: string | null;
  /** A copy of the first frame, the receiver's to keep (and close). */
  onFirstFrame?: (bitmap: ImageBitmap) => void;
  /** Canvas-less players: every frame, borrowed — valid until the next one arrives. */
  onFrame?: (bitmap: ImageBitmap, frameNo: number) => void;
  onLoaded?: (info: { frameCount: number; fps: number }) => void;
  onError?: (error: Error) => void;
  onEnded?: () => void;
  /** The element whose visibility drives playback. Default: the canvas; false: `setVisible` only. */
  observe?: Element | null | false;
  /** With nothing observed: visible before the first `setVisible`? Default true. */
  initiallyVisible?: boolean;
  /** 0.5 renders every other frame of a 60 fps file. Default: 0.5 for small players on low-end devices. */
  skipRatio?: number;
  pixelRatio?: number;
}

export type LottiePlayerState = "loading" | "ready" | "error" | "destroyed";

export interface LottiePlayerHandle {
  readonly id: number;
  readonly cacheKey: string;
  readonly workerIndex: number;
  /** Backing size in device pixels. */
  readonly width: number;
  readonly height: number;
  readonly state: LottiePlayerState;
  readonly playing: boolean;
  /** Resolves once the first frame is shown; rejects when loading fails. */
  readonly ready: Promise<void>;
  play(): void;
  pause(): void;
  destroy(): void;
  setVisible(visible: boolean): void;
  setAutoplay(autoplay: boolean): void;
  setTextColor(color: string | null): void;
  setLoop(loop: boolean): void;
  seek(frameNo: number): void;
  /** Renders (and shows) one frame and returns a copy of it, the caller's to close. */
  renderFrame(frameNo: number): Promise<ImageBitmap>;
}

export interface LottiePoolOptions {
  workerCount?: number;
  createWorker?: () => Worker | Promise<Worker>;
  wasmUrl?: string | (() => string);
  cacheBudgetBytes?: number;
  /** Override the OffscreenCanvas probe. */
  offscreenCanvas?: boolean;
  intersector?: AnimationIntersector;
  lowEndDevice?: boolean;
  devicePixelRatio?: () => number;
}

const defaultCreateWorker = () => import("@/workers/lottie.worker?worker").then((m) => new m.default());

export function defaultWorkerCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.min(4, cores || 4));
}

/** tweb's heuristic, simplified: phones, ≤4 cores or ≤4 GB of memory. */
export function isLowEndDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "")) return true;
  if ((navigator.hardwareConcurrency || 8) <= 4) return true;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  return memory !== undefined && memory <= 4;
}

export function clampPixelRatio(ratio: number | undefined): number {
  return Math.min(2, Math.max(1, ratio || 1));
}

/** FNV-1a: stable, so every player of one animation lands on the worker holding its frames. */
export function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Share of frames cached: all of small players, 75 % of medium, 50 % of large ones. */
export function cachingDeltaFor(width: number, height: number): number {
  if (width <= 100 && height <= 100) return Infinity;
  if (width <= 400 && height <= 400) return 4;
  return 2;
}

type Mode = "offscreen" | "draw" | "deliver";

class PoolPlayer implements LottiePlayerHandle {
  readonly cacheKey: string;
  readonly width: number;
  readonly height: number;
  readonly workerIndex: number;
  readonly ready: Promise<void>;
  state: LottiePlayerState = "loading";

  private readonly control: AnimationControl;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private worker: Worker | null = null;
  private mode: Mode = "deliver";
  private ctx: CanvasRenderingContext2D | null = null;
  private lastDrawn: ImageBitmap | null = null;
  private wantPlaying = false;
  private sentPlaying = false;
  private ended = false;
  private color: string | null;
  private loop: boolean;
  private requestSeq = 0;
  private readonly requests = new Map<number, { resolve: (b: ImageBitmap) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly pool: LottiePool,
    readonly id: number,
    private readonly opts: LottiePlayerOptions,
    private readonly skipRatio: number | undefined,
    pixelRatio: number,
  ) {
    this.width = Math.max(1, Math.round(opts.width * pixelRatio));
    this.height = Math.max(1, Math.round(opts.height * pixelRatio));
    this.cacheKey = `${opts.fileId}-${this.width}-${this.height}-${opts.toneIndex ?? 0}`;
    this.workerIndex = hashKey(this.cacheKey) % pool.workerCount;
    this.color = opts.textColor ?? null;
    this.loop = opts.loop ?? true;

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => {});

    const observe = opts.observe === undefined ? (opts.canvas ?? null) : opts.observe || null;
    this.control = pool.intersector.add({
      el: observe,
      group: opts.group ?? "",
      autoplay: opts.autoplay ?? !prefersReducedMotion(),
      initiallyVisible: opts.initiallyVisible,
      setPlaying: (playing) => this.applyPlaying(playing),
    });

    void this.start();
  }

  get playing(): boolean {
    return this.control.playing;
  }

  private async start() {
    try {
      const bytes = await this.opts.load();
      if (this.state !== "loading") return;
      const worker = await this.pool.worker(this.workerIndex);
      if (this.state !== "loading") return;
      this.worker = worker;

      const canvas = this.opts.canvas ?? null;
      let offscreen: OffscreenCanvas | undefined;
      if (canvas && this.pool.offscreenCanvas) {
        canvas.width = this.width;
        canvas.height = this.height;
        offscreen = canvas.transferControlToOffscreen();
        this.mode = "offscreen";
      } else if (canvas) {
        canvas.width = this.width;
        canvas.height = this.height;
        this.ctx = canvas.getContext("2d");
        this.mode = "draw";
      }

      const message: LottieLoadMessage = {
        type: "load",
        playerId: this.id,
        fileId: this.opts.fileId,
        bytes,
        width: this.width,
        height: this.height,
        toneIndex: this.opts.toneIndex ?? undefined,
        canvas: offscreen,
        textColor: this.mode === "offscreen" ? this.color : null,
        loop: this.loop,
        skipRatio: this.skipRatio,
        cachingDelta: cachingDeltaFor(this.width, this.height),
        wantFirstFrame: !!this.opts.onFirstFrame,
      };
      worker.postMessage(message, offscreen ? [offscreen] : []);
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private post(message: LottieToWorker) {
    this.worker?.postMessage(message);
  }

  private applyPlaying(playing: boolean) {
    this.wantPlaying = playing;
    if (this.state !== "ready" || playing === this.sentPlaying) return;
    this.sentPlaying = playing;
    this.post({ type: playing ? "play" : "pause", playerId: this.id });
  }

  // --- from the worker ---

  onLoaded(frameCount: number, fps: number) {
    if (this.state !== "loading") return;
    this.state = "ready";
    this.resolveReady();
    this.opts.onLoaded?.({ frameCount, fps });
    if (this.wantPlaying) this.applyPlaying(true);
  }

  onFirstFrame(bitmap: ImageBitmap) {
    if (this.state === "destroyed" || !this.opts.onFirstFrame) {
      bitmap.close();
      return;
    }
    this.opts.onFirstFrame(bitmap);
  }

  onFrame(bitmap: ImageBitmap, frameNo: number) {
    if (this.state === "destroyed") {
      bitmap.close();
      return;
    }
    this.post({ type: "ack", playerId: this.id });
    if (this.mode === "draw" && this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      paintFrameTinted(this.ctx, bitmap, this.color);
    }
    this.opts.onFrame?.(bitmap, frameNo);
    this.lastDrawn?.close();
    this.lastDrawn = bitmap;
  }

  onReply(requestId: number, bitmap: ImageBitmap | null, error?: string) {
    const request = this.requests.get(requestId);
    if (!request) {
      bitmap?.close();
      return;
    }
    this.requests.delete(requestId);
    if (bitmap) request.resolve(bitmap);
    else request.reject(new Error(error ?? "render failed"));
  }

  onEnded() {
    this.ended = true;
    this.sentPlaying = false;
    this.control.setEnded();
    this.opts.onEnded?.();
  }

  fail(error: Error) {
    if (this.state === "destroyed" || this.state === "error") return;
    this.state = "error";
    this.rejectReady(error);
    this.control.remove();
    if (this.worker) this.post({ type: "destroy", playerId: this.id });
    this.pool.forget(this.id);
    this.opts.onError?.(error);
  }

  // --- handle ---

  play() {
    if (this.ended) {
      this.ended = false;
      this.seek(0);
    }
    this.control.play();
  }

  pause() {
    this.control.pause();
  }

  setVisible(visible: boolean) {
    this.control.setVisible(visible);
  }

  setAutoplay(autoplay: boolean) {
    this.control.setAutoplay(autoplay);
  }

  setTextColor(color: string | null) {
    this.color = color;
    if (this.mode === "offscreen") this.post({ type: "setTextColor", playerId: this.id, color });
    else if (this.mode === "draw" && this.ctx && this.lastDrawn) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      paintFrameTinted(this.ctx, this.lastDrawn, color);
    }
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    this.post({ type: "setLoop", playerId: this.id, loop });
  }

  seek(frameNo: number) {
    this.post({ type: "seek", playerId: this.id, frameNo });
  }

  async renderFrame(frameNo: number): Promise<ImageBitmap> {
    await this.ready;
    if (this.state !== "ready") throw new Error("player destroyed");
    const requestId = ++this.requestSeq;
    return new Promise<ImageBitmap>((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject });
      this.post({ type: "renderFrame", playerId: this.id, frameNo, requestId });
    });
  }

  destroy() {
    if (this.state === "destroyed") return;
    const wasLoading = this.state === "loading";
    this.state = "destroyed";
    if (wasLoading) this.rejectReady(new Error("player destroyed"));
    this.control.remove();
    if (this.worker) this.post({ type: "destroy", playerId: this.id });
    for (const request of this.requests.values()) request.reject(new Error("player destroyed"));
    this.requests.clear();
    this.lastDrawn?.close();
    this.lastDrawn = null;
    this.pool.forget(this.id);
  }
}

/**
 * Lottie players on a small pool of workers (min(4, cores)). A player goes to the worker picked by
 * the hash of its cache key, so every player of one animation at one size shares that worker's
 * frame cache. Playback follows the intersector: visible, page shown, animations on, group allowed.
 */
export class LottiePool {
  readonly workerCount: number;
  readonly intersector: AnimationIntersector;
  readonly offscreenCanvas: boolean;
  private readonly workers: (Promise<Worker> | undefined)[];
  private readonly players = new Map<number, PoolPlayer>();
  private readonly workerPlayers = new Map<number, Set<number>>();
  private nextId = 0;

  constructor(private readonly options: LottiePoolOptions = {}) {
    this.workerCount = Math.max(1, options.workerCount ?? defaultWorkerCount());
    this.workers = new Array(this.workerCount);
    this.intersector = options.intersector ?? getAnimationIntersector();
    this.offscreenCanvas = options.offscreenCanvas ?? isOffscreenCanvasSupported();
  }

  createPlayer(opts: LottiePlayerOptions): LottiePlayerHandle {
    const ratio = clampPixelRatio(
      opts.pixelRatio ?? this.options.devicePixelRatio?.() ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1),
    );
    const lowEnd = this.options.lowEndDevice ?? isLowEndDevice();
    const skipRatio = opts.skipRatio ?? (lowEnd && opts.width < 100 && opts.height < 100 ? 0.5 : undefined);
    const player = new PoolPlayer(this, ++this.nextId, opts, skipRatio, ratio);
    this.players.set(player.id, player);
    let set = this.workerPlayers.get(player.workerIndex);
    if (!set) this.workerPlayers.set(player.workerIndex, (set = new Set()));
    set.add(player.id);
    return player;
  }

  lockGroup(group: string) {
    this.intersector.lockGroup(group);
  }

  unlockGroup(group: string) {
    this.intersector.unlockGroup(group);
  }

  setOnlyPlayableGroup(group: string | null) {
    this.intersector.setOnlyPlayableGroup(group);
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** @internal */
  forget(id: number) {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.workerPlayers.get(player.workerIndex)?.delete(id);
  }

  /** @internal */
  worker(index: number): Promise<Worker> {
    let promise = this.workers[index];
    if (!promise) {
      promise = Promise.resolve((this.options.createWorker ?? defaultCreateWorker)()).then((worker) => {
        worker.addEventListener("message", (event: MessageEvent<LottieFromWorker>) => this.onMessage(event.data));
        worker.addEventListener("error", (event) => this.onWorkerError(index, event));
        const wasmUrl = this.options.wasmUrl;
        worker.postMessage({
          type: "init",
          wasmUrl: typeof wasmUrl === "function" ? wasmUrl() : (wasmUrl ?? tlottieWasmUrl()),
          cacheBudgetBytes: this.options.cacheBudgetBytes,
        } satisfies LottieToWorker);
        return worker;
      });
      promise.catch(() => {
        if (this.workers[index] === promise) this.workers[index] = undefined;
      });
      this.workers[index] = promise;
    }
    return promise;
  }

  terminate() {
    for (const player of [...this.players.values()]) player.destroy();
    for (const promise of this.workers) void promise?.then((worker) => worker.terminate(), () => {});
    this.workers.fill(undefined);
  }

  private onMessage(msg: LottieFromWorker) {
    const player = this.players.get(msg.playerId);
    if (!player) {
      if ((msg.type === "frame" || msg.type === "firstFrame") && msg.bitmap) msg.bitmap.close();
      return;
    }
    switch (msg.type) {
      case "loaded":
        player.onLoaded(msg.frameCount, msg.fps);
        break;
      case "firstFrame":
        player.onFirstFrame(msg.bitmap);
        break;
      case "frame":
        if (msg.requestId !== undefined) player.onReply(msg.requestId, msg.bitmap);
        else player.onFrame(msg.bitmap, msg.frameNo);
        break;
      case "ended":
        player.onEnded();
        break;
      case "error":
        if (msg.requestId !== undefined) player.onReply(msg.requestId, null, msg.message);
        else player.fail(new Error(msg.message));
        break;
    }
  }

  private onWorkerError(index: number, event: Event) {
    const message = (event as ErrorEvent).message || "lottie worker failed";
    for (const id of [...(this.workerPlayers.get(index) ?? [])]) this.players.get(id)?.fail(new Error(message));
  }
}

let shared: LottiePool | null = null;

export function getLottiePool(): LottiePool {
  return (shared ??= new LottiePool());
}
