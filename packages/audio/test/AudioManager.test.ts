/**
 * AudioManagement bug fixes.
 *
 * happy-dom has no Web Audio, so the graph is faked here — but only the graph. Every
 * assertion is about the manager's own decisions: what it connects to what, when it
 * re-opens the microphone, and what it does after a failure. The fakes record
 * connections so the pipeline shape can be inspected, which is the only way to see
 * whether a suppressor or gate actually ended up in the chain.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── A recording Web Audio fake ──────────────────────────────────────

class FakeNode {
  outputs = new Set<FakeNode>();
  constructor(public kind: string) {}
  connect(target: FakeNode) { this.outputs.add(target); return target; }
  disconnect() { this.outputs.clear(); }
}

class FakeParam {
  value = 1;
  setTargetAtTime(v: number) { this.value = v; }
  setValueAtTime(v: number) { this.value = v; }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
  constructor() { super("gain"); }
}

class FakeWorkletNode extends FakeNode {
  port = { onmessage: null as unknown, close: vi.fn(), postMessage: vi.fn() };
  parameters = new Map<string, FakeParam>();
  constructor(_ctx: unknown, public name: string) {
    super(`worklet:${name}`);
    this.parameters.set("threshold", new FakeParam());
    this.parameters.set("enabled", new FakeParam());
  }
}

/**
 * A real MediaStream where the environment has one — happy-dom type-checks anything
 * assigned to `srcObject`, so a plain object is rejected by createAudioElement().
 */
function fakeStream(): MediaStream {
  const s: any = typeof MediaStream !== "undefined" ? new MediaStream() : {};
  s.getAudioTracks = () => [{ getSettings: () => ({ sampleRate: 48000 }), stop() {} }];
  s.getTracks = () => [{ stop() {} }];
  return s as MediaStream;
}

class FakeDestination extends FakeNode {
  stream: MediaStream;
  constructor() {
    super("stream-destination");
    this.stream = fakeStream();
  }
}

const state = vi.hoisted(() => ({
  /** Queue of results for getUserMedia; a string means "reject with this error name". */
  micResults: [] as (string | null)[],
  micCalls: 0,
  ctxDestination: null as any,
}));

function installWebAudio() {
  const analyser = () => Object.assign(new FakeNode("analyser"), {
    fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128,
    getByteFrequencyData() {}, getFloatTimeDomainData() {},
  });

  class FakeAudioContext extends FakeNode {
    sampleRate = 48000;
    state = "running";
    currentTime = 0;
    destination = new FakeNode("ctx-destination");
    audioWorklet = { addModule: vi.fn(async () => {}) };
    constructor() { super("ctx"); state.ctxDestination = this.destination; }
    createGain() { return new FakeGain(); }
    createAnalyser() { return analyser(); }
    createChannelSplitter() { return new FakeNode("splitter"); }
    createMediaStreamDestination() { return new FakeDestination(); }
    createMediaStreamSource() { return new FakeNode("mic-source"); }
    createMediaElementSource() { return new FakeNode("element-source"); }
    createOscillator() { return Object.assign(new FakeNode("osc"), { type: "", frequency: { value: 0 }, start() {}, stop() {} }); }
    createBiquadFilter() { return Object.assign(new FakeNode("filter"), { type: "", frequency: { value: 0 } }); }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }

  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const getUserMedia = vi.fn(async () => {
    state.micCalls++;
    const result = state.micResults.shift() ?? null;
    if (typeof result === "string") {
      const err: any = new Error(result);
      err.name = result;
      throw err;
    }
    return fakeStream();
  });

  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });

  return { getUserMedia };
}

vi.mock("@argon/core", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, logger: { info() {}, warn() {}, error() {}, debug() {} } };
});

import { AudioManagement } from "../src";

/** Follow the graph from `from`, reporting the node kinds reached, in order. */
function chainFrom(from: FakeNode): string[] {
  const path: string[] = [];
  let node: FakeNode | undefined = from;
  const seen = new Set<FakeNode>();
  while (node && !seen.has(node)) {
    seen.add(node);
    node = [...node.outputs][0];
    if (node) path.push(node.kind);
  }
  return path;
}

const managerInternals = (m: any) => ({
  gain: m.inputGainNode as FakeNode,
  destination: m.virtualStreamDestination as FakeNode,
});

let getUserMedia: ReturnType<typeof installWebAudio>["getUserMedia"];

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  state.micResults = [];
  state.micCalls = 0;
  ({ getUserMedia } = installWebAudio());
});

const make = (config: Record<string, unknown> = {}) =>
  new AudioManagement({ autoInitialize: false, ...config } as any);

// ── Tests ───────────────────────────────────────────────────────────

describe("processing configured before the pipeline exists still applies", () => {
  test("an input gate enabled at startup ends up in the chain", async () => {
    // Settings are restored during boot, long before anything acquires the mic. This
    // used to return early and the gate silently never engaged for the whole session.
    const m = make();
    await m.setInputGateEnabled(true);

    await m.acquireInput();

    const { gain } = managerInternals(m as any);
    expect(chainFrom(gain)).toEqual([
      "worklet:input-gate-processor",
      "stream-destination",
    ]);
  });

  test("without a gate the chain goes straight to the destination", async () => {
    const m = make();
    await m.acquireInput();
    expect(chainFrom(managerInternals(m as any).gain)).toEqual(["stream-destination"]);
  });

  test("disabling the gate afterwards takes it back out", async () => {
    const m = make();
    await m.setInputGateEnabled(true);
    await m.acquireInput();
    await m.setInputGateEnabled(false);

    expect(chainFrom(managerInternals(m as any).gain)).toEqual(["stream-destination"]);
  });
});

describe("a denied microphone is recoverable", () => {
  test("a failed init does not poison later attempts", async () => {
    // The cached rejected promise meant one denial broke the mic until a page reload,
    // despite the caller logging "will retry on first use".
    state.micResults = ["NotAllowedError"];
    const m = make();

    await expect(m.acquireInput()).rejects.toThrow();

    const stream = await m.acquireInput();
    expect(stream).toBeDefined();
    expect(m.isVirtualStreamInitialized()).toBe(true);
  });

  test("a retry reuses the destination node instead of stranding it", async () => {
    state.micResults = ["NotAllowedError"];
    const m = make();
    await expect(m.acquireInput()).rejects.toThrow();

    const first = managerInternals(m as any).destination;
    await m.acquireInput();

    expect(managerInternals(m as any).destination).toBe(first);
  });
});

describe("the microphone is not re-opened while idle", () => {
  test("changing constraints with no live mic does not reach getUserMedia", async () => {
    // On macOS this lit the system "microphone in use" indicator outside any call.
    const m = make({ releaseInputWhenIdle: true });
    await m.acquireInput();
    m.releaseInput(); // detaches the device

    const before = state.micCalls;
    await m.setAudioConstraints({ echoCancellation: false });

    expect(state.micCalls).toBe(before);
  });

  test("changing constraints while a mic is live does re-capture", async () => {
    const m = make();
    await m.acquireInput();

    const before = state.micCalls;
    await m.setAudioConstraints({ echoCancellation: false });

    expect(state.micCalls).toBe(before + 1);
  });
});

describe("the input reference count", () => {
  test("input monitoring holds a reference of its own", async () => {
    // Otherwise an unrelated release — a call ending — detaches the device under it.
    const m = make({ releaseInputWhenIdle: true });
    const monitor = await m.startInputMonitoring();

    await m.acquireInput();
    m.releaseInput(); // the call ends

    expect((m as any).currentMicStream).not.toBeNull();

    await monitor.asyncDispose();
    expect((m as any).currentMicStream).toBeNull();
  });

  test("a failed monitor start does not leak its reference", async () => {
    const m = make({ releaseInputWhenIdle: true });
    await m.acquireInput();
    m.releaseInput();

    expect((m as any).inputRefCount).toBe(0);
  });
});

describe("remote participant volume", () => {
  const track = () => ({ kind: "audio" }) as unknown as MediaStreamTrack;

  test("a participant subscribed while deafened can be heard again", async () => {
    // The graph latched its creation-time mute flag, so undeafening — which the caller
    // performs by setting the saved volume — could never restore this participant.
    const m = make();
    const graph = m.createRemoteAudioGraph({ track: track(), isMutedAll: true, initialVolume: 0 });

    expect((graph.gainNode as unknown as FakeGain).gain.value).toBe(0);

    graph.setVolume(100);
    expect((graph.gainNode as unknown as FakeGain).gain.value).toBe(1);
  });

  test("volume is still clamped to the supported range", async () => {
    const m = make();
    const graph = m.createRemoteAudioGraph({ track: track() });

    graph.setVolume(1000);
    expect((graph.gainNode as unknown as FakeGain).gain.value).toBe(2);

    graph.setVolume(-50);
    expect((graph.gainNode as unknown as FakeGain).gain.value).toBe(0);
  });

  test("speaking detection only runs when someone is listening for it", async () => {
    // Screen-share audio graphs deliberately have no speaking callback; a 60fps
    // analyser read per graph for a value nobody reads is pure waste.
    const m = make();
    const raf = globalThis.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>;

    raf.mockClear();
    m.createRemoteAudioGraph({ track: track() });
    expect(raf).not.toHaveBeenCalled();

    m.createRemoteAudioGraph({ track: track(), onSpeakingChange: () => {} });
    expect(raf).toHaveBeenCalled();
  });
});

describe("stored settings are not trusted blindly", () => {
  test("a corrupted volume falls back to the default instead of becoming NaN", async () => {
    // A NaN gain silences the entire graph, and nothing in the UI can undo it.
    localStorage.setItem("inputVolume", "not-a-number");
    localStorage.setItem("outputVolume", "Infinity");

    const m = make();
    expect(m.getInputVolume().value).toBe(100);
    expect(m.getOutputVolume().value).toBe(100);
  });

  test("an out-of-range volume is clamped", async () => {
    localStorage.setItem("inputVolume", "9000");
    localStorage.setItem("outputVolume", "-20");

    const m = make();
    expect(m.getInputVolume().value).toBe(100);
    expect(m.getOutputVolume().value).toBe(0);
  });
});
