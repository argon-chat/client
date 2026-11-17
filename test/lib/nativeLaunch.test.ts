import { afterEach, describe, expect, test, vi } from "vitest";
const h = vi.hoisted(() => ({
  open: vi.fn(), sdk: null as any, host: null as any, subscribe: vi.fn(),
  pending: vi.fn(() => ["argon://invite/ABC-DEF-GHI"]),
  queued: new Map<number, string>([[7, "argon://invite/THIRD"]]),
}));
vi.mock("@/lib/sk", () => ({ isSk: true }));
vi.mock("@/lib/sk/launch", () => ({ forwardLaunchLinks: (fn: unknown) => { h.sdk = fn; } }));
vi.mock("native:launch", () => ({
  available: true,
  pending: h.pending,
  take: (id: number) => { const url = h.queued.get(id) ?? null; h.queued.delete(id); return url; },
  on(_event: string, fn: unknown) { h.subscribe(); h.host = fn; return () => {}; },
}));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openInvitePreview: h.open }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {} } }));
afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });
describe("native launch delivery", () => {
  test("drains installer inbox and routes later SDK/native activations exactly once", async () => {
    const { initDeepLinks } = await import("@/lib/deeplink");
    initDeepLinks();
    expect(h.open).toHaveBeenCalledWith("ABC-DEF-GHI");
    h.sdk("argon://invite/SECOND");
    h.host(7);
    h.host(7);
    expect(h.open.mock.calls.map((args) => args[0])).toEqual(["ABC-DEF-GHI", "SECOND", "THIRD"]);
    initDeepLinks();
    expect(h.pending).toHaveBeenCalledTimes(1);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
  });
});
