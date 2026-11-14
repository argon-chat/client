import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { HotkeyHostBinding } from "@/lib/hotkeys/host";
vi.mock("@/lib/sk", () => ({ isSk: true }));
// Skathi's `appHotkeys`, as the Skathi build exposes it on the "vue" namespace.
const stubHotkeys = (hotkeys: object): void => {
  vi.stubEnv("SK", "true");
  vi.doMock("vue", async (importOriginal) => ({ ...(await importOriginal<typeof import("vue")>()), appHotkeys: hotkeys }));
};
// Cold transforms can exceed a test's timeout when all projects run together. Prepare the graph
// separately, then reset it so each test still captures its own native service stub.
beforeAll(async () => {
  await import("@/store/ui/hotKeyStore");
  vi.resetModules();
}, 60_000);
afterEach(() => { vi.doUnmock("vue"); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe("direct native hotkeys", () => {
  test("passes stored VK/raw chords directly and turns native release events into UI actions", async () => {
    let fire!: (event: { id: string; phase: "down" | "up" }) => void;
    const off = vi.fn();
    const setBindings = vi.fn(() => true);
    const status = { running: true, platform: "win32", accessibilityGranted: true, error: null, restarts: 0 };
    const capture = { buttons: [{ device: 0, code: 0xa3 }, { device: 0, code: 0x10000 | 0x0e1c }, { device: 1, code: 4 }] };
    stubHotkeys({
      setBindings, status: () => status, restart: () => true, captureOnce: () => Promise.resolve(capture),
      cancelCapture() {}, onFired(fn: typeof fire) { fire = fn; return off; },
    });
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
  test("the real store sends reactive saved and captured chords and forwards both hold edges", async () => {
    let fire!: (event: { id: string; phase: "down" | "up" }) => void;
    const off = vi.fn();
    const setBindings = vi.fn((_bindings: HotkeyHostBinding[]) => true);
    const captured = { buttons: [{ device: 1, code: 5 }] };
    stubHotkeys({
      setBindings,
      status: () => ({ running: true, platform: "win32", accessibilityGranted: true, error: null, restarts: 0 }),
      captureOnce: async () => captured,
      cancelCapture() {},
      onFired(fn: typeof fire) { fire = fn; return off; },
    });
    const { createPinia, setActivePinia } = await import("pinia");
    const { nextTick, isProxy } = await import("vue");
    const { default: superjson } = await import("superjson");
    const { useHotkeys } = await import("@/store/ui/hotKeyStore");
    localStorage.clear();
    const saved = { buttons: [{ device: 0, code: 0xa3 }, { device: 0, code: 0x4d }] };
    localStorage.setItem("hotkeys.bindings.v3", superjson.stringify({ "voice.pushToTalk": saved }));
    setActivePinia(createPinia());
    const store = useHotkeys();
    try {
      await nextTick();
      const initial = setBindings.mock.calls[setBindings.mock.calls.length - 1][0];
      expect(initial).toEqual([{ id: "voice.pushToTalk", chord: saved }]);
      expect(initial[0].chord).toBe(store.chordOf("voice.pushToTalk"));
      // Native conversion must respect Array.isArray even when JSC's concrete kind is Object.
      expect(isProxy(initial[0].chord.buttons)).toBe(true);
      expect(Array.isArray(initial[0].chord.buttons)).toBe(true);
      const edges: string[] = [];
      const subscription = store.onAction("voice.pushToTalk", (event) => edges.push(event.phase));
      fire({ id: "voice.pushToTalk", phase: "down" });
      fire({ id: "voice.pushToTalk", phase: "up" });
      expect(edges).toEqual(["down", "up"]);
      subscription.unsubscribe();
      await expect(store.captureFor("app.toggleWindow")).resolves.toBe("bound");
      await nextTick();
      const updated = setBindings.mock.calls[setBindings.mock.calls.length - 1][0];
      expect(updated.find((binding) => binding.id === "app.toggleWindow")?.chord).toEqual(captured);
      expect(superjson.parse<Record<string, unknown>>(localStorage.getItem("hotkeys.bindings.v3")!)["app.toggleWindow"]).toEqual(captured);
    } finally {
      store.$dispose();
      localStorage.clear();
    }
    expect(off).toHaveBeenCalledOnce();
  });
  test("capture cancellation errors retain a useful reason", async () => {
    stubHotkeys({ captureOnce: () => Promise.reject(new Error("hotkey capture cancelled")) });
    const { hotkeyHost, captureFailureReason } = await import("@/lib/hotkeys/host");
    const error = await hotkeyHost.captureOnce().catch((value) => value);
    expect(captureFailureReason(error)).toBe("cancelled");
  });
  test("window actions use the native app service without inventing SDK window methods", async () => {
    const toggle = vi.fn(() => true);
    const show = vi.fn(() => true);
    vi.stubGlobal("argon", { system: { window: { toggle, show } } });
    vi.stubGlobal("__SK_WINDOW__", { appWindow: {} });
    const { hotkeyHost } = await import("@/lib/hotkeys/host");
    expect(await hotkeyHost.toggleMainWindow()).toBe(true);
    expect(await hotkeyHost.showMainWindow()).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

});
