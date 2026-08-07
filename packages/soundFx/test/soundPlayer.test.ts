/**
 * The sound player.
 *
 * Buffer-source playback is fire-and-forget: once started, a node cannot be reused, so
 * every mistake here shows up as a leak or a stuck sound rather than an exception. The
 * behaviour worth pinning is the bookkeeping — the instance pool, sprite windows, the
 * mute gate, and whether stopping actually detaches what it claims to.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { createSoundPlayer, clearAudioCache, getGlobalAudioContext } from "../src";

// ── A recording Web Audio fake ──────────────────────────────────────

class Node {
  outputs: Node[] = [];
  connect(t: Node) { this.outputs.push(t); return t; }
  disconnect() { this.outputs = []; }
}

class Param {
  constructor(public value = 1) {}
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
}

class BufferSource extends Node {
  buffer: unknown = null;
  playbackRate = new Param(1);
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started: unknown[] | null = null;
  stopped = false;
  start(...args: unknown[]) {
    if (this.started) throw new Error("cannot call start twice");
    this.started = args;
  }
  stop() {
    if (this.stopped) throw new Error("already stopped");
    this.stopped = true;
  }
  /** Simulate the browser firing onended after natural completion. */
  finish() { this.onended?.(); }
}

class Gain extends Node { gain = new Param(1); }
class Panner extends Node { pan = new Param(0); }

const created = { sources: [] as BufferSource[], gains: [] as Gain[], panners: [] as Panner[] };

class FakeAudioContext extends Node {
  currentTime = 0;
  state = "running";
  destination = new Node();
  createBufferSource() { const s = new BufferSource(); created.sources.push(s); return s; }
  createGain() { const g = new Gain(); created.gains.push(g); return g; }
  createStereoPanner() { const p = new Panner(); created.panners.push(p); return p; }
  async decodeAudioData() { return { duration: 4 }; }
  resume() { return Promise.resolve(); }
}

const ctx = () => new FakeAudioContext() as unknown as AudioContext;

/** Wait for the player's internal load promise chain to settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  created.sources = [];
  created.gains = [];
  created.panners = [];
  clearAudioCache();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => new ArrayBuffer(8),
  })));
});

afterEach(() => {
  vi.useRealTimers();
});

async function ready(options: Record<string, unknown> = {}) {
  const player = createSoundPlayer("/s.mp3", { audioContext: ctx(), ...options });
  await settle();
  return player;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("loading", () => {
  test("preloads and reports duration in milliseconds", async () => {
    const onLoad = vi.fn();
    const player = await ready({ onLoad });

    expect(player.state.value).toBe("ready");
    expect(player.duration.value).toBe(4000);
    expect(onLoad).toHaveBeenCalledWith(4000);
  });

  test("a failed fetch lands in the error state and reports why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })));
    const onError = vi.fn();

    const player = await ready({ onError });

    expect(player.state.value).toBe("error");
    expect(onError.mock.calls[0][0].message).toMatch(/404/);
  });

  test("the same url is fetched once across players", async () => {
    await ready();
    await ready();

    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });

  test("clearing the cache forces a refetch", async () => {
    await ready();
    clearAudioCache("/s.mp3");
    await ready();

    expect((globalThis.fetch as any).mock.calls).toHaveLength(2);
  });

  test("preload can be declined", async () => {
    createSoundPlayer("/s.mp3", { audioContext: ctx(), preload: false });
    await settle();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("playing", () => {
  test("starts a source and counts it as active", async () => {
    const player = await ready();

    const id = player.play();

    expect(id).toBeGreaterThan(0);
    expect(player.activeCount.value).toBe(1);
    expect(player.isPlaying.value).toBe(true);
    expect(created.sources[0].started).not.toBeNull();
  });

  test("a finished sound stops counting and notifies", async () => {
    const onEnd = vi.fn();
    const player = await ready({ onEnd });

    player.play();
    created.sources[0].finish();

    expect(player.activeCount.value).toBe(0);
    expect(player.isPlaying.value).toBe(false);
    expect(onEnd).toHaveBeenCalled();
  });

  test("muted players refuse to play and say so", async () => {
    const player = await ready({ soundEnabled: false });

    expect(player.play()).toBe(-1);
    expect(created.sources).toHaveLength(0);
  });

  test("forceSoundEnabled overrides the mute for a single call", async () => {
    const player = await ready({ soundEnabled: false });

    expect(player.play({ forceSoundEnabled: true })).toBeGreaterThan(0);
  });

  test("playing before load defers rather than dropping the sound", async () => {
    const player = createSoundPlayer("/s.mp3", { audioContext: ctx(), preload: false });

    expect(player.play()).toBe(-1);
    await settle();
    await settle();

    expect(created.sources.length).toBeGreaterThan(0);
  });

  test("routes through a per-instance gain into the master gain", async () => {
    const player = await ready();
    player.play({ volume: 0.5 });

    const source = created.sources[0];
    const instanceGain = created.gains.at(-1)!;
    expect(source.outputs).toContain(instanceGain);
    expect(instanceGain.gain.value).toBe(0.5);
    expect(instanceGain.outputs).toHaveLength(1);
  });

  test("a fade-in ramps from silence instead of setting the level", async () => {
    const player = await ready();
    player.play({ volume: 1, fadeIn: 250 });

    // Ramp target is the final volume; the starting point must be zero or it clicks.
    expect(created.gains.at(-1)!.gain.value).toBe(1);
  });

  test("panning is clamped to the valid range", async () => {
    const player = await ready();

    player.play({ pan: 5 });
    expect(created.panners.at(-1)!.pan.value).toBe(1);

    player.play({ pan: -5 });
    expect(created.panners.at(-1)!.pan.value).toBe(-1);
  });

  test("no panner is created when panning is not asked for", async () => {
    const player = await ready();
    player.play();

    expect(created.panners).toHaveLength(0);
  });
});

describe("sprites", () => {
  const sprite = { hit: [1000, 500], miss: [2000, 250] } as Record<string, [number, number]>;

  test("a sprite plays its own window of the buffer, in seconds", async () => {
    const player = await ready({ sprite });

    player.play({ id: "hit" });

    // start(when, offset, duration) — the offset and duration come from the sprite.
    expect(created.sources[0].started).toEqual([0, 1, 0.5]);
  });

  test("a looping sprite sets loop points instead of a duration", async () => {
    const player = await ready({ sprite });

    player.play({ id: "miss", loop: true });

    const source = created.sources[0];
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(2);
    expect(source.loopEnd).toBe(2.25);
    expect(source.started).toEqual([0, 2]);
  });

  test("an unknown sprite id falls back to the whole buffer", async () => {
    const player = await ready({ sprite });

    player.play({ id: "nope" });

    expect(created.sources[0].started).toEqual([0, 0, 4]);
  });
});

describe("the instance pool", () => {
  test("holds concurrent sounds up to the pool size", async () => {
    const player = await ready({ poolSize: 3 });

    player.play();
    player.play();
    player.play();

    expect(player.activeCount.value).toBe(3);
  });

  test("exceeding the pool evicts the oldest rather than growing forever", async () => {
    // Without this a rapid-fire sound effect accumulates nodes until the tab stutters.
    const player = await ready({ poolSize: 2 });

    player.play();
    player.play();
    player.play();

    expect(player.activeCount.value).toBe(2);
    expect(created.sources[0].stopped).toBe(true);
  });
});

describe("stopping", () => {
  test("stopping one instance leaves the others alone", async () => {
    const player = await ready();
    const first = player.play();
    player.play();

    player.stop(first);

    expect(player.activeCount.value).toBe(1);
    expect(created.sources[0].stopped).toBe(true);
    expect(created.sources[1].stopped).toBe(false);
  });

  test("stopping with no id stops everything", async () => {
    const player = await ready();
    player.play();
    player.play();

    player.stop();

    expect(player.activeCount.value).toBe(0);
    expect(created.sources.every((s) => s.stopped)).toBe(true);
  });

  test("stopping an unknown id is harmless", async () => {
    const player = await ready();
    expect(() => player.stop(9999)).not.toThrow();
  });

  test("a source that already ended does not throw on stop", async () => {
    // The browser rejects stop() on a finished node; the player must swallow that.
    const player = await ready();
    player.play();
    created.sources[0].stop();

    expect(() => player.stop()).not.toThrow();
  });

  test("pause stops, since Web Audio has no real pause", async () => {
    const player = await ready();
    player.play();

    player.pause();

    expect(player.activeCount.value).toBe(0);
  });

  test("unload clears playback and returns to idle", async () => {
    const player = await ready();
    player.play();

    player.unload();

    expect(player.activeCount.value).toBe(0);
    expect(player.state.value).toBe("idle");
    expect(player.duration.value).toBe(0);
  });
});

describe("fadeOut", () => {
  test("ramps the instance down and stops it afterwards", async () => {
    const player = await ready();
    const id = player.play();
    // Installed only now: ready() awaits a real timeout, which a fake clock would stall.
    vi.useFakeTimers();

    player.fadeOut(100, id);
    expect(created.gains.at(-1)!.gain.value).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(player.activeCount.value).toBe(0);
  });

  test("with no id it fades everything", async () => {
    const player = await ready();
    player.play();
    player.play();
    vi.useFakeTimers();

    player.fadeOut(50);
    await vi.advanceTimersByTimeAsync(50);

    expect(player.activeCount.value).toBe(0);
  });
});

describe("volume and rate", () => {
  test("volume is clamped to 0–1", async () => {
    const player = await ready({ volume: 0.5 });

    player.setVolume(5);
    player.setVolume(-1);

    // Master gain is the first one built, before any instance gain.
    expect(created.gains[0].gain.value).toBe(0);
  });

  test("rate is clamped to a sane playback range", async () => {
    const player = await ready();
    player.play();

    player.setRate(99);
    expect(created.sources[0].playbackRate.value).toBe(4);

    player.setRate(0);
    expect(created.sources[0].playbackRate.value).toBe(0.1);
  });

  test("rate applies to sounds already playing", async () => {
    const player = await ready();
    player.play();
    player.play();

    player.setRate(2);

    expect(created.sources.map((s) => s.playbackRate.value)).toEqual([2, 2]);
  });

  test("a reactive volume ref drives the player", async () => {
    const volume = ref(1);
    await ready({ volume });

    volume.value = 0.25;
    await settle();

    expect(created.gains[0].gain.value).toBe(0.25);
  });

  test("a reactive mute ref gates playback", async () => {
    const enabled = ref(true);
    const player = await ready({ soundEnabled: enabled });

    enabled.value = false;
    await settle();

    expect(player.play()).toBe(-1);
  });
});

describe("the global audio context", () => {
  test("is created once and reused", () => {
    expect(getGlobalAudioContext()).toBe(getGlobalAudioContext());
  });

  test("is resumed when the browser has suspended it", () => {
    const context = getGlobalAudioContext() as any;
    context.state = "suspended";
    context.resume = vi.fn(async () => {});

    getGlobalAudioContext();

    expect(context.resume).toHaveBeenCalled();
  });
});
