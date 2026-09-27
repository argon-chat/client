/**
 * LottiePool's playback state machine against a fake worker and a fake IntersectionObserver: which
 * worker a player goes to, and when it is told to play or pause — visibility, locked groups, the
 * only-playable group, a hidden page, the global switch, reduced motion, play-once endings.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { AnimationIntersector } from "@/lib/expressions/animationIntersector";
import { LottiePool, cachingDeltaFor, hashKey, type LottiePlayerOptions } from "@/lib/expressions/lottie/LottiePool";
import type { LottieFromWorker, LottieToWorker } from "@/lib/expressions/lottie/protocol";

class FakeWorker {
  static all: FakeWorker[] = [];
  posted: LottieToWorker[] = [];
  transfers: Transferable[][] = [];
  private listeners = new Map<string, ((e: any) => void)[]>();
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: LottieToWorker, transfer: Transferable[] = []) {
    this.posted.push(msg);
    this.transfers.push(transfer);
  }
  addEventListener(type: string, cb: (e: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  emit(data: LottieFromWorker) {
    for (const cb of this.listeners.get("message") ?? []) cb({ data });
  }
  fail(message: string) {
    for (const cb of this.listeners.get("error") ?? []) cb({ message });
  }
  terminate() {
    this.terminated = true;
  }
  of(playerId: number) {
    return this.posted.filter((m) => "playerId" in m && m.playerId === playerId).map((m) => m.type);
  }
}

class FakeIO {
  static current: FakeIO;
  observed = new Set<Element>();
  constructor(private cb: IntersectionObserverCallback) {
    FakeIO.current = this;
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  show(el: Element, visible = true) {
    this.cb([{ target: el, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function fakeDocument() {
  const listeners = new Set<() => void>();
  return {
    hidden: false,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    setHidden(hidden: boolean) {
      this.hidden = hidden;
      for (const cb of listeners) cb();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const fakeBitmap = () => ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap;

let doc: ReturnType<typeof fakeDocument>;
let enabled: ReturnType<typeof ref<boolean>>;
let intersector: AnimationIntersector;
let pool: LottiePool;
let dpr = 1;
let lowEnd = false;

function makePool(workerCount = 4) {
  return new LottiePool({
    workerCount,
    createWorker: () => new FakeWorker() as unknown as Worker,
    wasmUrl: "/tlottie.wasm",
    offscreenCanvas: false,
    intersector,
    lowEndDevice: lowEnd,
    devicePixelRatio: () => dpr,
  });
}

function create(opts: Partial<LottiePlayerOptions> = {}) {
  const el = document.createElement("div");
  const handle = pool.createPlayer({
    fileId: "sticker",
    load: async () => new ArrayBuffer(8),
    width: 100,
    height: 100,
    observe: el,
    ...opts,
  });
  return { handle, el };
}

async function loaded(opts: Partial<LottiePlayerOptions> = {}) {
  const made = create(opts);
  await flush();
  const worker = workerOf(made.handle.id);
  worker.emit({ type: "loaded", playerId: made.handle.id, frameCount: 30, fps: 30 });
  await made.handle.ready;
  return { ...made, worker };
}

function workerOf(playerId: number): FakeWorker {
  const worker = FakeWorker.all.find((w) => w.posted.some((m) => m.type === "load" && m.playerId === playerId));
  if (!worker) throw new Error(`no worker got player ${playerId}`);
  return worker;
}

beforeEach(() => {
  FakeWorker.all = [];
  dpr = 1;
  lowEnd = false;
  doc = fakeDocument();
  enabled = ref(true);
  intersector = new AnimationIntersector({
    IntersectionObserver: FakeIO as unknown as typeof IntersectionObserver,
    document: doc as unknown as Document,
    animationsEnabled: enabled as any,
  });
  pool = makePool();
});

afterEach(() => {
  intersector.destroy();
  vi.unstubAllGlobals();
});

describe("workers", () => {
  test("a worker is started on first use and told where the wasm is", async () => {
    create();
    await flush();
    expect(FakeWorker.all).toHaveLength(1);
    expect(FakeWorker.all[0].posted[0]).toEqual({ type: "init", wasmUrl: "/tlottie.wasm", cacheBudgetBytes: undefined });
    expect(FakeWorker.all[0].posted[1]).toMatchObject({ type: "load", fileId: "sticker", width: 100, height: 100 });
  });

  test("players of one animation at one size share a worker; the index is the key's hash", async () => {
    const a = create().handle;
    const b = create().handle;
    const c = create({ fileId: "other", width: 60, height: 60 }).handle;
    await flush();
    expect(a.cacheKey).toBe("sticker-100-100-0");
    expect(a.workerIndex).toBe(b.workerIndex);
    expect(workerOf(a.id)).toBe(workerOf(b.id));
    expect(a.workerIndex).toBe(hashKey("sticker-100-100-0") % 4);
    expect(c.workerIndex).toBe(hashKey("other-60-60-0") % 4);
  });

  test("the cache key carries the tone", () => {
    expect(create({ toneIndex: 3 }).handle.cacheKey).toBe("sticker-100-100-3");
  });

  test("the bytes are sent as loaded, not transferred", async () => {
    const buffer = new ArrayBuffer(16);
    const { handle } = create({ load: async () => buffer });
    await flush();
    const worker = workerOf(handle.id);
    const index = worker.posted.findIndex((m) => m.type === "load");
    expect((worker.posted[index] as any).bytes).toBe(buffer);
    expect(worker.transfers[index]).toEqual([]);
  });
});

describe("sizes", () => {
  test("backing size is css × the pixel ratio clamped to 1..2", async () => {
    dpr = 3;
    const big = create().handle;
    dpr = 0.5;
    const small = create().handle;
    expect([big.width, big.height]).toEqual([200, 200]);
    expect([small.width, small.height]).toEqual([100, 100]);
  });

  test("small players skip every other frame on low-end devices only", async () => {
    lowEnd = true;
    pool = makePool();
    const small = create({ width: 64, height: 64 }).handle;
    const large = create({ width: 200, height: 200 }).handle;
    await flush();
    const load = (id: number) => workerOf(id).posted.find((m) => m.type === "load" && m.playerId === id) as any;
    expect(load(small.id).skipRatio).toBe(0.5);
    expect(load(large.id).skipRatio).toBeUndefined();

    lowEnd = false;
    FakeWorker.all = []; // a new pool numbers its players from 1 again
    pool = makePool();
    const desktop = create({ width: 64, height: 64 }).handle;
    await flush();
    expect(load(desktop.id).skipRatio).toBeUndefined();
  });

  test("caching share: all frames when small, 75 % when medium, 50 % when large", () => {
    expect(cachingDeltaFor(100, 100)).toBe(Infinity);
    expect(cachingDeltaFor(200, 200)).toBe(4);
    expect(cachingDeltaFor(720, 720)).toBe(2);
  });
});

describe("playback", () => {
  test("plays once loaded and visible, pauses offscreen, resumes when back", async () => {
    const { handle, el } = create();
    FakeIO.current.show(el);
    await flush();
    const worker = workerOf(handle.id);
    expect(worker.of(handle.id)).toEqual(["load"]); // not loaded yet: nothing to play

    worker.emit({ type: "loaded", playerId: handle.id, frameCount: 30, fps: 30 });
    expect(handle.state).toBe("ready");
    expect(worker.of(handle.id)).toEqual(["load", "play"]);

    FakeIO.current.show(el, false);
    FakeIO.current.show(el, true);
    expect(worker.of(handle.id)).toEqual(["load", "play", "pause", "play"]);
  });

  test("nothing plays before its element is reported visible", async () => {
    const { handle, worker } = await loaded();
    expect(handle.playing).toBe(false);
    expect(worker.of(handle.id)).toEqual(["load"]);
  });

  test("a locked group starts nothing but still pauses what leaves; unlocking catches up", async () => {
    const a = await loaded({ group: "chat" });
    const b = await loaded({ group: "chat" });
    FakeIO.current.show(a.el);
    expect(a.handle.playing).toBe(true);

    pool.lockGroup("chat");
    FakeIO.current.show(b.el);
    expect(b.handle.playing).toBe(false);
    FakeIO.current.show(a.el, false);
    expect(a.handle.playing).toBe(false);

    pool.unlockGroup("chat");
    expect(b.handle.playing).toBe(true);
    expect(a.handle.playing).toBe(false);
  });

  test("only the playable group plays while one is set", async () => {
    const chat = await loaded({ group: "chat" });
    const picker = await loaded({ group: "picker" });
    FakeIO.current.show(chat.el);
    FakeIO.current.show(picker.el);
    expect([chat.handle.playing, picker.handle.playing]).toEqual([true, true]);

    pool.setOnlyPlayableGroup("picker");
    expect([chat.handle.playing, picker.handle.playing]).toEqual([false, true]);

    pool.setOnlyPlayableGroup(null);
    expect([chat.handle.playing, picker.handle.playing]).toEqual([true, true]);
  });

  test("a hidden page pauses everything", async () => {
    const { handle, el } = await loaded();
    FakeIO.current.show(el);
    doc.setHidden(true);
    expect(handle.playing).toBe(false);
    doc.setHidden(false);
    expect(handle.playing).toBe(true);
  });

  test("the global switch stops autoplay; an explicit play still plays", async () => {
    const a = await loaded();
    const b = await loaded();
    FakeIO.current.show(a.el);
    FakeIO.current.show(b.el);

    enabled.value = false;
    expect([a.handle.playing, b.handle.playing]).toEqual([false, false]);

    b.handle.play();
    expect(b.handle.playing).toBe(true);

    enabled.value = true;
    expect(a.handle.playing).toBe(true);
  });

  test("pause() holds it until play(), visibility notwithstanding", async () => {
    const { handle, el } = await loaded();
    FakeIO.current.show(el);
    handle.pause();
    FakeIO.current.show(el, false);
    FakeIO.current.show(el, true);
    expect(handle.playing).toBe(false);
    handle.play();
    expect(handle.playing).toBe(true);
  });

  test("reduced motion turns autoplay off by default", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const quiet = await loaded();
    const insisting = await loaded({ autoplay: true });
    FakeIO.current.show(quiet.el);
    FakeIO.current.show(insisting.el);
    expect(quiet.handle.playing).toBe(false);
    expect(insisting.handle.playing).toBe(true);

    quiet.handle.play();
    expect(quiet.handle.playing).toBe(true);
  });

  test("a play-once animation that ended stays put until play(), which restarts it", async () => {
    const onEnded = vi.fn();
    const { handle, el, worker } = await loaded({ loop: false, onEnded });
    FakeIO.current.show(el);
    worker.emit({ type: "ended", playerId: handle.id, frameNo: 29 });
    expect(onEnded).toHaveBeenCalled();
    expect(handle.playing).toBe(false);

    FakeIO.current.show(el, false);
    FakeIO.current.show(el, true);
    expect(handle.playing).toBe(false);

    handle.play();
    expect(handle.playing).toBe(true);
    const tail = worker.posted.slice(-2);
    expect(tail).toEqual([
      { type: "seek", playerId: handle.id, frameNo: 0 },
      { type: "play", playerId: handle.id },
    ]);
  });

  test("hand-driven visibility for players with nothing to observe", async () => {
    const { handle, worker } = await loaded({ observe: false, initiallyVisible: false });
    expect(handle.playing).toBe(false);
    handle.setVisible(true);
    expect(handle.playing).toBe(true);
    expect(worker.of(handle.id)).toContain("play");
  });
});

describe("frames and lifetime", () => {
  test("delivered frames are acked, handed over, and closed when the next arrives", async () => {
    const frames: ImageBitmap[] = [];
    const { handle, worker } = await loaded({ observe: false, onFrame: (b) => frames.push(b) });
    const first = fakeBitmap();
    const second = fakeBitmap();
    worker.emit({ type: "frame", playerId: handle.id, frameNo: 0, bitmap: first });
    worker.emit({ type: "frame", playerId: handle.id, frameNo: 1, bitmap: second });
    expect(frames).toEqual([first, second]);
    expect(worker.of(handle.id).filter((t) => t === "ack")).toHaveLength(2);
    expect(first.close).toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
    handle.destroy();
    expect(second.close).toHaveBeenCalled();
  });

  test("the first frame goes to onFirstFrame, and is asked for only when wanted", async () => {
    const onFirstFrame = vi.fn();
    const { handle } = create({ onFirstFrame });
    const plain = create().handle;
    await flush();
    const load = (id: number) => workerOf(id).posted.find((m) => m.type === "load" && m.playerId === id) as any;
    expect(load(handle.id).wantFirstFrame).toBe(true);
    expect(load(plain.id).wantFirstFrame).toBe(false);
    const bitmap = fakeBitmap();
    workerOf(handle.id).emit({ type: "firstFrame", playerId: handle.id, bitmap });
    expect(onFirstFrame).toHaveBeenCalledWith(bitmap);
  });

  test("renderFrame resolves with the worker's reply", async () => {
    const { handle, worker } = await loaded();
    const pending = handle.renderFrame(7);
    await flush();
    const request = worker.posted.at(-1) as Extract<LottieToWorker, { type: "renderFrame" }>;
    expect(request).toMatchObject({ type: "renderFrame", frameNo: 7 });
    const bitmap = fakeBitmap();
    worker.emit({ type: "frame", playerId: handle.id, frameNo: 7, bitmap, requestId: request.requestId });
    await expect(pending).resolves.toBe(bitmap);
  });

  test("a worker error fails the player", async () => {
    const onError = vi.fn();
    const { handle } = create({ onError });
    await flush();
    workerOf(handle.id).emit({ type: "error", playerId: handle.id, message: "tlottie rejected the animation" });
    await expect(handle.ready).rejects.toThrow("tlottie rejected");
    expect(handle.state).toBe("error");
    expect(onError).toHaveBeenCalled();
    expect(pool.playerCount).toBe(0);
  });

  test("a failed load never reaches a worker", async () => {
    const { handle } = create({ load: async () => Promise.reject(new Error("404")) });
    await expect(handle.ready).rejects.toThrow("404");
    expect(FakeWorker.all).toHaveLength(0);
  });

  test("a crashed worker fails its players", async () => {
    const { handle } = create();
    await flush();
    workerOf(handle.id).fail("boom");
    expect(handle.state).toBe("error");
  });

  test("destroy tells the worker, stops observing, and ignores late messages", async () => {
    const { handle, el, worker } = await loaded();
    expect(FakeIO.current.observed.has(el)).toBe(true);
    handle.destroy();
    expect(worker.of(handle.id).at(-1)).toBe("destroy");
    expect(FakeIO.current.observed.has(el)).toBe(false);
    const late = fakeBitmap();
    worker.emit({ type: "frame", playerId: handle.id, frameNo: 3, bitmap: late });
    expect(late.close).toHaveBeenCalled();
    expect(pool.playerCount).toBe(0);
  });

  test("destroyed while loading: nothing is sent at all", async () => {
    let release!: (b: ArrayBuffer) => void;
    const { handle } = create({ load: () => new Promise((r) => (release = r)) });
    handle.destroy();
    release(new ArrayBuffer(1));
    await flush();
    expect(FakeWorker.all).toHaveLength(0);
    await expect(handle.ready).rejects.toThrow();
  });
});
