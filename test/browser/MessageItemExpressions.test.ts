/**
 * Stickers and custom emoji in a message, in a real browser. A sticker-only message is the
 * sticker, drawn by StickerView at the chat size (smaller in a narrow column) with no bubble. A
 * custom emoji in text is a placeholder the size of the text plus 4 px, filled by the message's
 * overlay; alone (or with a few others) it is drawn big, at Telegram's sizes.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => ({
  stub: (name: string) => ({ default: { name, setup: () => () => null } }),
  PNG: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
}));

vi.mock("@/store/system/fileStorage", async () => {
  const { default: lottie } = await import("./fixtures/tiny-lottie.json?url");
  const resolve = (fileId: string) => (fileId.startsWith("png-") ? h.PNG : lottie);
  return { cdnUrl: resolve, cdnFetchUrl: resolve, cdnCrossOrigin: () => undefined };
});
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast() {} }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#fff" }) }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => false, hasInSpace: () => false }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");
  return {
    usePoolStore: () => ({
      getUserReactive: (id: { value: string | undefined }) =>
        computed(() => (id.value ? { userId: id.value, displayName: "Author", username: "author" } : null)),
    }),
  };
});
vi.mock("@/lib/linkPreview/settings", async () => {
  const { ref } = await import("vue");
  return { showLinkPreviews: ref(false) };
});
vi.mock("@/components/ArgonAvatar.vue", () => h.stub("ArgonAvatar"));
vi.mock("@/components/popovers/UserProfilePopover.vue", () => h.stub("UserProfilePopover"));
vi.mock("@/components/chats/MessageReactions.vue", () => h.stub("MessageReactions"));
vi.mock("@/components/chats/MessageControls.vue", () => h.stub("MessageControls"));
vi.mock("@/components/chats/ReactionPicker.vue", () => h.stub("ReactionPicker"));
vi.mock("@/components/modals/ReportDialog.vue", () => h.stub("ReportDialog"));
vi.mock("@/components/chats/MessagePinMarker.vue", () => h.stub("MessagePinMarker"));
vi.mock("@/components/chats/MessageReadCount.vue", () => h.stub("MessageReadCount"));
vi.mock("@/components/chats/MessagePinMenuItem.vue", () => h.stub("MessagePinMenuItem"));
vi.mock("@/components/chats/MessageWebhookAuthor.vue", () => h.stub("MessageWebhookAuthor"));
vi.mock("@/components/chats/MentionSegment.vue", () => h.stub("MentionSegment"));
vi.mock("@/components/chats/AttachmentImageGrid.vue", () => h.stub("AttachmentImageGrid"));
vi.mock("@/components/chats/AttachmentFileCard.vue", () => h.stub("AttachmentFileCard"));
vi.mock("@/components/chats/LinkPreviewCard.vue", () => h.stub("LinkPreviewCard"));

import { IonDateTime } from "@argon-chat/ion.webcore";
import { EntityType, MessageEntityBold, MessageEntityCustomEmoji, MessageEntitySticker, type IMessageEntity } from "@argon/glue";
import MessageItem from "@/components/MessageItem.vue";

const message = (text: string, entities: IMessageEntity[]) =>
  ({
    messageId: 1n,
    replyId: null,
    channelId: "c1",
    spaceId: "s1",
    text,
    entities,
    timeSent: IonDateTime.fromDate(new Date("2026-09-27T10:00:00Z")),
    sender: "author",
    reactions: [],
    controls: null,
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    webhook: null,
  }) as any;

const sticker = () =>
  new MessageEntitySticker(EntityType.Sticker, 0, 0, 1, "item", "pack", "space", 1, "sticker-file", null, 512, 512, null, null, null);

const emoji = (name: string, offset: number) =>
  new MessageEntityCustomEmoji(EntityType.CustomEmoji, offset, name.length + 2, 1, `item-${name}`, "space", 0, `png-${name}`, name, false, null);

const mounted: VueWrapper[] = [];

async function render(msg: any, props: Record<string, unknown> = {}) {
  const w = mount(MessageItem, {
    attachTo: document.body,
    props: { message: msg, getMsgById: () => ({}) as any, isFirstInGroup: true, ...props },
  });
  mounted.push(w);
  await nextTick();
  return w;
}

async function until(check: () => boolean, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  document.body.innerHTML = "";
});

describe("a sticker message", () => {
  test("is the sticker, at the chat size, with no text bubble; it plays", async () => {
    const w = await render(message("", [sticker()]));
    const view = w.find<HTMLElement>(".sticker-view").element;
    expect([view.style.width, view.style.height]).toEqual(["200px", "200px"]);
    expect(view.getAttribute("aria-label")).toBe("sticker");
    expect(w.find(".bg-muted").exists()).toBe(false);
    await until(() => view.dataset.phase === "ready");
  });

  test("is smaller in a narrow column", async () => {
    const w = await render(message("", [sticker()]), { narrow: true });
    const view = w.find<HTMLElement>(".sticker-view").element;
    expect([view.style.width, view.style.height]).toEqual(["180px", "180px"]);
  });
});

describe("custom emoji in a message", () => {
  test("in text: a placeholder the text's size plus 4 px, inside one overlay, filled with its image", async () => {
    const w = await render(message("hi :wave: there", [emoji("wave", 3)]));
    const ce = w.find<HTMLElement>(".ce").element;
    expect(ce.getAttribute("title")).toBe(":wave:");
    expect(ce.getBoundingClientRect().width).toBe(18);
    expect(w.findAll(".ce-overlay")).toHaveLength(1);
    expect(w.find("[data-jumbo]").exists()).toBe(false);
    await until(() => !!ce.querySelector("img.ce-img"));
  });

  test("inside bold it is drawn inside the bold span", async () => {
    const w = await render(message("hi :wave:", [new MessageEntityBold(EntityType.Bold, 0, 9, 1), emoji("wave", 3)]));
    expect(w.find(".font-bold .ce").exists()).toBe(true);
    expect(w.find(".font-bold").text()).toBe("hi");
  });

  test("alone it is drawn big; with two others a little less; with text it is not", async () => {
    const one = await render(message(":wave:", [emoji("wave", 0)]));
    expect(one.find("[data-jumbo]").exists()).toBe(true);
    expect(one.find<HTMLElement>(".ce").element.getBoundingClientRect().width).toBe(96);

    const three = await render(message(":a1: 👍 :b2:", [emoji("a1", 0), emoji("b2", 8)]));
    expect(three.find<HTMLElement>(".ce").element.getBoundingClientRect().width).toBe(84);

    const text = await render(message(":wave: ok", [emoji("wave", 0)]));
    expect(text.find("[data-jumbo]").exists()).toBe(false);
  });
});
