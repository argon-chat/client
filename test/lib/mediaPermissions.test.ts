/**
 * Microphone and camera permission over the host's `__VN_CAPTURE__` API.
 *
 * The regressions worth guarding: a banner that never shows (every join failing after one Block,
 * with nothing to lift it), and a call path that prompts on its own, which would show a second
 * prompt right after a dismissal or re-ask from a Block that only the Grant button may lift.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MediaPermission, MediaPermissionStatus } from "@/lib/mediaPermissions";

vi.mock("@argon/core", () => ({ logger: { debug() {}, info() {}, warn() {}, error() {} } }));

import {
  ensureMediaPermission,
  isMediaPermissionGranted,
  needsMediaPermissionGate,
  needsPermissionBanner,
  readMediaPermission,
  requestMediaPermission,
  watchMediaPermission,
} from "@/lib/mediaPermissions";

const status = (state: MediaPermissionStatus["state"], deniedBySystem = false): MediaPermissionStatus =>
  ({ state, canRequest: state === "prompt" || state === "denied", deniedBySystem });

const states: Record<MediaPermission, MediaPermissionStatus> = { microphone: status("granted"), camera: status("granted") };
const host = {
  permission: vi.fn((source: MediaPermission) => states[source]),
  requestPermission: vi.fn(async (_source: MediaPermission) => "granted"),
};
const g = globalThis as { __VN_CAPTURE__?: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  states.microphone = status("granted");
  states.camera = status("granted");
  g.__VN_CAPTURE__ = host;
});
afterEach(() => { delete g.__VN_CAPTURE__; });

describe("without the host permission API", () => {
  test("the browser has no gate and reports granted", async () => {
    delete g.__VN_CAPTURE__;
    expect(needsMediaPermissionGate()).toBe(false);
    expect(readMediaPermission("microphone").state).toBe("granted");
    expect(await isMediaPermissionGranted("camera")).toBe(true);
    expect(await ensureMediaPermission("microphone")).toBe(true);
  });

  test("an older host without permission() is treated the same", async () => {
    g.__VN_CAPTURE__ = { requestPermission: host.requestPermission };
    expect(needsMediaPermissionGate()).toBe(false);
    expect(needsPermissionBanner(readMediaPermission("microphone"))).toBe(false);
    expect(await ensureMediaPermission("camera")).toBe(true);
  });
});

describe("reading the host's state", () => {
  test("granted and unsupported show no banner; prompt and denied do", async () => {
    expect(needsMediaPermissionGate()).toBe(true);
    for (const [state, banner, granted] of [
      ["granted", false, true],
      ["unsupported", false, true],
      ["prompt", true, false],
      ["denied", true, false],
    ] as const) {
      states.camera = status(state);
      expect(readMediaPermission("camera").state).toBe(state);
      expect(needsPermissionBanner(readMediaPermission("camera"))).toBe(banner);
      expect(await isMediaPermissionGranted("camera")).toBe(granted);
    }
    expect(host.permission).toHaveBeenCalledWith("camera");
  });

  test("a system denial is told apart from the user's Block", () => {
    states.microphone = status("denied", true);
    expect(readMediaPermission("microphone").deniedBySystem).toBe(true);
    states.microphone = status("denied");
    expect(readMediaPermission("microphone").deniedBySystem).toBe(false);
  });
});

describe("before capture", () => {
  test("never requests, and lets capture go on unless denied", async () => {
    for (const [state, allowed] of [["granted", true], ["unsupported", true], ["prompt", true], ["denied", false]] as const) {
      states.microphone = status(state);
      states.camera = status(state, state === "denied");
      expect(await ensureMediaPermission("microphone")).toBe(allowed);
      expect(await ensureMediaPermission("camera")).toBe(allowed);
    }
    expect(host.requestPermission).not.toHaveBeenCalled();
  });
});

describe("the banner's button", () => {
  test("requests the right source and returns the state read afterwards", async () => {
    states.microphone = status("denied", true);
    host.requestPermission.mockImplementationOnce(async (source) => {
      states[source] = status("granted");
      return "granted";
    });
    const result = await requestMediaPermission("microphone");
    expect(host.requestPermission).toHaveBeenCalledExactlyOnceWith("microphone");
    expect(result).toEqual(status("granted"));

    states.camera = status("denied");
    host.requestPermission.mockImplementationOnce(async () => "denied");
    expect((await requestMediaPermission("camera")).state).toBe("denied");
    expect(host.requestPermission).toHaveBeenLastCalledWith("camera");
  });
});

describe("watching for changes", () => {
  test("calls back with a fresh status on change, and not after unsubscribing", async () => {
    const target = new EventTarget();
    const query = vi.fn(async () => target);
    const permissions = Object.getOwnPropertyDescriptor(navigator, "permissions");
    Object.defineProperty(navigator, "permissions", { configurable: true, value: { query } });
    try {
      const seen: string[] = [];
      const stop = watchMediaPermission("microphone", (s) => seen.push(s.state));
      await Promise.resolve();
      await Promise.resolve();
      expect(query).toHaveBeenCalledWith({ name: "microphone" });
      states.microphone = status("denied");
      target.dispatchEvent(new Event("change"));
      stop();
      target.dispatchEvent(new Event("change"));
      expect(seen).toEqual(["denied"]);
    } finally {
      if (permissions) Object.defineProperty(navigator, "permissions", permissions);
      else delete (navigator as { permissions?: unknown }).permissions;
    }
  });
});
