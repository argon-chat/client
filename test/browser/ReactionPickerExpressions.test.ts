/**
 * Reacting from a message's hover bar, in a real browser: the quick row reacts with a unicode emoji;
 * "more" opens the expressions picker in reaction mode (the emoji tab alone, with its tab bar, rail
 * and search, the space's own emoji included, at the composer picker's full size), and a custom emoji
 * picked there toggles a custom reaction by its item id. In a direct chat the picker loads and offers
 * every space's emoji.
 */

import "../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { page, userEvent } from "vitest/browser";
import { createPinia, setActivePinia } from "pinia";
import { emojiRegistry, initializeEmojix } from "@argon-chat/emojix";
import { ExpressionFormat, ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";

const h = await vi.hoisted(async () => ({
  stub: (name: string) => ({ default: { name, setup: () => () => null } }),
}));

vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("./fixtures/tiny-lottie.json?url");
  return { cdnUrl: () => url, cdnFetchUrl: () => url, cdnCrossOrigin: () => undefined, resolveAttachmentUrl: () => url };
});
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    spaceExpressionInteraction: {
      GetExpressions: async (_spaceId: string, known: string | null) => ({ version: known ?? "v1", packs: null }),
    },
  }),
}));
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
vi.mock("@/components/modals/ReportDialog.vue", () => h.stub("ReportDialog"));
vi.mock("@/components/chats/MessagePinMarker.vue", () => h.stub("MessagePinMarker"));
vi.mock("@/components/chats/MessageReadCount.vue", () => h.stub("MessageReadCount"));
vi.mock("@/components/chats/MessagePinMenuItem.vue", () => h.stub("MessagePinMenuItem"));
vi.mock("@/components/chats/MessageWebhookAuthor.vue", () => h.stub("MessageWebhookAuthor"));
vi.mock("@/components/chats/MentionSegment.vue", () => h.stub("MentionSegment"));
vi.mock("@/components/chats/AttachmentImageGrid.vue", () => h.stub("AttachmentImageGrid"));
vi.mock("@/components/chats/AttachmentFileCard.vue", () => h.stub("AttachmentFileCard"));
vi.mock("@/components/chats/LinkPreviewCard.vue", () => h.stub("LinkPreviewCard"));
vi.mock("@/components/chats/GifPicker.vue", () => h.stub("GifPicker"));

import { IonDateTime } from "@argon-chat/ion.webcore";
import MessageItem from "@/components/MessageItem.vue";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { db } from "@/store/db/dexie";
import { EXPRESSION_RESOLVER, createStoreResolver } from "@/lib/expressions/resolver";

const emojiItem = (spaceId: string, itemId: string, packId: string, sortOrder: number): ExpressionItem => ({
  itemId,
  packId,
  spaceId,
  kind: ExpressionKind.Emoji,
  format: ExpressionFormat.Lottie,
  name: itemId.replace(/-/g, "_"),
  fileId: `file-${itemId}`,
  thumbFileId: null,
  width: 100,
  height: 100,
  fileSize: 1000,
  emoji: [],
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder,
  downloadUrl: null,
  thumbUrl: null,
  creatorId: null,
});

const emojiPack = (spaceId: string, packId: string, prefix: string, count: number): ExpressionPack => ({
  packId,
  spaceId,
  kind: ExpressionKind.Emoji,
  title: packId,
  slug: packId,
  coverItemId: null,
  sortOrder: 0,
  version: 1n,
  items: Array.from({ length: count }, (_, i) => emojiItem(spaceId, `${prefix}-${i}`, packId, i)),
  creatorId: null,
});

function seed(spaceId: string, packs: ExpressionPack[]) {
  useExpressionsStore().bySpace.set(spaceId, { version: "v1", packs, loadedAt: Date.now() });
}

const message = (spaceId: string) =>
  ({
    messageId: 1n,
    replyId: null,
    channelId: "c1",
    spaceId,
    text: "hello",
    entities: [],
    timeSent: IonDateTime.fromDate(new Date("2026-09-27T10:00:00Z")),
    sender: "author",
    reactions: [],
    controls: null,
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    webhook: null,
  }) as any;

const mounted: VueWrapper[] = [];

async function render(spaceId = "s1") {
  const toggleReaction = vi.fn();
  const toggleCustomReaction = vi.fn();
  const w = mount(MessageItem, {
    attachTo: document.body,
    props: {
      message: message(spaceId),
      getMsgById: () => ({}) as any,
      isFirstInGroup: true,
      canReact: true,
      toggleReaction,
      toggleCustomReaction,
    },
    global: { provide: { [EXPRESSION_RESOLVER as symbol]: createStoreResolver() } },
  });
  mounted.push(w);
  await nextTick();
  return { w, toggleReaction, toggleCustomReaction };
}

async function until(check: () => boolean, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

/** Hover the message, then open the reaction popover from its action bar. */
async function openReactions(w: VueWrapper) {
  w.find(".msg-bubble-wrap").element.dispatchEvent(new MouseEvent("mouseenter"));
  await until(() => !!$("[data-testid=add-reaction]"));
  $("[data-testid=add-reaction]")!.click();
  await until(() => !!$(".reaction-picker"));
}

async function openFullPicker(w: VueWrapper) {
  await openReactions(w);
  await userEvent.click($("[data-testid=reaction-picker-more]")!);
  await until(() => !!$(".xp-cell"));
}

async function search(query: string) {
  const input = $<HTMLInputElement>(".xp-search__input")!;
  input.value = query;
  input.dispatchEvent(new Event("input"));
  await nextTick();
}

beforeAll(async () => {
  await initializeEmojix();
  await page.viewport(1280, 900);
});

beforeEach(async () => {
  localStorage.clear();
  setActivePinia(createPinia());
  await db.servers.clear();
  seed("s1", [emojiPack("s1", "ep", "em", 2)]);
});

afterEach(async () => {
  for (const w of mounted.splice(0)) w.unmount();
  await flushPromises();
  document.body.innerHTML = "";
});

describe("reacting to a message", () => {
  test("the quick row reacts with a unicode emoji and closes", async () => {
    const { w, toggleReaction } = await render();
    await openReactions(w);
    document.querySelector<HTMLElement>(".reaction-picker .picker-emoji")!.click();
    expect(toggleReaction).toHaveBeenCalledWith(1n, "👍");
    await until(() => !$(".reaction-picker"));
  });

  test("more: the picker in reaction mode; a custom emoji toggles a custom reaction by its item id", async () => {
    const { w, toggleCustomReaction, toggleReaction } = await render();
    await openFullPicker(w);
    expect([...document.querySelectorAll<HTMLElement>(".xp-tabs__tab")].map((b) => b.dataset.tab)).toEqual(["emoji"]);
    expect(document.activeElement).toBe($(".xp-search__input"));
    // The same panel as the composer's, at its full size, the rail beside the grid.
    expect($(".xp")!.getBoundingClientRect().width).toBe(498);
    expect($(".xp-rail")).not.toBeNull();

    await search("em_1");
    await until(() => !!$(".xp-cell--custom"));
    await userEvent.click($(".xp-cell--custom")!);
    expect(toggleCustomReaction).toHaveBeenCalledWith(1n, "em-1");
    expect(toggleReaction).not.toHaveBeenCalled();
    await until(() => !$(".xp"));
  });

  test("more: a unicode pick toggles that emoji", async () => {
    const { w, toggleReaction } = await render();
    await openFullPicker(w);
    await userEvent.click($('[data-group-id="smileys"] .xp-cell')!);
    const first = emojiRegistry.getByCategory("smileys")[0];
    expect(toggleReaction).toHaveBeenCalledWith(1n, String.fromCodePoint(...first.codepoints));
  });

  test("Esc in the picker closes it", async () => {
    const { w } = await render();
    await openFullPicker(w);
    await userEvent.keyboard("{Escape}");
    await until(() => !$(".xp"));
  });

  test("in a direct chat the picker loads and offers every space's emoji, a rail icon per space", async () => {
    seed("s2", [emojiPack("s2", "ep2", "other", 1)]);
    const loadAll = vi.spyOn(useExpressionsStore(), "ensureLoadedAll");
    const { w, toggleCustomReaction } = await render("");
    await openFullPicker(w);
    expect(loadAll).toHaveBeenCalledTimes(1);
    const spaces = () =>
      [...document.querySelectorAll<HTMLElement>(".xp-rail__item")].map((b) => b.dataset.rail).filter((s) => s?.startsWith("space:"));
    expect(spaces()).toEqual(["space:s1", "space:s2"]);

    await search("other");
    await until(() => !!$(".xp-cell--custom"));
    await userEvent.click($(".xp-cell--custom")!);
    expect(toggleCustomReaction).toHaveBeenCalledWith(1n, "other-0");
  });
});
