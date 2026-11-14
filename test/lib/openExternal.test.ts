import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: false, openUrl: vi.fn(async () => true), openInvitePreview: vi.fn() }));
vi.mock("@/lib/sk", () => ({ get isSk() { return mocks.native; } }));
vi.mock("@/lib/shell/host", () => ({ shell: { system: { openUrl: mocks.openUrl } } }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openInvitePreview: mocks.openInvitePreview }) }));
import { openExternalUrl, openLink } from "@/lib/linkPreview/openExternal";
import { inviteDeepLink } from "@/lib/deeplink";
beforeEach(() => { mocks.native = false; vi.clearAllMocks(); vi.restoreAllMocks(); });
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

describe("clicked links", () => {
  test.each([
    ["https://argon.gl/i/ABC-DEF-GHI", "ABC-DEF-GHI"],
    ["https://argon.gl/v/EoiDNbJgF", "EoiDNbJgF"],
    ["https://www.argon.gl/V/EoiDNbJgF/?utm_source=x#top", "EoiDNbJgF"],
    ["http://ARGON.GL/i/abc", "abc"],
  ])("%s opens the invite preview in place", (url, code) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openLink(url, new MouseEvent("click"));
    expect(mocks.openInvitePreview).toHaveBeenCalledWith(code);
    expect(open).not.toHaveBeenCalled();
  });
  test("invites stay in the app on the desktop too", () => {
    mocks.native = true;
    openLink("https://argon.gl/v/EoiDNbJgF");
    expect(mocks.openInvitePreview).toHaveBeenCalledWith("EoiDNbJgF");
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });
  test("other links open in a new tab", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    for (const url of ["https://example.com/i/abc", "https://argon.gl/", "https://argon.gl/i/", "https://argon.gl/x/abc",
      "https://argon.gl/i/abc/extra", "https://app.argon.gl/i/abc", "https://argon.gl.evil.com/i/abc"]) openLink(url);
    expect(mocks.openInvitePreview).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(7);
    expect(open).toHaveBeenCalledWith("https://example.com/i/abc", "_blank", "noopener,noreferrer");
  });
  test.each(["ctrlKey", "metaKey", "shiftKey"])("%s-click on an invite still opens a new tab", (key) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openLink("https://argon.gl/i/abc", new MouseEvent("click", { [key]: true }));
    expect(mocks.openInvitePreview).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("https://argon.gl/i/abc", "_blank", "noopener,noreferrer");
  });
  test("only argon.gl invite paths map to deep links", () => {
    expect(inviteDeepLink("https://argon.gl/i/abc")).toBe("argon://i/abc");
    expect(inviteDeepLink("https://argon.gl/v/abc")).toBe("argon://v/abc");
    expect(inviteDeepLink("not a url")).toBeNull();
    expect(inviteDeepLink("ftp://argon.gl/i/abc")).toBeNull();
  });
});
