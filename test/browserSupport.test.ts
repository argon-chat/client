import { afterEach, describe, expect, test, vi } from "vitest";
import { REQUIRED_CAPABILITIES } from "../src/lib/browserSupport";

const audioCapability = REQUIRED_CAPABILITIES.find(check => check.id === "audio_worklet")!;
afterEach(() => vi.unstubAllGlobals());

describe("audio processor capability", () => {
  test("native hosts require the compiled processor API, not a JS constructor", () => {
    vi.stubGlobal("window", { isSk: true, AudioContext: { prototype: { loadNativeAudioWorklet() {} } } });
    expect(audioCapability.present()).toBe(true);
    vi.stubGlobal("window", { isSk: true, AudioWorkletNode() {}, AudioContext: { prototype: {} } });
    expect(audioCapability.present()).toBe(false);
  });

  test("browser support continues to require AudioWorkletNode", () => {
    vi.stubGlobal("window", { AudioWorkletNode() {} });
    expect(audioCapability.present()).toBe(true);
    vi.stubGlobal("window", { AudioContext: { prototype: { loadNativeAudioWorklet() {} } } });
    expect(audioCapability.present()).toBe(false);
  });
});
