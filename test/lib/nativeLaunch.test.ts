import { afterEach, describe, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({ open: vi.fn(), sdk: null as any, host: null as any, pending: vi.fn(() => ["argon://invite/ABC-DEF-GHI"]), subscribe: vi.fn() }));
vi.mock("@/lib/sk", () => ({ isSk: true }));
vi.mock("@/lib/sk/launch", () => ({ forwardLaunchLinks: (fn: unknown) => { h.sdk = fn; } }));
vi.mock("@/lib/shell/host", () => ({ shell: { launch: {
  pending: h.pending,
  onOpenUrl(fn: unknown) { h.subscribe(); h.host = fn; return () => {}; },
} } }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openInvitePreview: h.open }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {} } }));
afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });
describe("native launch delivery", () => {
  test("drains installer inbox and routes later SDK/native activations exactly once", async () => {
    const { initDeepLinks } = await import("@/lib/deeplink");
    initDeepLinks();
    expect(h.open).toHaveBeenCalledWith("ABC-DEF-GHI");
    h.sdk("argon://invite/SECOND");
    h.host("argon://invite/THIRD");
    expect(h.open.mock.calls.map((args) => args[0])).toEqual(["ABC-DEF-GHI", "SECOND", "THIRD"]);
    initDeepLinks();
    expect(h.pending).toHaveBeenCalledTimes(1);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
  });
});
