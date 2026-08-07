/**
 * NoiseSuppressor.
 *
 * Owns the lifecycle of the suppression worklets: load a module and its WASM once,
 * build a node, and tear the previous one down before building the next. The failure
 * modes that matter are leaks (an old node left connected) and wasted work (re-fetching
 * a multi-megabyte WASM binary on every toggle).
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const lib = vi.hoisted(() => ({
  rnnoiseLoads: 0,
  speexLoads: 0,
  built: [] as { kind: string; options: any }[],
}));

vi.mock("@sapphi-red/web-noise-suppressor", () => {
  class Base {
    disconnect = vi.fn();
    port = { onmessage: null };
    constructor(_ctx: unknown, public options: unknown) {}
  }
  return {
    RnnoiseWorkletNode: class extends Base {
      destroy = vi.fn();
      constructor(ctx: unknown, options: unknown) {
        super(ctx, options);
        lib.built.push({ kind: "rnnoise", options });
      }
    },
    SpeexWorkletNode: class extends Base {
      constructor(ctx: unknown, options: unknown) {
        super(ctx, options);
        lib.built.push({ kind: "speex", options });
      }
    },
    NoiseGateWorkletNode: class extends Base {
      constructor(ctx: unknown, options: unknown) {
        super(ctx, options);
        lib.built.push({ kind: "noisegate", options });
      }
    },
    loadRnnoise: vi.fn(async () => { lib.rnnoiseLoads++; return new ArrayBuffer(8); }),
    loadSpeex: vi.fn(async () => { lib.speexLoads++; return new ArrayBuffer(8); }),
  };
});

vi.mock("@argon/core", () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));

import { NoiseSuppressor } from "../src/NoiseSuppressor";

const URLS = {
  rnnoiseWorklet: "/ns/rnnoise.js",
  rnnoiseWasm: "/ns/rnnoise.wasm",
  rnnoiseWasmSimd: "/ns/rnnoise-simd.wasm",
  speexWorklet: "/ns/speex.js",
  speexWasm: "/ns/speex.wasm",
  noiseGateWorklet: "/ns/gate.js",
};

function makeCtx() {
  const modules: string[] = [];
  return {
    modules,
    ctx: { audioWorklet: { addModule: vi.fn(async (u: string) => { modules.push(u); }) } } as unknown as AudioContext,
  };
}

beforeEach(() => {
  lib.rnnoiseLoads = 0;
  lib.speexLoads = 0;
  lib.built = [];
});

describe("activate", () => {
  test("starts out inactive", () => {
    const ns = new NoiseSuppressor(URLS);
    expect(ns.getMode()).toBe("off");
    expect(ns.getNode()).toBeNull();
  });

  test("builds the node for the requested mode and reports it", async () => {
    const { ctx, modules } = makeCtx();
    const ns = new NoiseSuppressor(URLS);

    const node = await ns.activate("rnnoise", ctx);

    expect(node).not.toBeNull();
    expect(ns.getMode()).toBe("rnnoise");
    expect(ns.getNode()).toBe(node);
    expect(modules).toEqual(["/ns/rnnoise.js"]);
    expect(lib.built.at(-1)!.kind).toBe("rnnoise");
  });

  test("each mode loads its own worklet", async () => {
    for (const [mode, url] of [
      ["rnnoise", "/ns/rnnoise.js"],
      ["speex", "/ns/speex.js"],
      ["noisegate", "/ns/gate.js"],
    ] as const) {
      const { ctx, modules } = makeCtx();
      await new NoiseSuppressor(URLS).activate(mode, ctx);
      expect(modules, mode).toEqual([url]);
    }
  });

  test("'off' builds nothing", async () => {
    const { ctx, modules } = makeCtx();
    const ns = new NoiseSuppressor(URLS);

    expect(await ns.activate("off", ctx)).toBeNull();
    expect(ns.getNode()).toBeNull();
    expect(modules).toHaveLength(0);
  });

  test("WASM is fetched once and reused across re-activations", async () => {
    // These binaries are megabytes; re-downloading them on every settings toggle is
    // the difference between an instant switch and a visible stall.
    const { ctx } = makeCtx();
    const ns = new NoiseSuppressor(URLS);

    await ns.activate("rnnoise", ctx);
    await ns.activate("rnnoise", ctx);
    await ns.activate("rnnoise", ctx);

    expect(lib.rnnoiseLoads).toBe(1);
  });

  test("a worklet module is registered once per context", async () => {
    const { ctx, modules } = makeCtx();
    const ns = new NoiseSuppressor(URLS);

    await ns.activate("speex", ctx);
    await ns.activate("speex", ctx);

    expect(modules).toEqual(["/ns/speex.js"]);
    expect(lib.speexLoads).toBe(1);
  });

  test("switching modes tears the previous node down first", async () => {
    // Leaving the old node connected would run both suppressors in series.
    const { ctx } = makeCtx();
    const ns = new NoiseSuppressor(URLS);

    await ns.activate("rnnoise", ctx);
    const first = ns.getNode() as any;

    await ns.activate("speex", ctx);

    expect(first.disconnect).toHaveBeenCalled();
    expect(first.destroy).toHaveBeenCalled();
    expect(ns.getNode()).not.toBe(first);
    expect(ns.getMode()).toBe("speex");
  });

  test("a failed activation leaves the suppressor off rather than half-armed", async () => {
    const { ctx } = makeCtx();
    (ctx.audioWorklet.addModule as any).mockRejectedValueOnce(new Error("network down"));
    const ns = new NoiseSuppressor(URLS);

    await expect(ns.activate("rnnoise", ctx)).rejects.toThrow("network down");

    expect(ns.getMode()).toBe("off");
    expect(ns.getNode()).toBeNull();
  });

  test("an unknown mode is rejected", async () => {
    const { ctx } = makeCtx();
    await expect(
      new NoiseSuppressor(URLS).activate("telepathy" as never, ctx),
    ).rejects.toThrow(/Unknown noise suppression mode/);
  });
});

describe("deactivate", () => {
  test("releases the node and reports off", async () => {
    const { ctx } = makeCtx();
    const ns = new NoiseSuppressor(URLS);
    await ns.activate("noisegate", ctx);
    const node = ns.getNode() as any;

    ns.deactivate();

    expect(node.disconnect).toHaveBeenCalled();
    expect(ns.getNode()).toBeNull();
    expect(ns.getMode()).toBe("off");
  });

  test("is safe to call when nothing is active, repeatedly", () => {
    const ns = new NoiseSuppressor(URLS);
    expect(() => { ns.deactivate(); ns.deactivate(); }).not.toThrow();
  });

  test("survives a node that throws while being torn down", async () => {
    const { ctx } = makeCtx();
    const ns = new NoiseSuppressor(URLS);
    await ns.activate("rnnoise", ctx);
    (ns.getNode() as any).destroy = () => { throw new Error("already gone"); };

    expect(() => ns.deactivate()).not.toThrow();
    expect(ns.getNode()).toBeNull();
  });
});

describe("dispose", () => {
  test("drops the node and the cached binaries so nothing is retained", async () => {
    const { ctx } = makeCtx();
    const ns = new NoiseSuppressor(URLS);
    await ns.activate("rnnoise", ctx);

    ns.dispose();

    expect(ns.getNode()).toBeNull();
    expect(ns.getMode()).toBe("off");

    // Caches were cleared, so the next activation reloads rather than reusing freed data.
    await ns.activate("rnnoise", ctx);
    expect(lib.rnnoiseLoads).toBe(2);
  });
});
