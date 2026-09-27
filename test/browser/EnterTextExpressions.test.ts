/**
 * The composer's expressions picker in a real browser, over a seeded expressions store: it opens at
 * its full size inside the composer's popover; a sticker is sent at once as a message of no text and
 * one sticker entity, and the picker closes with focus back in the input; a custom emoji goes into the
 * input as a placeholder the value carries as an entity, and the picker stays open for the next pick;
 * Esc closes the picker only. The sticker tab is there whenever a sticker can be sent. In a direct
 * chat the picker loads and offers every space's packs and no way to their settings. "Open pack" in
 * the attribution popover of a custom emoji or sticker opens this picker at that pack; it is offered
 * only for a pack this picker shows.
 */

import "../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { page, userEvent } from "vitest/browser";
import { createPinia, setActivePinia } from "pinia";
import { emojiRegistry, initializeEmojix } from "@argon-chat/emojix";
import {
  EntityType,
  ExpressionFormat,
  ExpressionKind,
  MessageEntitySticker,
  type ExpressionItem,
  type ExpressionPack,
} from "@argon/glue";

const h = await vi.hoisted(async () => {
  const { computed, defineComponent, reactive, ref } = await import("vue");
  const stub = (name: string) => ({ default: defineComponent({ name, setup: () => () => null }) });
  return {
    stub,
    flags: { gifsSelectorActive: ref(true) },
    perms: new Set<string>(["CreateExpressions"]),
    sendMessage: vi.fn(),
    sendDirect: vi.fn(),
    computed,
    reactive,
    ref,
  };
});

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast() {} }) }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: { SendMessage: h.sendMessage },
    userChatInteractions: { SendDirectMessage: h.sendDirect },
    spaceExpressionInteraction: {
      // `known` matched: the seeded copy is current.
      GetExpressions: async (_spaceId: string, known: string | null) => ({ version: known ?? "v1", packs: null }),
    },
  }),
}));
vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("./fixtures/tiny-lottie.json?url");
  return { cdnUrl: () => url, cdnFetchUrl: () => url, cdnCrossOrigin: () => undefined, resolveAttachmentUrl: () => url };
});
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" }, isPremium: false }) }));
vi.mock("@/store/data/poolStore", () => ({
  usePoolStore: () => ({ selectedTextChannel: "c1", searchMentions: async () => [], getUser: async () => null }),
}));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    hasIn: () => true,
    has: (flag: string) => h.perms.has(flag),
    hasInSpace: (_space: string | null, flag: string) => h.perms.has(flag),
  }),
}));
vi.mock("@/store/features/featureFlagsStore", () => ({ useFeatureFlags: () => h.flags }));
vi.mock("@/store/ui/configStore", () => ({ useConfigStore: () => ({ devModeEnabled: false }) }));
vi.mock("@/lib/linkPreview/settings", () => ({ sendLinkPreviews: h.ref(false), showLinkPreviews: h.ref(false) }));
vi.mock("@/composables/useLinkPreviewDraft", () => ({
  useLinkPreviewDraft: () =>
    h.reactive({ visible: false, loading: false, url: null, preview: null, dismiss() {}, takeStub: () => null }),
}));
vi.mock("@/composables/useChannelDraft", () => ({
  useChannelDraft: () => ({
    flush: async () => {},
    blurred() {},
    clear: async () => {},
    load: async () => {},
    ready: Promise.resolve(),
  }),
}));
vi.mock("@/composables/useScheduledPosts", () => ({ useScheduledPosts: () => ({ schedule: async () => true }) }));
vi.mock("@/lib/chat/composerMention", () => ({ useDroppedMentions: () => {} }));
vi.mock("@/composables/useSlashCommands", () => ({
  useSlashCommands: () => ({ commands: h.ref([]), filterCommands: () => [], fetchCommands: async () => {} }),
}));
vi.mock("@/composables/useBotInteraction", () => ({ useBotInteraction: () => ({ invokeSlashCommand() {} }) }));
vi.mock("@/composables/useAttachmentUpload", () => ({
  useAttachmentUpload: () => ({
    hasFiles: h.computed(() => false),
    pendingFiles: h.ref([]),
    addFiles: async () => [],
    removeFile() {},
    detach: () => null,
    buildOptimisticEntities: () => [],
  }),
}));
vi.mock("@argon/media-editor", () => ({ MediaEditor: h.stub("MediaEditor").default }));
vi.mock("@/components/chats/AttachmentDialog.vue", () => h.stub("AttachmentDialog"));
vi.mock("@/components/chats/LinkPreviewBar.vue", () => h.stub("LinkPreviewBar"));
vi.mock("@/components/chats/ComposerPreview.vue", () => h.stub("ComposerPreview"));
vi.mock("@/components/chats/ScheduleSendButton.vue", () => h.stub("ScheduleSendButton"));
vi.mock("@/components/ArgonAvatar.vue", () => h.stub("ArgonAvatar"));
vi.mock("@/components/chats/GifPicker.vue", () => h.stub("GifPicker"));

import EnterText from "@/components/chats/EnterText.vue";
import MessageInput from "@/components/chats/MessageInput.vue";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { useWindow } from "@/store/ui/windowStore";
import { db } from "@/store/db/dexie";
import { EXPRESSION_RESOLVER, createStoreResolver } from "@/lib/expressions/resolver";
import ExpressionInfoPopover from "@/components/expressions/ExpressionInfoPopover.vue";
import type { ExpressionInfoTarget } from "@/lib/expressions/expressionInfo";

const item = (spaceId: string, itemId: string, packId: string, kind: ExpressionKind, sortOrder: number): ExpressionItem => ({
  itemId,
  packId,
  spaceId,
  kind,
  format: ExpressionFormat.Lottie,
  name: itemId.replace(/-/g, "_"),
  fileId: `file-${itemId}`,
  thumbFileId: null,
  width: kind === ExpressionKind.Emoji ? 100 : 512,
  height: kind === ExpressionKind.Emoji ? 100 : 512,
  fileSize: 1000,
  emoji: ["😺"],
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder,
  downloadUrl: "https://cdn.example/sticker.json",
  thumbUrl: null,
  creatorId: null,
});

const pack = (spaceId: string, packId: string, kind: ExpressionKind, prefix: string, count: number): ExpressionPack => ({
  packId,
  spaceId,
  kind,
  title: packId,
  slug: packId,
  coverItemId: null,
  sortOrder: kind === ExpressionKind.Sticker ? 0 : 1,
  version: 1n,
  items: Array.from({ length: count }, (_, i) => item(spaceId, `${prefix}-${i}`, packId, kind, i)),
  creatorId: null,
});

function seed(spaceId: string, packs: ExpressionPack[]) {
  useExpressionsStore().bySpace.set(spaceId, { version: "v1", packs, loadedAt: Date.now() });
}

const mounted: VueWrapper[] = [];

function composer(props: Record<string, unknown> = { spaceId: "s1", channelId: "c1" }) {
  const wrapper = mount(EnterText, {
    props: { replyTo: null, ...props },
    attachTo: document.body,
    global: { provide: { [EXPRESSION_RESOLVER as symbol]: createStoreResolver() } },
  });
  mounted.push(wrapper);
  const input = wrapper.findComponent(MessageInput);
  const editor = input.find<HTMLElement>("[contenteditable]").element;
  return { wrapper, editor, value: () => (input.vm as unknown as { getValue(): { text: string; entities: any[] } }).getValue() };
}

async function until(check: () => boolean, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const picker = () => $(".xp");
const tabs = () => [...document.querySelectorAll<HTMLElement>(".xp-tabs__tab")].map((b) => b.dataset.tab);

async function openPicker() {
  await userEvent.click($("[data-testid=expression-picker-toggle]")!);
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
  h.flags.gifsSelectorActive.value = true;
  h.perms.clear();
  h.perms.add("CreateExpressions");
  h.sendMessage.mockReset();
  h.sendMessage.mockImplementation(async (spaceId: string, channelId: string) => ({
    isSuccessSendMessage: () => true,
    isFailedSendMessage: () => false,
    readback: { messageId: 7n, channelId, spaceId },
  }));
  h.sendDirect.mockReset();
  h.sendDirect.mockResolvedValue(8n);
  seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 3), pack("s1", "ep", ExpressionKind.Emoji, "em", 2)]);
});

afterEach(async () => {
  for (const w of mounted.splice(0)) w.unmount();
  await flushPromises();
  document.body.innerHTML = "";
});

describe("the composer's expressions picker", () => {
  test("opens on the emoji tab with its search focused; stickers and GIFs are tabs of it", async () => {
    composer();
    await openPicker();
    expect(tabs()).toEqual(["gifs", "stickers", "emoji"]);
    expect($('[data-tab="emoji"]')?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe($(".xp-search__input"));
  });

  test("the popover does not squeeze it: the picker opens at its full width, rail beside the grid", async () => {
    composer();
    await openPicker();
    const popover = $("[data-testid=expression-picker-popover]")!;
    // Measured once the popover's zoom-in is over.
    await Promise.all(popover.getAnimations({ subtree: true }).map((a) => a.finished));
    const box = picker()!.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(480);
    expect(box.height).toBe(440);
    expect(popover.getBoundingClientRect().width).toBeGreaterThanOrEqual(box.width);
    expect($(".xp-rail")!.getBoundingClientRect().width).toBe(48);
    // Nine emoji to a row, as in Discord, not two.
    const smileys = [...document.querySelectorAll<HTMLElement>('[data-group-id="smileys"] .xp-cell')];
    const top = smileys[0].getBoundingClientRect().top;
    expect(smileys.filter((c) => c.getBoundingClientRect().top === top)).toHaveLength(9);
  });

  test("a sticker is sent at once, alone and with no text; the picker closes and the input has focus", async () => {
    const { wrapper, editor } = composer();
    await openPicker();
    await userEvent.click($('[data-tab="stickers"]')!);
    await until(() => document.querySelectorAll(".xp-cell--sticker").length === 3);
    await userEvent.click(document.querySelectorAll<HTMLElement>(".xp-cell--sticker")[1]);

    await until(() => h.sendMessage.mock.calls.length === 1);
    const [spaceId, channelId, text, entities, , replyTo] = h.sendMessage.mock.calls[0];
    expect([spaceId, channelId, text, replyTo]).toEqual(["s1", "c1", "", null]);
    expect(entities).toHaveLength(1);
    const sticker = entities[0] as MessageEntitySticker;
    expect(sticker).toBeInstanceOf(MessageEntitySticker);
    expect(sticker.type).toBe(EntityType.Sticker);
    expect([sticker.itemId, sticker.packId, sticker.spaceId, sticker.fileId]).toEqual(["st-1", "sp", "s1", "file-st-1"]);
    // What the server fills in is not sent.
    expect(sticker.downloadUrl).toBeNull();

    // The optimistic row carries the URL so it shows at once.
    const [optimistic] = wrapper.emitted("add-optimistic")![0] as [{ text: string; entities: MessageEntitySticker[] }];
    expect(optimistic.text).toBe("");
    expect(optimistic.entities[0].downloadUrl).toBe("https://cdn.example/sticker.json");
    expect(useExpressionsStore().recentStickers[0]).toBe("st-1");

    await until(() => !picker());
    await until(() => document.activeElement === editor);
  });

  test("a custom emoji goes in as a placeholder the value carries; the picker stays open", async () => {
    const { editor, value } = composer();
    await openPicker();
    await search("em_1");
    await until(() => !!$(".xp-cell--custom"));
    await userEvent.click($(".xp-cell--custom")!);

    await until(() => value().entities.length === 1);
    expect(value().text).toBe(":em_1:");
    expect(value().entities[0]).toMatchObject({ type: EntityType.CustomEmoji, offset: 0, length: 6, itemId: "em-1", spaceId: "s1" });
    expect(editor.querySelectorAll(".ce[contenteditable=false]")).toHaveLength(1);

    // Focus is back in the input for typing on; the picker waits for the next pick.
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(editor);
    expect(picker()).not.toBeNull();
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  test("a unicode emoji goes in as the atlas sprite, at the caret", async () => {
    const { editor, value } = composer();
    await openPicker();
    await userEvent.click($('[data-group-id="smileys"] .xp-cell')!);
    const first = emojiRegistry.getByCategory("smileys")[0];
    const text = String.fromCodePoint(...first.codepoints);
    await until(() => value().text === text);
    expect(editor.querySelector("[data-emoji]")?.getAttribute("data-emoji")).toBe(text);
    expect(picker()).not.toBeNull();
  });

  test("Esc closes the picker only: the reply stays, focus goes back to the input", async () => {
    const reply = { messageId: 5n } as any;
    const { wrapper, editor } = composer({ spaceId: "s1", channelId: "c1", replyTo: reply });
    await openPicker();
    await userEvent.keyboard("{Escape}");
    await until(() => !picker());
    expect(wrapper.emitted("clear-reply")).toBeUndefined();
    await until(() => document.activeElement === editor);
  });

  test("the sticker tab is there whenever a sticker can be sent; the GIF tab needs the GIF flag", async () => {
    h.flags.gifsSelectorActive.value = false;
    composer();
    await openPicker();
    expect(tabs()).toEqual(["stickers", "emoji"]);
  });

  test("while editing a message no sticker can be sent: the emoji tab alone, its tab bar still there", async () => {
    const editing = { messageId: 5n, spaceId: "s1", channelId: "c1", text: "hi", entities: [] } as any;
    composer({ spaceId: "s1", channelId: "c1", editing });
    await openPicker();
    expect(tabs()).toEqual(["emoji"]);
  });

  test("a member who may add expressions is sent to the space's expression settings from the rail", async () => {
    seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 1)]);
    composer();
    await openPicker();
    $('[data-rail="manage"]')!.click();
    await until(() => !picker());
    const windows = useWindow();
    expect(windows.serverSettingsOpen).toBe(true);
    expect(windows.serverSettingsCategory).toBe("expressions");
  });

  test("in a direct chat: every space's stickers, sent to the peer; no way to settings", async () => {
    seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 1)]);
    seed("s2", [pack("s2", "sp2", ExpressionKind.Sticker, "other", 2)]);
    const loadAll = vi.spyOn(useExpressionsStore(), "ensureLoadedAll");
    composer({ receiverId: "u2" });
    await openPicker();
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect($('[data-rail="manage"]')).toBeNull();
    await userEvent.click($('[data-tab="stickers"]')!);
    await until(() => document.querySelectorAll(".xp-cell--sticker").length === 3);
    expect([...document.querySelectorAll<HTMLElement>(".xp-group")].map((s) => s.dataset.groupId)).toEqual([
      "pack:sp",
      "pack:sp2",
    ]);
    expect([...document.querySelectorAll<HTMLElement>(".xp-rail__item")].map((b) => b.dataset.rail)).toEqual([
      "space:s1",
      "pack:sp",
      "space:s2",
      "pack:sp2",
    ]);

    await userEvent.click(document.querySelectorAll<HTMLElement>(".xp-cell--sticker")[2]);
    await until(() => h.sendDirect.mock.calls.length === 1);
    const [peer, text, entities] = h.sendDirect.mock.calls[0];
    expect([peer, text]).toEqual(["u2", ""]);
    expect((entities as MessageEntitySticker[]).map((e) => [e.itemId, e.spaceId])).toEqual([["other-1", "s2"]]);
    expect(h.sendMessage).not.toHaveBeenCalled();
  });
});

describe("Open pack, from a custom emoji or sticker in the chat", () => {
  const space = (spaceId: string, name: string) =>
    ({ spaceId, name, description: "", avatarFieldId: null, topBannerFileId: null }) as never;

  /**
   * The attribution popover of one item, opened, with its space read; its trigger stands in for the
   * item in a message.
   */
  async function attribution(target: ExpressionInfoTarget) {
    const info = mount(ExpressionInfoPopover, {
      props: { target },
      slots: { default: '<button type="button" data-testid="info-trigger">item</button>' },
      attachTo: document.body,
      global: { provide: { [EXPRESSION_RESOLVER as symbol]: createStoreResolver() } },
    });
    mounted.push(info);
    await userEvent.click($("[data-testid=info-trigger]")!);
    await until(() => !!$("[data-testid=expression-info-space-name]"));
  }

  const grid = () => $(".xp-grid")!;
  const activeRail = () => [...document.querySelectorAll<HTMLElement>('.xp-rail__item[aria-current="true"]')].map((b) => b.dataset.rail);
  /** Where an element sits in the grid's viewport. */
  const offsetInGrid = (el: Element) => el.getBoundingClientRect().top - grid().getBoundingClientRect().top;

  beforeEach(async () => {
    await db.servers.put(space("s1", "Cats"));
    await db.servers.put(space("s2", "Dogs"));
  });

  test("a sticker: the composer's picker opens on the sticker tab at its pack, current in the rail", async () => {
    seed("s1", ["p1", "p2", "p3", "p4"].map((id) => pack("s1", id, ExpressionKind.Sticker, id, 9)));
    composer();
    await attribution({ kind: "sticker", itemId: "p3-0", spaceId: "s1" });

    await userEvent.click($("[data-testid=expression-info-open-pack]")!);
    await until(() => !!picker() && activeRail().includes("pack:p3"));
    expect($('[data-tab="stickers"]')?.getAttribute("aria-selected")).toBe("true");
    expect(Math.abs(offsetInGrid($('[data-group-id="pack:p3"]')!))).toBeLessThan(2);

    // The popover closing behind it neither dismisses the picker nor takes its search's focus.
    await until(() => !$("[data-testid=expression-info]"));
    await new Promise((r) => setTimeout(r, 300));
    expect(picker()).not.toBeNull();
    expect(activeRail()).toEqual(["space:s1", "pack:p3"]);
    expect(document.activeElement).toBe($(".xp-search__input"));
  });

  test("a custom emoji of a space's second pack: the emoji tab, that pack's title right under the space's header", async () => {
    seed("s1", [pack("s1", "blobs", ExpressionKind.Emoji, "bl", 60), pack("s1", "parrots", ExpressionKind.Emoji, "pa", 12)]);
    composer();
    await attribution({ kind: "emoji", itemId: "pa-3", spaceId: "s1", name: "pa_3" });

    await userEvent.click($("[data-testid=expression-info-open-pack]")!);
    await until(() => !!picker() && grid().scrollTop > 0);
    expect($('[data-tab="emoji"]')?.getAttribute("aria-selected")).toBe("true");
    expect(activeRail()).toEqual(["space:s1"]);
    // Under the sticky space header (32px).
    expect(Math.abs(offsetInGrid($('[data-section-id="pack:parrots"]')!) - 32)).toBeLessThan(2);
  });

  test("another space's pack is not in this space's picker, so the popover does not offer it", async () => {
    seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 2)]);
    seed("s2", [pack("s2", "dogs", ExpressionKind.Sticker, "dg", 2)]);
    composer();
    await attribution({ kind: "sticker", itemId: "dg-0", spaceId: "s2" });

    expect($("[data-testid=expression-info-space-name]")?.textContent?.trim()).toBe("Dogs");
    expect($("[data-testid=expression-info-open-pack]")).toBeNull();
    expect(picker()).toBeNull();
  });

  test("in a direct chat every space's packs are there, so another space's opens too", async () => {
    seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 2)]);
    seed("s2", [pack("s2", "dogs", ExpressionKind.Sticker, "dg", 2)]);
    composer({ receiverId: "u2" });
    await attribution({ kind: "sticker", itemId: "dg-0", spaceId: "s2" });

    await userEvent.click($("[data-testid=expression-info-open-pack]")!);
    await until(() => !!picker() && activeRail().includes("pack:dogs"));
  });

  test("the composer gone, the popover no longer offers it", async () => {
    seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 2)]);
    const { wrapper } = composer();
    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);
    await attribution({ kind: "sticker", itemId: "st-0", spaceId: "s1" });
    expect($("[data-testid=expression-info-open-pack]")).toBeNull();
  });
});
