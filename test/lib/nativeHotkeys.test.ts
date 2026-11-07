import { afterEach, describe, expect, test, vi } from "vitest";
vi.mock("@/lib/vn", () => ({ isVn: true }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe("direct native hotkeys", () => {
  test("passes stored VK/raw chords directly and turns native release events into UI actions", async () => {
    let fire!: (event: { id: string; phase: "down" | "up" }) => void;
    const off = vi.fn();
    const setBindings = vi.fn(() => true);
    const status = { running: true, platform: "win32", accessibilityGranted: true, error: null, restarts: 0 };
    const capture = { buttons: [{ device: 0, code: 0xa3 }, { device: 0, code: 0x10000 | 0x0e1c }, { device: 1, code: 4 }] };
    vi.stubGlobal("argon", { hotkeys: {
      setBindings, status: () => status, restart: () => true, captureOnce: () => Promise.resolve(capture),
      cancelCapture() {}, onFired(fn: typeof fire) { fire = fn; return off; },
    } });
    const { hotkeyHost } = await import("@/lib/hotkeys/host");
    expect(hotkeyHost.available).toBe(true);
    await hotkeyHost.setBindings([{ id: "voice.pushToTalk", chord: capture }]);
    expect(setBindings).toHaveBeenCalledWith([{ id: "voice.pushToTalk", chord: capture }]);
    expect(await hotkeyHost.captureOnce()).toEqual(capture);
    expect(await hotkeyHost.status()).toEqual(status);
    const accept = vi.fn();
    const dispose = hotkeyHost.onFired(accept);
    fire({ id: "voice.pushToTalk", phase: "down" });
    fire({ id: "voice.pushToTalk", phase: "up" });
    expect(accept.mock.calls).toEqual([["voice.pushToTalk", "down"], ["voice.pushToTalk", "up"]]);
    dispose?.();
    expect(off).toHaveBeenCalledTimes(1);
  });
  test("capture cancellation errors retain a useful reason", async () => {
    vi.stubGlobal("argon", { hotkeys: { captureOnce: () => Promise.reject(new Error("hotkey capture cancelled")) } });
    const { hotkeyHost, captureFailureReason } = await import("@/lib/hotkeys/host");
    const error = await hotkeyHost.captureOnce().catch((value) => value);
    expect(captureFailureReason(error)).toBe("cancelled");
  });
  test("window actions use the native app service without inventing SDK window methods", async () => {
    const toggle = vi.fn(() => true);
    const show = vi.fn(() => true);
    vi.stubGlobal("argon", { system: { window: { toggle, show } } });
    vi.stubGlobal("__VN_WINDOW__", { appWindow: {} });
    const { hotkeyHost } = await import("@/lib/hotkeys/host");
    expect(await hotkeyHost.toggleMainWindow()).toBe(true);
    expect(await hotkeyHost.showMainWindow()).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

});
