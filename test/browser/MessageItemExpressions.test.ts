/**
 * Stickers and custom emoji in a message, in a real browser. A sticker-only message is the
 * sticker, drawn by StickerView at the chat size (smaller in a narrow column) with no bubble. A
 * custom emoji in text is a placeholder the size of the text plus 4 px, filled by the message's
 * overlay; alone (or with a few others) it is drawn big, at Telegram's sizes. A click on either opens
 * where it comes from, with "Open pack" only for a pack the composer's picker shows.
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
// The user's spaces: only "space" (Cats Café) is one of them.
vi.mock("@/store/db/dexie", () => ({
  db: { servers: { get: async (id: string) => (id === "space" ? { spaceId: "space", name: "Cats Café", avatarFieldId: null } : undefined) } },
}));

import { IonDateTime } from "@argon-chat/ion.webcore";
import { userEvent } from "vitest/browser";
import { EntityType, ExpressionKind, MessageEntityBold, MessageEntityCustomEmoji, MessageEntitySticker, type ExpressionItem, type ExpressionPack, type IMessageEntity } from "@argon/glue";
import MessageItem from "@/components/MessageItem.vue";
import { EXPRESSION_RESOLVER, noopResolver, type ExpressionResolver } from "@/lib/expressions/resolver";
import { onOpenExpressionPack } from "@/lib/expressions/expressionInfo";

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

async function render(msg: any, props: Record<string, unknown> = {}, resolver?: ExpressionResolver) {
  const w = mount(MessageItem, {
    attachTo: document.body,
    props: { message: msg, getMsgById: () => ({}) as any, isFirstInGroup: true, ...props },
    global: resolver ? { provide: { [EXPRESSION_RESOLVER as symbol]: resolver } } : undefined,
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

describe("where a custom emoji or sticker comes from", () => {
  const items: ExpressionItem[] = [
    { itemId: "item-wave", packId: "p-waves", spaceId: "space", kind: ExpressionKind.Emoji, format: 0, name: "wave", fileId: "png-wave", width: 100, height: 100, textColor: false } as ExpressionItem,
    { itemId: "item", packId: "pack", spaceId: "space", kind: ExpressionKind.Sticker, format: 1, name: "Happy cat", fileId: "sticker-file", width: 512, height: 512, textColor: false } as ExpressionItem,
  ];
  const packs: ExpressionPack[] = [
    { packId: "p-waves", spaceId: "space", kind: ExpressionKind.Emoji, title: "Waves" } as ExpressionPack,
    { packId: "pack", spaceId: "space", kind: ExpressionKind.Sticker, title: "Cats" } as ExpressionPack,
  ];
  const resolver: ExpressionResolver = {
    ...noopResolver,
    itemById: (id) => items.find((i) => i.itemId === id) ?? null,
    packOf: (item) => packs.find((p) => p.packId === item.packId) ?? null,
  };

  const popover = () => document.querySelector<HTMLElement>('[data-testid="expression-info"]');
  const part = (id: string) => popover()?.querySelector<HTMLElement>(`[data-testid="expression-info-${id}"]`)?.textContent?.trim();

  test("a click on a custom emoji in a message opens it: the emoji large, its name, pack and space", async () => {
    const w = await render(message("hi :wave: there", [emoji("wave", 3)]), {}, resolver);
    const trigger = w.find<HTMLElement>(".ce-trigger").element;
    expect(trigger.getAttribute("role")).toBe("button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Wrapping it changes nothing about the placeholder's size.
    expect(w.find<HTMLElement>(".ce").element.getBoundingClientRect().width).toBe(18);

    await userEvent.click(trigger);
    await until(() => part("space-name") === "Cats Café");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(part("label")).toBe(":wave:");
    expect(part("pack")).toContain("Waves");
    // The message is in another space ("s1"): the emoji's space is named, not "this space".
    expect(popover()!.textContent).toContain("expression_info_from_space");
    const big = popover()!.querySelector<HTMLElement>(".sticker-view")!;
    expect([big.style.width, big.style.height]).toEqual(["64px", "64px"]);
    expect(popover()!.querySelector('[data-testid="expression-info-copy"]')).not.toBeNull();
    // No composer has registered "Open pack" here.
    expect(popover()!.querySelector('[data-testid="expression-info-open-pack"]')).toBeNull();

    await userEvent.keyboard("{Escape}");
    await until(() => !popover());
  });

  test("from the keyboard: Enter on the focused emoji opens it", async () => {
    const w = await render(message("hi :wave:", [emoji("wave", 3)]), {}, resolver);
    w.find<HTMLElement>(".ce-trigger").element.focus();
    await userEvent.keyboard("{Enter}");
    await until(() => part("label") === ":wave:");
  });

  test("an emoji from a space this client has not loaded: its name from the message, from another space", async () => {
    const far = new MessageEntityCustomEmoji(EntityType.CustomEmoji, 3, 7, 1, "item-party", "far-space", 0, "png-party", "party", false, null);
    const w = await render(message("hi :party:", [far]), {}, resolver);
    await userEvent.click(w.find<HTMLElement>(".ce-trigger").element);
    await until(() => !!popover()?.querySelector('[data-testid="expression-info-other-space"]'));
    expect(part("label")).toBe(":party:");
    expect(popover()!.querySelector('[data-testid="expression-info-pack"]')).toBeNull();
  });

  test("a click on a sticker opens it at 96 px with its name and pack", async () => {
    const w = await render(message("", [sticker()]), {}, resolver);
    await userEvent.click(w.find<HTMLElement>('[data-testid="sticker-trigger"]').element);
    await until(() => part("space-name") === "Cats Café");
    expect(part("label")).toBe("Happy cat");
    expect(part("pack")).toContain("Cats");
    const big = popover()!.querySelector<HTMLElement>(".sticker-view")!;
    expect([big.style.width, big.style.height]).toEqual(["96px", "96px"]);
    // Stickers have no name to copy.
    expect(popover()!.querySelector('[data-testid="expression-info-copy"]')).toBeNull();
  });

  describe("Open pack", () => {
    const off: (() => void)[] = [];
    afterEach(() => off.splice(0).forEach((f) => f()));

    test("an emoji from another space than the composer's: no Open pack", async () => {
      // The composer of the message's space ("s1") has only that space's packs in its picker.
      const open = vi.fn(() => false);
      off.push(onOpenExpressionPack(open, (_packId, spaceId) => spaceId === "s1"));
      const w = await render(message("hi :wave: there", [emoji("wave", 3)]), {}, resolver);
      await userEvent.click(w.find<HTMLElement>(".ce-trigger").element);
      await until(() => part("space-name") === "Cats Café");
      expect(popover()!.querySelector('[data-testid="expression-info-open-pack"]')).toBeNull();
      expect(open).not.toHaveBeenCalled();
    });

    test("where the composer's picker has the pack (a direct chat's: every loaded space's), it is offered and opens it", async () => {
      const open = vi.fn(() => true);
      off.push(onOpenExpressionPack(open, (packId, spaceId) => packId === "p-waves" && spaceId === "space"));
      const w = await render(message("hi :wave: there", [emoji("wave", 3)]), {}, resolver);
      await userEvent.click(w.find<HTMLElement>(".ce-trigger").element);
      await until(() => part("space-name") === "Cats Café");

      await userEvent.click(popover()!.querySelector<HTMLElement>('[data-testid="expression-info-open-pack"]')!);
      expect(open).toHaveBeenCalledWith({ spaceId: "space", packId: "p-waves", kind: ExpressionKind.Emoji });
      await until(() => !popover());
    });
  });
});
