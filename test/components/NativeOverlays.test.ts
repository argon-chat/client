import { beforeEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { defaultHudConfig } from "@/lib/overlay/layout";

const h = vi.hoisted(() => ({ settings: null as any, game: null as any, changed: null as any, off: vi.fn(), mainScale: 1 }));
vi.mock("@/lib/sk", () => ({ isSk: true }));
vi.mock("@/lib/sk/window", () => ({ appWindow: { get scaleFactor() { return h.mainScale; } } }));
vi.mock("@/lib/sk/skWindow", async () => {
  const { defineComponent, h: node } = await import("vue");
  return { SkWindow: defineComponent({
    name: "NativeWindowStub",
    props: ["title", "chrome", "backdrop", "cover", "monitor", "alwaysOnTop", "focusable", "ignoreMouseEvents", "contentProtection", "taskbar", "activate", "resizable", "titleBarHeight", "bounds"],
    setup(props, { slots }) { return () => node("section", { "data-window": props.title }, slots.default?.()); },
  }) };
});
vi.mock("@/lib/shell/host", () => ({ shell: { activity: {
  window: () => h.game,
  list: () => [{ pid: 42, path: "c:/game.exe", name: "Game" }],
  onWindowChanged: (fn: unknown) => { h.changed = fn; return h.off; },
} } }));
vi.mock("@/store/features/gameOverlaySettingsStore", () => ({
  useGameOverlaySettings: () => h.settings,
  normalizeGameId: (path: string) => path.toLowerCase(),
}));
vi.mock("@/components/overlays/NativeGameHud.vue", () => ({ default: { template: "<div data-hud />" } }));
vi.mock("@/components/screencast-overlay/ScreencastDrawWindow.vue", () => ({
  default: { props: ["surfaceWidth", "surfaceHeight"], template: "<canvas data-strokes />" },
}));
import NativeOverlays from "@/components/overlays/NativeOverlays.vue";
import { hudVoice, drawingTarget } from "@/lib/shell/overlays";

beforeEach(() => {
  h.off.mockClear();
  h.mainScale = 1;
  h.game = { pid: 42, hwnd: "99", monitorIndex: 1, x: 0, y: 0, w: 1920, h: 1080, foreground: false };
  h.settings = reactive({ overlayEnabled: true, games: {} as Record<string, any>, snapshot: () => ({ hud: defaultHudConfig() }) });
  hudVoice.value = { inVoice: true, members: [] };
  drawingTarget.value = null;
});
describe("native overlay windows", () => {
  test("game HUD follows foreground and per-game settings, and releases native subscription", async () => {
    const wrapper = mount(NativeOverlays);
    expect(wrapper.find("section").exists()).toBe(false);
    h.changed({ ...h.game, foreground: true });
    await nextTick();
    const win = wrapper.findComponent({ name: "NativeWindowStub" });
    expect(win.props()).toMatchObject({ monitor: 1, cover: "monitor", backdrop: "transparent", alwaysOnTop: true, focusable: false, ignoreMouseEvents: true, taskbar: true });
    expect(wrapper.find("[data-hud]").exists()).toBe(true);
    h.settings.games["c:/game.exe"] = { overlayEnabled: false };
    await nextTick();
    expect(wrapper.find("section").exists()).toBe(false);
    wrapper.unmount();
    expect(h.off).toHaveBeenCalledTimes(1);
  });
  test("drawing uses exact logical window bounds and updates them without replacing the window", async () => {
    drawingTarget.value = { monitorIndex: 1, x: 200, y: 100, w: 640, h: 480, scaleFactor: 1.5 };
    const wrapper = mount(NativeOverlays);
    const win = wrapper.findComponent({ name: "NativeWindowStub" });
    const instance = win.vm;
    expect(win.props()).toMatchObject({ bounds: { x: 200, y: 100, width: 640, height: 480 }, contentProtection: true, focusable: false, ignoreMouseEvents: true, taskbar: true });
    drawingTarget.value = { ...drawingTarget.value, x: 300 };
    await nextTick();
    expect(wrapper.findComponent({ name: "NativeWindowStub" }).vm).toBe(instance);
    expect(win.props("bounds").x).toBe(300);
    h.mainScale = 2;
    drawingTarget.value = { ...drawingTarget.value };
    await nextTick();
    expect(win.props("bounds")).toEqual({ x: 150, y: 50, width: 320, height: 240 });
    wrapper.unmount();
    expect(drawingTarget.value).toBeNull();
  });
});
