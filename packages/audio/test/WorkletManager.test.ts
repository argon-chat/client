/**
 * WorkletManager.
 *
 * It registers the AudioWorklet modules the app depends on and builds nodes from them.
 * The names and paths it uses are a contract with files in public/audio — a typo there
 * fails at runtime with "processor not registered", never at build time.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { WorkletManager } from "../src/WorkletManager";

class FakeWorkletNode {
  port = { onmessage: null as ((e: MessageEvent) => void) | null, close: vi.fn() };
  parameters = new Map<string, { value: number; setValueAtTime: (v: number, t: number) => void }>();
  disconnect = vi.fn();
  constructor(public ctx: unknown, public name: string, public options: unknown) {
    this.parameters.set("enabled", {
      value: 1,
      setValueAtTime(v: number) { this.value = v; },
    });
  }
}

function makeAudio() {
  // A browser's context: it has an AudioWorklet. One without is below ("without AudioWorklet").
  const ctx = { currentTime: 0, audioWorklet: {} } as unknown as AudioContext;
  const added: { path: string; name: string }[] = [];
  return {
    added,
    ctx,
    manager: {
      workletBasePath: "/audio",
      getCurrentAudioContext: () => ctx,
      addWorkletModule: vi.fn(async (path: string, name: string) => { added.push({ path, name }); }),
      volumeToPercent: (v: number) => v * 100,
    } as any,
  };
}

let audio: ReturnType<typeof makeAudio>;

beforeEach(() => {
  audio = makeAudio();
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
});

describe("init", () => {
  test("registers every processor the app relies on, under the expected names", async () => {
    await new WorkletManager(audio.manager).init();

    expect(audio.added).toEqual([
      { path: "/audio/vu-meter-processor.js", name: "vu-meter-processor" },
      { path: "/audio/vu-stm.js", name: "vu-stereo-to-mono-processor" },
      { path: "/audio/input-gate-processor.js", name: "input-gate-processor" },
    ]);
  });

  test("is idempotent — a second init does not re-register", async () => {
    const worklets = new WorkletManager(audio.manager);
    await worklets.init();
    await worklets.init();

    expect(audio.manager.addWorkletModule).toHaveBeenCalledTimes(3);
  });

  test("falls back to a default base path when the engine exposes none", async () => {
    const bare = makeAudio();
    delete bare.manager.workletBasePath;

    await new WorkletManager(bare.manager).init();

    expect(bare.added.every((a) => a.path.startsWith("/audio/"))).toBe(true);
  });

  test("a failed registration is not silently marked as done", async () => {
    audio.manager.addWorkletModule = vi.fn(async () => { throw new Error("404"); });
    const worklets = new WorkletManager(audio.manager);

    await expect(worklets.init()).rejects.toThrow("404");

    // Still unregistered, so a later retry actually retries.
    audio.manager.addWorkletModule = vi.fn(async () => {});
    await worklets.init();
    expect(audio.manager.addWorkletModule).toHaveBeenCalledTimes(3);
  });
});

describe("createVUMeter", () => {
  test("reports left and right levels through the supplied refs", async () => {
    const left = ref(0);
    const right = ref(0);
    const node = (await new WorkletManager(audio.manager).createVUMeter(left, right)).Value as unknown as FakeWorkletNode;

    node.port.onmessage!({ data: new Float32Array([0.25, 0.5]) } as MessageEvent);

    expect(left.value).toBe(25);
    expect(right.value).toBe(50);
  });

  test("is built as a discrete stereo node so the channels stay separate", async () => {
    // 'speakers' interpretation would downmix and make both meters read the same.
    const node = (await new WorkletManager(audio.manager).createVUMeter(ref(0), ref(0))).Value as unknown as FakeWorkletNode;

    expect(node.name).toBe("vu-meter-processor");
    expect(node.options).toMatchObject({
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
    });
  });

  test("disposing closes the port and detaches the node", async () => {
    const disposable = await new WorkletManager(audio.manager).createVUMeter(ref(0), ref(0));
    const node = disposable.Value as unknown as FakeWorkletNode;

    await disposable.asyncDispose();

    expect(node.port.close).toHaveBeenCalled();
    expect(node.disconnect).toHaveBeenCalled();
  });
});

describe("createStereoToMonoProcessor", () => {
  test("is built for speaker interpretation, which is what downmixing needs", async () => {
    const node = (await new WorkletManager(audio.manager).createStereoToMonoProcessor()).Value as unknown as FakeWorkletNode;

    expect(node.name).toBe("vu-stereo-to-mono-processor");
    expect(node.options).toMatchObject({ channelInterpretation: "speakers" });
  });

  test("disposing releases it", async () => {
    const disposable = await new WorkletManager(audio.manager).createStereoToMonoProcessor();
    const node = disposable.Value as unknown as FakeWorkletNode;

    await disposable.asyncDispose();

    expect(node.port.close).toHaveBeenCalled();
    expect(node.disconnect).toHaveBeenCalled();
  });
});

describe("setEnabledVUNode", () => {
  test("toggles the processor's own enabled parameter", async () => {
    const worklets = new WorkletManager(audio.manager);
    const node = (await worklets.createStereoToMonoProcessor()).Value as unknown as FakeWorkletNode;

    worklets.setEnabledVUNode(node as unknown as AudioWorkletNode, false);
    expect(node.parameters.get("enabled")!.value).toBe(0);

    worklets.setEnabledVUNode(node as unknown as AudioWorkletNode, true);
    expect(node.parameters.get("enabled")!.value).toBe(1);
  });

  test("a node without the parameter is left alone rather than throwing", async () => {
    const worklets = new WorkletManager(audio.manager);
    const node = (await worklets.createStereoToMonoProcessor()).Value as unknown as FakeWorkletNode;
    node.parameters.delete("enabled");

    expect(() =>
      worklets.setEnabledVUNode(node as unknown as AudioWorkletNode, true),
    ).not.toThrow();
  });
});

/**
 * An AudioContext with no AudioWorklet (vue-native today): no AudioWorkletNode is built at all. The
 * meter is an AnalyserNode per channel behind a splitter, read 60 times a second through the
 * worklet's envelope; the stereo-to-mono step is a pass-through.
 */
describe("without AudioWorklet", () => {
  class FakeAnalyser {
    fftSize = 2048;
    level = 0;
    disconnect = vi.fn();
    getFloatTimeDomainData(out: Float32Array) {
      out.fill(0);
      out[7] = -this.level;
    }
  }

  function bareAudio() {
    const analysers: FakeAnalyser[] = [];
    const splitter = { connect: vi.fn(), disconnect: vi.fn() };
    const gain = { connect: vi.fn(), disconnect: vi.fn() };
    const ctx = {
      currentTime: 0,
      sampleRate: 48000,
      createChannelSplitter: vi.fn(() => splitter),
      createAnalyser: () => {
        const a = new FakeAnalyser();
        analysers.push(a);
        return a;
      },
      createGain: () => gain,
    } as unknown as AudioContext;
    const manager = { getCurrentAudioContext: () => ctx, volumeToPercent: (v: number) => v * 100 } as any;
    return { analysers, splitter, gain, ctx, manager };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioWorkletNode", class {
      constructor() {
        throw new ReferenceError("AudioWorkletNode is not defined");
      }
    });
  });

  test("the meter reads each channel's analyser and settles on its peak", async () => {
    const bare = bareAudio();
    const left = ref(0);
    const right = ref(0);
    const meter = await new WorkletManager(bare.manager).createVUMeter(left, right);

    expect(meter.Value).toBe(bare.splitter);
    expect(bare.ctx.createChannelSplitter).toHaveBeenCalledWith(2);
    expect(bare.splitter.connect.mock.calls).toEqual([[bare.analysers[0], 0], [bare.analysers[1], 1]]);
    expect(bare.analysers.map((a) => a.fftSize)).toEqual([1024, 1024]);

    bare.analysers[0].level = 0.5;
    bare.analysers[1].level = 0.25;
    vi.advanceTimersByTime(1000 / 60);
    // One tick in, the envelope is on its way up, as the worklet's is.
    expect(left.value).toBeGreaterThan(0);
    expect(left.value).toBeLessThan(50);

    vi.advanceTimersByTime(1000);
    expect(left.value).toBeCloseTo(50, 3);
    expect(right.value).toBeCloseTo(25, 3);

    await meter.asyncDispose();
    expect(bare.splitter.disconnect).toHaveBeenCalled();
    expect(bare.analysers.every((a) => a.disconnect.mock.calls.length === 1)).toBe(true);
    const settled = left.value;
    bare.analysers[0].level = 1;
    vi.advanceTimersByTime(1000);
    expect(left.value).toBe(settled);
  });

  test("stereo-to-mono is a pass-through, and toggling it is a no-op", async () => {
    const bare = bareAudio();
    const worklets = new WorkletManager(bare.manager);
    const stm = await worklets.createStereoToMonoProcessor();

    expect(stm.Value).toBe(bare.gain);
    expect(() => worklets.setEnabledVUNode(stm.Value, true)).not.toThrow();

    await stm.asyncDispose();
    expect(bare.gain.disconnect).toHaveBeenCalled();
  });
});
