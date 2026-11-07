import { describe, test, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("native drawing lifecycle", () => {
  test("follows the selected window, scales its exact bounds and stops polling when the source disappears", async () => {
    vi.useFakeTimers();
    let target: any = { monitorIndex: 1, x: -1200, y: 100, w: 900, h: 600, scaleFactor: 1.5 };
    const resolve = vi.fn(() => target);
    vi.stubGlobal("argon", { capture: { target: resolve } });
    vi.stubGlobal("__VN_WINDOW__", { appWindow: { scaleFactor: 1 } });
    const overlay = await import("@/lib/shell/overlays");
    overlay.startNativeDrawing("window:123");
    expect(resolve).toHaveBeenCalledWith("window:123");
    expect(overlay.targetBounds(overlay.drawingTarget.value!)).toEqual({ x: -1200, y: 100, width: 900, height: 600 });
    target = { ...target, x: -900 };
    await vi.advanceTimersByTimeAsync(350);
    expect(overlay.targetBounds(overlay.drawingTarget.value!)).toEqual({ x: -900, y: 100, width: 900, height: 600 });
    target = null;
    await vi.advanceTimersByTimeAsync(350);
    expect(overlay.drawingTarget.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("stop and source changes cannot keep an old capture alive or deliver late strokes", async () => {
    vi.useFakeTimers();
    const resolve = vi.fn(() => ({ monitorIndex: 0, x: 0, y: 0, w: 100, h: 100 }));
    vi.stubGlobal("argon", { capture: { target: resolve } });
    vi.stubGlobal("__VN_WINDOW__", { appWindow: { scaleFactor: 1 } });
    const overlay = await import("@/lib/shell/overlays");
    const accept = vi.fn();
    const off = overlay.onNativeStroke(accept);
    overlay.startNativeDrawing("screen:1");
    overlay.startNativeDrawing("window:2");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(350);
    expect(resolve).toHaveBeenLastCalledWith("window:2");
    const packet: any = { kind: "clear", v: 1, from: "viewer", target: "me", t: 0 };
    overlay.applyNativeStroke(packet);
    expect(accept).toHaveBeenCalledTimes(1);
    overlay.stopNativeDrawing();
    overlay.applyNativeStroke(packet);
    expect(accept).toHaveBeenCalledTimes(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an invalid source never falls back to the primary display", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("argon", { capture: { target: () => null } });
    const overlay = await import("@/lib/shell/overlays");
    overlay.startNativeDrawing("window:404");
    expect(overlay.drawingTarget.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
