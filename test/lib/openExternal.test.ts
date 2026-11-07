import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: false, openUrl: vi.fn(async () => true) }));
vi.mock("@/lib/vn", () => ({ get isVn() { return mocks.native; } }));
vi.mock("@/lib/shell/host", () => ({ shell: { system: { openUrl: mocks.openUrl } } }));
import { openExternalUrl } from "@/lib/linkPreview/openExternal";
beforeEach(() => { mocks.native = false; vi.clearAllMocks(); });
describe("external links", () => {
  test("web links open with opener isolation", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openExternalUrl("https://example.com/");
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
  test("the desktop calls its direct system method", () => {
    mocks.native = true;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openExternalUrl("https://example.com/");
    expect(mocks.openUrl).toHaveBeenCalledWith("https://example.com/");
    expect(open).not.toHaveBeenCalled();
  });
  test("message links cannot launch another protocol", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    for (const url of ["javascript:alert(1)", "file:///tmp/foo", "argon://test"]) openExternalUrl(url);
    expect(open).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
});
