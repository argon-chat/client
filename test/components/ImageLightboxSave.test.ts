import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { EntityType, MessageEntityAttachment } from "@argon/glue";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), warn: vi.fn() }));
vi.mock("@argon/core", () => ({ logger: { warn: mocks.warn } }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: (id: string) => `/files/${id}`,
  cdnFetchUrl: (id: string) => `/files/${id}`,
  resolveAttachmentUrl: (id: string) => `/files/${id}`,
  cdnCrossOrigin: () => undefined,
}));
vi.mock("@/components/media/VideoPlayer.vue", () => ({ default: { render: () => null } }));
vi.mock("@/lib/media/mediaUrl", () => ({ resolveMediaUrl: vi.fn(), invalidateMediaUrl: vi.fn() }));
vi.mock("@/lib/media/videoAutoplay", () => ({ suspendChatVideos: vi.fn() }));
vi.mock("@/lib/attachments/clipboard", () => ({ copyAttachmentToClipboard: vi.fn() }));
vi.mock("@/lib/vn/vnWindow", () => ({ VnWindow: null }));
vi.mock("@/lib/vn/viewerWindow", () => ({ useViewerWindow: vi.fn() }));
vi.mock("@argon/ui/context-menu", async () => {
  const { defineComponent, h } = await import("vue");
  const slot = defineComponent({ setup: (_, { slots }) => () => h("div", slots.default?.()) });
  return {
    ContextMenu: defineComponent({
      emits: ["update:open"],
      setup: (_, { slots, emit }) => () => h("div", { onContextmenu: () => emit("update:open", true) }, slots.default?.()),
    }),
    ContextMenuTrigger: slot,
    ContextMenuContent: slot,
    ContextMenuItem: defineComponent({
      props: { disabled: Boolean },
      emits: ["select"],
      setup: (props, { slots, emit }) => () => h("button", { disabled: props.disabled, onClick: () => emit("select") }, slots.default?.()),
    }),
  };
});

import ImageLightbox from "@/components/chats/ImageLightbox.vue";

let wrapper: VueWrapper | null = null;
const bytes = new Blob(["original image bytes"], { type: "image/png" });
const fetchFile = vi.fn();
const picker = vi.fn();
const out = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
const clicked = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  fetchFile.mockReset().mockResolvedValue({ ok: true, blob: async () => bytes });
  picker.mockReset().mockResolvedValue({ createWritable: async () => out });
  out.write.mockReset().mockResolvedValue(undefined);
  out.close.mockReset().mockResolvedValue(undefined);
  out.abort.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchFile);
  vi.stubGlobal("showSaveFilePicker", picker);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(clicked);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

async function open() {
  const picture = (id: string) => new MessageEntityAttachment(EntityType.Attachment, 0, 0, 1, id, "picture", 1000n, "image/png;charset=utf-8", 32, 18, null, null);
  wrapper = mount(ImageLightbox, {
    props: { images: [picture("first"), picture("second")], isOpen: false },
    global: { stubs: { teleport: true } },
  });
  await wrapper.setProps({ isOpen: true });
  const save = wrapper.get('[data-testid="lightbox-menu-save"]');
  const menu = async () => {
    await wrapper!.get(".lightbox-image").trigger("contextmenu");
    await flushPromises();
  };
  return { save, menu };
}

describe("Save As", () => {
  test("prepares the original bytes before allowing a picker, then opens it synchronously from selection", async () => {
    const { save, menu } = await open();
    expect(save.attributes("disabled")).toBeDefined();
    expect(fetchFile).not.toHaveBeenCalled();
    await menu();
    expect(save.attributes("disabled")).toBeUndefined();
    const selected = save.trigger("click");
    expect(picker).toHaveBeenCalledWith({ suggestedName: "picture.png", types: [{ accept: { "image/png": [".png"] } }] });
    await selected;
    await flushPromises();
    expect(out.write).toHaveBeenCalledWith(bytes);
    expect(out.close).toHaveBeenCalledOnce();
    expect(fetchFile).toHaveBeenCalledOnce();
  });

  test.each(["http", "network"])("a %s failure keeps the picker unavailable and reports the error", async (kind) => {
    if (kind === "http") fetchFile.mockResolvedValue({ ok: false, status: 503 });
    else fetchFile.mockRejectedValue(new TypeError("offline"));
    const { save, menu } = await open();
    await menu();
    expect(save.attributes("disabled")).toBeDefined();
    expect(picker).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith({ title: "lightbox_save_failed", variant: "destructive" });
  });

  test("cancellation leaves without downloading or reporting a failure", async () => {
    picker.mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const { save, menu } = await open();
    await menu();
    await save.trigger("click");
    await flushPromises();
    expect(clicked).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  test("other picker errors download the prepared bytes without a second fetch", async () => {
    picker.mockRejectedValue(new TypeError("picker unavailable"));
    const { save, menu } = await open();
    await menu();
    await save.trigger("click");
    await flushPromises();
    expect(clicked).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(bytes);
    expect(fetchFile).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith("lightbox: save picker failed", expect.any(TypeError));
  });

  test("without a picker, downloads the prepared bytes", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    const { save, menu } = await open();
    await menu();
    await save.trigger("click");
    expect(clicked).toHaveBeenCalledOnce();
    expect(fetchFile).toHaveBeenCalledOnce();
  });

  test.each(["write", "close"] as const)("a failed %s aborts the stream and reports the failure", async (operation) => {
    out[operation].mockRejectedValue(new Error("disk full"));
    const { save, menu } = await open();
    await menu();
    await save.trigger("click");
    await flushPromises();
    expect(out.abort).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledOnce();
  });

  test("navigation aborts preparation and ignores a late result from the previous image", async () => {
    let resolve!: (blob: Blob) => void;
    fetchFile.mockResolvedValue({ ok: true, blob: () => new Promise<Blob>((done) => { resolve = done; }) });
    const { save, menu } = await open();
    await menu();
    const signal = fetchFile.mock.calls[0][1].signal as AbortSignal;
    await wrapper!.get(".lightbox-next").trigger("click");
    expect(signal.aborted).toBe(true);
    resolve(bytes);
    await flushPromises();
    expect(save.attributes("disabled")).toBeDefined();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
