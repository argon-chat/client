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
  const ctx = { currentTime: 0 } as unknown as AudioContext;
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
