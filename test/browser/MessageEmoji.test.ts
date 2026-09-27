/**
 * Unicode emoji in a message, in a real browser: drawn from the Apple sprite atlas at 1.25em of
 * the text (about 18 px in a 14 px bubble), and still the emoji's characters underneath, so a
 * selection over the message reads — and copies — exactly what was sent. An emoji-only message
 * draws them at the big-emoji size, like custom emoji.
 */

import "../../packages/assets/styles/index.css";
import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { userEvent } from "vitest/browser";

const h = await vi.hoisted(async () => ({
  stub: (name: string) => ({ default: { name, setup: () => () => null } }),
}));

vi.mock("@/store/system/fileStorage", () => ({ cdnUrl: () => "", cdnFetchUrl: () => "", cdnCrossOrigin: () => undefined }));
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
import { initializeEmojix } from "@argon-chat/emojix";
import { EntityType, MessageEntityBold, MessageEntityCustomEmoji, type IMessageEntity } from "@argon/glue";
import MessageItem from "@/components/MessageItem.vue";

const message = (text: string, entities: IMessageEntity[] = []) =>
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

const customEmoji = (name: string, offset: number) =>
  new MessageEntityCustomEmoji(EntityType.CustomEmoji, offset, name.length + 2, 1, `item-${name}`, "space", 0, `png-${name}`, name, false, null);

const mounted: VueWrapper[] = [];

async function render(msg: any) {
  const w = mount(MessageItem, {
    attachTo: document.body,
    props: { message: msg, getMsgById: () => ({}) as any, isFirstInGroup: true },
  });
  mounted.push(w);
  await nextTick();
  return w;
}

const box = (el: Element) => el.getBoundingClientRect();
const fontPx = (el: Element) => parseFloat(getComputedStyle(el).fontSize);

/** The text a user gets by selecting everything in `el` (what Ctrl+C puts on the clipboard as text). */
function selectAll(el: Element): string {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString();
}

beforeAll(() => initializeEmojix());

afterEach(() => {
  getSelection()?.removeAllRanges();
  for (const w of mounted.splice(0)) w.unmount();
  document.body.innerHTML = "";
});

describe("unicode emoji in a message", () => {
  test("are sprites 1.25em of the text, not the system font", async () => {
    const w = await render(message("hi 👋🏽 there 🇺🇦 and 1️⃣!"));
    const sprites = w.findAll<HTMLElement>(".msg-emoji").map((s) => s.element);
    expect(sprites.map((s) => s.textContent)).toEqual(["👋🏽", "🇺🇦", "1️⃣"]);

    const font = fontPx(sprites[0]!.parentElement!);
    expect(font).toBe(14);
    for (const sprite of sprites) {
      expect(box(sprite).width).toBeCloseTo(font * 1.25, 1);
      expect(box(sprite).height).toBeCloseTo(font * 1.25, 1);
      // The characters are there but not painted: the sprite is.
      expect(getComputedStyle(sprite).color).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(sprite).backgroundImage).toMatch(/^url\(.+\/(tone3|flags|symbols)\.webp/);
    }
    expect(w.find("[data-jumbo]").exists()).toBe(false);
  });

  test("the atlas image loads", async () => {
    const w = await render(message("😀"));
    const url = /url\("?([^")]+)"?\)/.exec(getComputedStyle(w.find(".msg-emoji").element).backgroundImage)![1]!;
    const img = new Image();
    img.src = url;
    await img.decode();
    expect(img.naturalWidth).toBeGreaterThan(1000);
  });

  test("a selection over the message reads exactly the text sent", async () => {
    const text = "Family 👨‍👩‍👧‍👦, thumbs 👍🏿, ❤️ and a flag 🇯🇵 — done.";
    const w = await render(message(text));
    const body = w.find(".msg-emoji").element.parentElement!;
    expect(selectAll(body)).toBe(text);
  });

  test("copy and paste carry the characters", async () => {
    const text = "copy 🙌🏼 me 🇺🇦";
    const w = await render(message(text));
    selectAll(w.find(".msg-emoji").element.parentElement!);
    await userEvent.copy();

    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    await userEvent.paste();
    expect(field.value).toBe(text);
  });

  test("inside bold the same, and the sprite follows the bold span", async () => {
    const text = "so 🔥 hot";
    const w = await render(message(text, [new MessageEntityBold(EntityType.Bold, 0, text.length, 1)]));
    const sprite = w.find(".font-bold .msg-emoji").element;
    expect(sprite.textContent).toBe("🔥");
    expect(selectAll(w.find(".font-bold").element)).toBe(text);
  });

  test("keep the line height of plain text", async () => {
    const plain = await render(message("plain line"));
    const withEmoji = await render(message("emoji line 😀"));
    const lineOf = (w: VueWrapper) => box(w.find(".whitespace-pre-wrap").element).height;
    expect(lineOf(withEmoji)).toBe(lineOf(plain));
  });
});

describe("an emoji-only message", () => {
  test("draws its emoji at the big size (96 px alone, 84 px for three)", async () => {
    const one = await render(message("👍"));
    expect(one.find("[data-jumbo]").exists()).toBe(true);
    const sprite = one.find(".msg-emoji").element;
    expect([box(sprite).width, box(sprite).height]).toEqual([96, 96]);

    const three = await render(message("😀 😂 🥲"));
    for (const s of three.findAll(".msg-emoji")) expect(box(s.element).width).toBe(84);
  });

  test("with custom emoji: both at the same size", async () => {
    const w = await render(message(":a1: 👍 :b2:", [customEmoji("a1", 0), customEmoji("b2", 8)]));
    expect(box(w.find(".msg-emoji").element).width).toBe(84);
    expect(box(w.find(".ce").element).width).toBe(84);
  });
});
