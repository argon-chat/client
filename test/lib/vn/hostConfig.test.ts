/**
 * The Electron shell's own config under vue-native (src/lib/vn/hostConfig.ts), reached the way
 * configStore and AppearanceSettings reach it: typed desktopConfig operations. Same three keys and
 * rules as ArgonApp's NativeConfigStore. Theme and WindowMaterial drive vue-native's `appWindow`, and
 * the values survive a relaunch.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigValueType, type ConfigSection, type ConfigUpdate } from "@/lib/shell/configTypes";

vi.mock("@/lib/vn", () => ({ isVn: true }));

type Bridge = typeof import("@/lib/shell/desktop");
type Win = { backdrop: string; theme?: string };

/** A fresh launch: the module graph re-evaluates against `win` and whatever localStorage holds. */
async function launch(win: Win): Promise<Bridge> {
  vi.stubGlobal("__VN_WINDOW__", { appWindow: win });
  vi.resetModules();
  await import("@/lib/vn/bootstrap");
  return import("@/lib/shell/desktop");
}

const req = (section: string, key: string, v: Partial<ConfigUpdate>): ConfigUpdate => ({
  section,
  key,
  valueB: null,
  valueStr: null,
  valueNum: null,
  valueEnum: null,
  valueF: null,
  ...v,
});

const set = (bridge: Bridge, r: ConfigUpdate) =>
  bridge.desktopConfig.update(r) as Promise<{ value: { valueB: boolean | null; valueStr: string | null; valueEnum: string | null } | null }>;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("application config", () => {
  test("NativeConfigStore's three keys, WindowMaterial defaulting to the window's own backdrop", async () => {
    const bridge = await launch({ backdrop: "mica", theme: "system" });
    const sections = (await bridge.desktopConfig.read()) as ConfigSection[];
    expect(sections.map((s) => [s.section, s.keys.map((k) => k.key)])).toEqual([
      ["app", ["DevMode"]],
      ["appearance", ["Theme", "WindowMaterial"]],
    ]);
    const [devMode, theme, material] = sections.flatMap((s) => s.keys);
    expect([devMode.type, devMode.valueB]).toEqual([ConfigValueType.Boolean, false]);
    expect([theme.type, theme.valueStr]).toEqual([ConfigValueType.String, "Dark"]);
    expect([material.type, material.valueEnum, material.valueEnumVariants]).toEqual([
      ConfigValueType.Enum,
      "mica",
      ["acrylic", "mica", "solid"],
    ]);
    for (const k of [devMode, theme, material]) expect([k.requiredToRestartApp, k.onlyForDevMode]).toEqual([false, false]);
  });
});

describe("at launch, as the Electron shell does at window creation", () => {
  test("Theme's default makes the window dark, and an unsaved WindowMaterial leaves the backdrop alone", async () => {
    const win: Win = { backdrop: "mica", theme: "system" };
    await launch(win);
    expect(win).toEqual({ backdrop: "mica", theme: "dark" });
  });

  test("saved values are applied on the next launch", async () => {
    let win: Win = { backdrop: "mica", theme: "system" };
    let bridge = await launch(win);
    await set(bridge, req("appearance", "WindowMaterial", { valueEnum: "acrylic" }));
    await set(bridge, req("appearance", "Theme", { valueStr: "White" }));
    await set(bridge, req("app", "DevMode", { valueB: true }));

    win = { backdrop: "mica", theme: "system" };
    bridge = await launch(win);
    expect(win).toEqual({ backdrop: "acrylic", theme: "light" });
    const sections = (await bridge.desktopConfig.read()) as ConfigSection[];
    expect(sections.flatMap((s) => s.keys).map((k) => k.valueB ?? k.valueStr ?? k.valueEnum)).toEqual([true, "White", "acrylic"]);
  });
});

describe("application preference updates", () => {
  test("WindowMaterial drives the backdrop; solid is no backdrop", async () => {
    const win: Win = { backdrop: "mica", theme: "system" };
    const bridge = await launch(win);
    expect((await set(bridge, req("appearance", "WindowMaterial", { valueEnum: "acrylic" }))).value?.valueEnum).toBe("acrylic");
    expect(win.backdrop).toBe("acrylic");
    await set(bridge, req("appearance", "WindowMaterial", { valueEnum: "solid" }));
    expect(win.backdrop).toBe("none");
    await set(bridge, req("appearance", "WindowMaterial", { valueEnum: "mica" }));
    expect(win.backdrop).toBe("mica");
  });

  test("Theme maps as main.ts maps it: White is light, System follows the OS, the rest is dark", async () => {
    const win: Win = { backdrop: "mica", theme: "system" };
    const bridge = await launch(win);
    const seen: string[] = [];
    for (const t of ["White", "System", "OLED", "Dark"]) {
      expect((await set(bridge, req("appearance", "Theme", { valueStr: t }))).value?.valueStr).toBe(t);
      seen.push(win.theme!);
    }
    expect(seen).toEqual(["light", "system", "dark", "dark"]);
  });

  test("an unknown key, an unknown section and a value outside the variants fail, as in Electron, and say why", async () => {
    const win: Win = { backdrop: "mica", theme: "system" };
    const bridge = await launch(win);
    expect(await set(bridge, req("appearance", "Zoom", { valueF: 1.5 }))).toEqual({
      value: null,
      error: "appearance.Zoom is not a config key",
    });
    expect(await set(bridge, req("audio", "DevMode", { valueB: true }))).toEqual({
      value: null,
      error: "audio.DevMode is not a config key",
    });
    expect(await set(bridge, req("appearance", "WindowMaterial", { valueEnum: "glass" }))).toEqual({
      value: null,
      error: 'appearance.WindowMaterial cannot be "glass" here; it takes acrylic, mica, solid',
    });
    expect(win.backdrop).toBe("mica");
  });

  test("a refused update does not block the next one", async () => {
    const win: Win = { backdrop: "mica", theme: "system" };
    const bridge = await launch(win);
    expect((await set(bridge, req("appearance", "WindowMaterial", { valueEnum: "glass" }))).value).toBeNull();
    expect((await set(bridge, req("appearance", "WindowMaterial", { valueEnum: "acrylic" }))).value?.valueEnum).toBe("acrylic");
    expect(win.backdrop).toBe("acrylic");
  });

  test("a host without appWindow.theme stores Theme, reports it back, and says once that it cannot apply it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = await launch({ backdrop: "mica" });
    expect((await set(bridge, req("appearance", "Theme", { valueStr: "White" }))).value?.valueStr).toBe("White");
    await set(bridge, req("appearance", "Theme", { valueStr: "Dark" }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("appearance.Theme");
  });
});

describe("macOS: one material, glass", () => {
  const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
  });

  test("glass and solid are the variants, and vn.config.json's acrylic window reads as glass", async () => {
    const bridge = await launch({ backdrop: "acrylic", theme: "system" });
    const material = ((await bridge.desktopConfig.read()) as ConfigSection[]).flatMap((s) => s.keys)[2];
    expect([material.valueEnum, material.valueEnumVariants]).toEqual(["glass", ["glass", "solid"]]);
  });

  /**
   * The reported sequence, as AppearanceSettings drives it: `applyMaterial` applies through
   * `setWindowMaterial`, then saves through WindowMaterial. Light, dark, OLED (which forces solid),
   * then theme and material flips. Glass used to map to `none` and to be refused as a variant, so
   * the first OLED left the window solid for good and every later glass logged "Config update failed".
   */
  test("light → dark → OLED → back, then flips: every step applies and saves", async () => {
    const win: Win = { backdrop: "acrylic", theme: "system" };
    const bridge = await launch(win);
    const applyMaterial = async (mat: string) => {
      await bridge.setWindowMaterial(mat === "solid" ? "none" : mat);
      return set(bridge, req("appearance", "WindowMaterial", { valueEnum: mat }));
    };
    await set(bridge, req("appearance", "Theme", { valueStr: "White" }));
    await set(bridge, req("appearance", "Theme", { valueStr: "Dark" }));
    const steps: [string, string][] = [
      ["solid", "none"], // OLED forces solid
      ["glass", "acrylic"], // leaving OLED restores the saved choice
      ["solid", "none"],
      ["glass", "acrylic"],
      ["glass", "acrylic"], // the same value again is not a failure
      ["solid", "none"],
      ["glass", "acrylic"],
    ];
    for (const [mat, backdrop] of steps) {
      expect((await applyMaterial(mat)).value?.valueEnum).toBe(mat);
      expect(win.backdrop).toBe(backdrop);
    }

    // And the last choice is the one the next launch opens with.
    const next: Win = { backdrop: "acrylic", theme: "system" };
    await launch(next);
    expect(next).toEqual({ backdrop: "acrylic", theme: "dark" });
  });

  test("the store's error names what was refused", async () => {
    await launch({ backdrop: "acrylic", theme: "system" });
    const { setActivePinia, createPinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useConfigStore } = await import("@/store/ui/configStore");
    await expect(useConfigStore().setWindowMaterial("mica")).rejects.toThrow(
      'Config update failed: appearance.WindowMaterial cannot be "mica" here; it takes glass, solid',
    );
    await expect(useConfigStore().setWindowMaterial("glass")).resolves.toBeUndefined();
  });
});

describe("a material the window cannot draw", () => {
  type LiveWin = EventTarget & Win & { effectiveBackdrop: string };
  const liveWindow = (backdrop: string): LiveWin =>
    Object.assign(new EventTarget(), { backdrop, effectiveBackdrop: backdrop, theme: "system" });

  afterEach(() => document.documentElement.classList.remove("backdrop-suspended"));

  test("macOS fullscreen without a desktop picture: the page takes the theme background, and gives it back on leaving", async () => {
    const win = liveWindow("acrylic");
    await launch(win);
    const suspended = () => document.documentElement.classList.contains("backdrop-suspended");
    expect(suspended()).toBe(false);
    for (let i = 0; i < 3; i++) {
      win.effectiveBackdrop = "none"; // entering fullscreen, the picture unreadable
      win.dispatchEvent(new Event("backdropchange"));
      expect(suspended()).toBe(true);
      win.effectiveBackdrop = "acrylic"; // leaving it
      win.dispatchEvent(new Event("backdropchange"));
      expect(suspended()).toBe(false);
    }
  });

  test("macOS fullscreen with the desktop picture under the glass keeps the page transparent", async () => {
    const win = liveWindow("acrylic");
    await launch(win);
    // The SDK keeps drawing the glass, so `effectiveBackdrop` stays `backdrop`.
    win.dispatchEvent(new Event("fullscreenchange"));
    win.dispatchEvent(new Event("backdropchange"));
    expect(document.documentElement.classList.contains("backdrop-suspended")).toBe(false);
  });

  test("solid is not a suspended material, and an SDK without effectiveBackdrop changes nothing", async () => {
    const solid = liveWindow("none");
    await launch(solid);
    solid.dispatchEvent(new Event("backdropchange"));
    expect(document.documentElement.classList.contains("backdrop-suspended")).toBe(false);

    const old = Object.assign(new EventTarget(), { backdrop: "acrylic", theme: "system" });
    await launch(old);
    old.dispatchEvent(new Event("backdropchange"));
    expect(document.documentElement.classList.contains("backdrop-suspended")).toBe(false);
  });
});

describe("SDK window material", () => {
  test("acrylic, mica or none, and anything else is none", async () => {
    const win: Win = { backdrop: "mica", theme: "system" };
    const bridge = await launch(win);
    for (const [asked, got] of [["acrylic", "acrylic"], ["none", "none"], ["mica", "mica"], ["glass", "none"]]) {
      expect(await bridge.setWindowMaterial(asked)).toBe(true);
      expect(win.backdrop).toBe(got);
    }
  });
});
