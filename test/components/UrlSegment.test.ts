import { beforeEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
const mocks = vi.hoisted(() => ({ openUrl: vi.fn(async () => true), openInvitePreview: vi.fn() }));
vi.mock("@/lib/sk", () => ({ isSk: false }));
vi.mock("@/lib/shell/host", () => ({ shell: { system: { openUrl: mocks.openUrl } } }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openInvitePreview: mocks.openInvitePreview }) }));
import UrlSegment from "@/components/chats/UrlSegment.vue";

const segment = (text: string) => mount(UrlSegment, { props: { text, entity: { domain: "", path: "" } as never } });
beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("UrlSegment", () => {
  test("a voice-room invite opens in the app, not a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const a = segment("https://argon.gl/v/EoiDNbJgF").get("a");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(mocks.openInvitePreview).toHaveBeenCalledWith("EoiDNbJgF");
    expect(open).not.toHaveBeenCalled();
  });
  test("an ordinary link opens a new tab", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await segment("https://example.com/page").get("a").trigger("click");
    expect(open).toHaveBeenCalledWith("https://example.com/page", "_blank", "noopener,noreferrer");
    expect(mocks.openInvitePreview).not.toHaveBeenCalled();
  });
});
