/**
 * The composer's expressions picker in a real browser, over a seeded expressions store: a sticker is
 * sent at once as a message of no text and one sticker entity, and the picker closes with focus back
 * in the input; a custom emoji goes into the input as a placeholder the value carries as an entity,
 * and the picker stays open for the next pick; Esc closes the picker only. In a direct chat the
 * picker offers every loaded space's packs and no way to their settings.
 */

import "../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { userEvent } from "vitest/browser";
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
    flags: { stickersActive: ref(true), gifsSelectorActive: ref(true) },
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
import { EXPRESSION_RESOLVER, createStoreResolver } from "@/lib/expressions/resolver";

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
});

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  h.flags.stickersActive.value = true;
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
    expect(tabs()).toEqual(["emoji", "stickers", "gifs"]);
    expect(document.activeElement).toBe($(".xp-search__input"));
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
    await userEvent.click($('[data-cell="0:0"]')!);
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

  test("the sticker tab needs the stickers flag, the GIF tab the GIF flag", async () => {
    h.flags.stickersActive.value = false;
    composer();
    await openPicker();
    expect(tabs()).toEqual(["emoji", "gifs"]);
    await userEvent.keyboard("{Escape}");
    await until(() => !picker());

    h.flags.stickersActive.value = true;
    h.flags.gifsSelectorActive.value = false;
    await openPicker();
    expect(tabs()).toEqual(["emoji", "stickers"]);
  });

  test("with no custom emoji yet, a member who may add them is sent to the space's expression settings", async () => {
    seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 1)]);
    composer();
    await openPicker();
    $(".xp-footer__link")!.click();
    await until(() => !picker());
    const windows = useWindow();
    expect(windows.serverSettingsOpen).toBe(true);
    expect(windows.serverSettingsCategory).toBe("expressions");
  });

  test("in a direct chat: every loaded space's stickers, sent to the peer; no way to settings", async () => {
    seed("s1", [pack("s1", "sp", ExpressionKind.Sticker, "st", 1)]);
    seed("s2", [pack("s2", "sp2", ExpressionKind.Sticker, "other", 2)]);
    composer({ receiverId: "u2" });
    await openPicker();
    expect($(".xp-footer__link")).toBeNull();
    await userEvent.click($('[data-tab="stickers"]')!);
    await until(() => document.querySelectorAll(".xp-cell--sticker").length === 3);
    expect([...document.querySelectorAll<HTMLElement>(".xp-section")].map((s) => s.dataset.sectionId)).toEqual([
      "pack:sp",
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
