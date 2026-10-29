/**
 * `argon://` links under vue-native: what its `launchQueue` delivers reaches handleDeepLink, the
 * process's own launch and every forwarded one; a launch without a link is nothing.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ openInvitePreview: vi.fn(), openSettings: vi.fn() }));

vi.mock("@/lib/vn", () => ({ isVn: true }));
vi.mock("@/store/ui/windowStore", () => ({
  useWindow: () => ({ openInvitePreview: h.openInvitePreview, openSettings: h.openSettings }),
}));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {}, log() {}, debug() {} } }));

type Consumer = (params: { targetURL?: string | null }) => void;

let consumer: Consumer | null = null;

beforeEach(() => {
  consumer = null;
  h.openInvitePreview.mockReset();
  vi.stubGlobal("launchQueue", { setConsumer: (fn: Consumer) => (consumer = fn) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deep links under vue-native", () => {
  test("initDeepLinks takes the launch queue, and its links open what they name", async () => {
    vi.resetModules();
    const { initDeepLinks } = await import("@/lib/deeplink");
    initDeepLinks();
    expect(consumer).toBeTypeOf("function");

    consumer!({ targetURL: "argon://invite/abc123" });
    consumer!({ targetURL: null });
    consumer!({ targetURL: "argon://i/xyz" });
    expect(h.openInvitePreview.mock.calls).toEqual([["abc123"], ["xyz"]]);
  });

  test("no launchQueue: one warning, nothing else", async () => {
    vi.stubGlobal("launchQueue", undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { forwardLaunchLinks } = await import("@/lib/vn/launch");
    const open = vi.fn();
    forwardLaunchLinks(open);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
