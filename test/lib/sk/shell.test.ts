import { describe, test, expect, vi, beforeAll, afterEach } from "vitest";

const idle = vi.hoisted(() => ({ ms: vi.fn(() => 3200) }));
const inspector = vi.hoisted(() => ({ available: true, open: vi.fn(() => true) }));
vi.mock("vue", async importOriginal => ({ ...await importOriginal<typeof import("vue")>(), appDevtools: inspector }));
vi.mock("@/lib/sk", () => ({ isSk: true }));
vi.mock("native:system", () => ({ available: true, idleMs: idle.ms }));

// Cold transforms of the generated server contracts can exceed the behavior test's
// budget under CI load. Reset evaluation afterwards so bootstrap still binds fresh stubs.
beforeAll(async () => {
  vi.stubGlobal("isSk", true);
  vi.stubGlobal("__SK_WINDOW__", { appWindow: { backdrop: "mica", theme: "system" } });
  try {
    await import("@/lib/sk/bootstrap");
    await import("@argon/glue");
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
    localStorage.clear();
  }
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  inspector.available = true;
  inspector.open.mockClear();
  localStorage.clear();
});
describe("native desktop services", () => {
  test("boot installs no IPC bridge", async () => {
    vi.stubGlobal("isSk", true);
    delete (window as any).argonIpc;
    vi.stubGlobal("__SK_WINDOW__", { appWindow: { backdrop: "mica", theme: "system" } });
    await import("@/lib/sk/bootstrap");
    const glue = await import("@argon/glue");
    expect("native" in glue).toBe(false);
    expect("createIpcClient" in glue).toBe(false);
    expect((window as any).argonIpc).toBeUndefined();
  });

  test("idle is a synchronous native:system call; capture and devtools use SDK operations", async () => {
    const getSources = vi.fn(async () => [{ id: "screen:1" }]);
    const setPendingSource = vi.fn(() => true);
    vi.stubEnv("SK", "true");
    vi.stubGlobal("__SK_CAPTURE__", { getSources, setPendingSource });
    const desktop = await import("@/lib/shell/desktop");
    expect(await desktop.idleSeconds()).toBe(3);
    expect(idle.ms).toHaveBeenCalledTimes(1);
    expect(await desktop.screenSources(["screen"], { withIcons: false })).toEqual([{ id: "screen:1" }]);
    await desktop.selectCaptureSource("screen:1", true);
    desktop.openDevtools();
    expect(getSources).toHaveBeenCalledWith(["screen"], { withIcons: false });
    expect(setPendingSource).toHaveBeenCalledWith("screen:1", true);
    expect(desktop.devtoolsAvailable).toBe(true);
    expect(inspector.open).toHaveBeenCalledTimes(1);
  });

  test("invalid capture selection rejects and the release host exposes no inspector", async () => {
    vi.stubEnv("SK", "true");
    inspector.available = false;
    vi.stubGlobal("__SK_CAPTURE__", { setPendingSource: () => false });
    const desktop = await import("@/lib/shell/desktop");
    await expect(desktop.selectCaptureSource("window:0", false)).rejects.toThrow("invalid");
    desktop.openDevtools();
    expect(desktop.devtoolsAvailable).toBe(false);
    expect(inspector.open).not.toHaveBeenCalled();
  });
});
