import { describe, expect, test, vi } from "vitest";
import { createCameraDeviceState } from "../src/cameraDevices";

const camera = (deviceId: string) => ({ deviceId, kind: "videoinput", label: deviceId, groupId: "" }) as MediaDeviceInfo;

function setup(authoritative = true) {
  const listeners = new Set<() => void>();
  const md = {
    __skVideoEnumerationAuthoritative: authoritative,
    enumerateDevices: vi.fn(async (): Promise<MediaDeviceInfo[]> => []),
    addEventListener: vi.fn((_type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener) => listeners.delete(listener)),
  };
  const state = createCameraDeviceState({ mediaDevices: () => md as any, permissionGranted: async () => false });
  return { state, md, listeners };
}

describe("camera availability", () => {
  test("only a completed authoritative empty list disables the camera", async () => {
    const { state } = setup();
    expect(state.unavailable.value).toBe(false);
    await state.refresh();
    expect(state.unavailable.value).toBe(true);
    const browser = setup(false);
    await browser.state.refresh();
    expect(browser.state.unavailable.value).toBe(false);
    expect(browser.state.confirmed.value).toBe(false);
  });

  test("permission-blocked or failed enumeration remains unknown, retaining the last device list", async () => {
    const { state, md } = setup();
    md.enumerateDevices.mockResolvedValue([camera("obs")]);
    await state.refresh();
    md.enumerateDevices.mockRejectedValue(Object.assign(new Error("Access denied"), { name: "NotAllowedError" }));
    await state.refresh();
    expect(state.unavailable.value).toBe(false);
    expect(state.confirmed.value).toBe(false);
    expect(state.devices.value.map((d) => d.deviceId)).toEqual(["obs"]);
    expect(state.error.value).toMatchObject({ name: "NotAllowedError" });
    expect(state.resolveDevice("old-camera")).toBe("old-camera");
  });

  test("a native camera is available before access is granted", async () => {
    const { state, md } = setup();
    md.enumerateDevices.mockResolvedValue([camera("obs")]);
    await state.refresh();
    expect(state.unavailable.value).toBe(false);
    expect(state.resolveDevice("obs")).toBe("obs");
  });

  test("falls back from a saved device only when a complete successful list confirms it disappeared", async () => {
    const { state, md } = setup();
    expect(state.resolveDevice("old-camera")).toBe("old-camera");
    md.enumerateDevices.mockResolvedValue([camera("obs")]);
    await state.refresh();
    expect(state.resolveDevice("old-camera")).toBe("obs");
    expect(state.resolveDevice("obs")).toBe("obs");
  });

  test("hotplug refreshes availability and dispose removes the subscription", async () => {
    const { state, md, listeners } = setup();
    state.start();
    await state.refresh();
    expect(state.unavailable.value).toBe(true);
    md.enumerateDevices.mockResolvedValue([camera("obs")]);
    for (const changed of listeners) changed();
    await state.refresh();
    expect(state.unavailable.value).toBe(false);
    expect(state.devices.value.map((d) => d.deviceId)).toEqual(["obs"]);
    state.dispose();
    expect(listeners.size).toBe(0);
  });
});
