/**
 * The `argonIpc` no-op under vue-native: the DevTools toggle opens vue-native's inspector, through
 * the host function `appDevtools.open()` wraps, and says why when there is none to open.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/vn", () => ({ isVn: true }));

type Bridge = { invoke(service: string, method: string, args?: unknown[]): Promise<unknown> };

async function freshBridge(): Promise<Bridge> {
  delete (window as { argonIpc?: unknown }).argonIpc;
  vi.resetModules();
  await import("@/lib/vn/ipc");
  return (window as unknown as { argonIpc: Bridge }).argonIpc;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { argonIpc?: unknown }).argonIpc;
});

describe("HostProc.toggleDevTools under vue-native", () => {
  test("opens vue-native's inspector", async () => {
    const open = vi.fn(() => JSON.stringify({ opened: true, window: 3 }));
    vi.stubGlobal("__vn_devtools_open", open);
    const bridge = await freshBridge();

    await bridge.invoke("HostProc", "toggleDevTools", []);
    await bridge.invoke("HostProc", "toggleDevTools", []);
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("a refusal and a host without devtools are said in the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("__vn_devtools_open", () => JSON.stringify({ error: "devtools are disabled" }));
    let bridge = await freshBridge();
    await bridge.invoke("HostProc", "toggleDevTools", []);
    expect(warn).toHaveBeenLastCalledWith("[vue-native] DevTools: no inspector was opened: devtools are disabled");

    vi.stubGlobal("__vn_devtools_open", undefined);
    bridge = await freshBridge();
    await bridge.invoke("HostProc", "toggleDevTools", []);
    expect(warn).toHaveBeenLastCalledWith("[vue-native] DevTools: this host has no inspector to open");
  });

  test("everything else stays a no-op", async () => {
    const bridge = await freshBridge();
    expect(await bridge.invoke("HostProc", "getConfig", [])).toEqual([]);
    expect(await bridge.invoke("HostProc", "setOverlayBadge", [])).toBeUndefined();
  });
});

describe("answers callers check against null", () => {
  // HotKeySettings tests `status !== null && !status.running`; `undefined` crashed the tab.
  test("hotkeyStatus is null, which means no hotkey host", async () => {
    const bridge = await freshBridge();
    expect(await bridge.invoke("HostProc", "hotkeyStatus", [])).toBeNull();
  });
});
