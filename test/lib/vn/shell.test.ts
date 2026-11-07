import { describe, test, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/vn", () => ({ isVn: true }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); localStorage.clear(); });
describe("native desktop services", () => {
  test("boot preserves the direct native namespace and installs no IPC bridge", async () => {
    vi.stubGlobal("isVn", true);
    const direct = { idle: { getTime: () => ({ idleMs: 42 }) } };
    vi.stubGlobal("argon", direct);
    delete (window as any).argonIpc;
    vi.stubGlobal("__VN_WINDOW__", { appWindow: { backdrop: "mica", theme: "system" } });
    await import("@/lib/vn/bootstrap");
    const glue = await import("@argon/glue");
    expect(window.argon).toBe(direct);
    expect("native" in glue).toBe(false);
    expect("createIpcClient" in glue).toBe(false);
    expect((window as any).argonIpc).toBeUndefined();
  });

  test("idle is a direct synchronous native snapshot; capture and devtools use SDK operations", async () => {
    const getTime = vi.fn(() => ({ idleMs: 3200 }));
    const getSources = vi.fn(async () => [{ id: "screen:1" }]);
    const setPendingSource = vi.fn(() => true);
    const open = vi.fn(() => JSON.stringify({ opened: true }));
    vi.stubGlobal("argon", { idle: { getTime } });
    vi.stubGlobal("__VN_CAPTURE__", { getSources, setPendingSource });
    vi.stubGlobal("__vn_devtools_open", open);
    const desktop = await import("@/lib/shell/desktop");
    const { shell } = await import("@/lib/shell/host");
    expect(shell.idle.getTime()).toEqual({ idleMs: 3200 });
    expect(await desktop.idleSeconds()).toBe(3);
    expect(await desktop.screenSources(["screen"], { withIcons: false })).toEqual([{ id: "screen:1" }]);
    await desktop.selectCaptureSource("screen:1", true);
    desktop.openDevtools();
    expect(getSources).toHaveBeenCalledWith(["screen"], { withIcons: false });
    expect(setPendingSource).toHaveBeenCalledWith("screen:1", true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  test("invalid SDK selection rejects and disabled devtools explains the refusal", async () => {
    vi.stubGlobal("__VN_CAPTURE__", { setPendingSource: () => false });
    vi.stubGlobal("__vn_devtools_open", () => JSON.stringify({ error: "devtools are disabled" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const desktop = await import("@/lib/shell/desktop");
    await expect(desktop.selectCaptureSource("window:0", false)).rejects.toThrow("invalid");
    desktop.openDevtools();
    expect(warn).toHaveBeenCalledWith("[devtools]", "devtools are disabled");
  });
});
