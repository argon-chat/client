/**
 * Emoji suggestions in the composer, in a real browser over the real keyword data: `:thu` opens the
 * strip with 👍 first and selected, Tab puts it in; a lone word waits, selects nothing, and Enter
 * still sends; Esc closes the strip only; the user's skin tone applies. `:)` turns into 🙂 as typed
 * and Backspace brings it back; `:joy:` on its closing colon. A typed emoji offers the space's custom
 * emoji tagged with it; a one-emoji message offers stickers, sent at a click. Each setting turns its
 * part off, and the master switch all of it.
 */

import "../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { page, userEvent } from "vitest/browser";
import { createPinia, setActivePinia } from "pinia";
import { emojiRegistry, initializeEmojix } from "@argon-chat/emojix";
import { EntityType, ExpressionFormat, ExpressionKind, MessageEntitySticker, type ExpressionItem, type ExpressionPack } from "@argon/glue";

const h = await vi.hoisted(async () => {
  const { computed, defineComponent, reactive, ref } = await import("vue");
  const stub = (name: string) => ({ default: defineComponent({ name, setup: () => () => null }) });
  return { stub, sendMessage: vi.fn(), computed, reactive, ref };
});

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k, currentLocale: "en" }) }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast() {} }) }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: { SendMessage: h.sendMessage },
    userChatInteractions: { SendDirectMessage: vi.fn() },
    spaceExpressionInteraction: {
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
  usePexStore: () => ({ hasIn: () => true, has: () => true, hasInSpace: () => true }),
}));
vi.mock("@/store/features/featureFlagsStore", () => ({ useFeatureFlags: () => ({ gifsSelectorActive: h.ref(false) }) }));
vi.mock("@/store/ui/configStore", () => ({ useConfigStore: () => ({ devModeEnabled: false }) }));
vi.mock("@/lib/linkPreview/settings", () => ({ sendLinkPreviews: h.ref(false), showLinkPreviews: h.ref(false) }));
vi.mock("@/composables/useLinkPreviewDraft", () => ({
  useLinkPreviewDraft: () =>
    h.reactive({ visible: false, loading: false, url: null, preview: null, dismiss() {}, takeStub: () => null }),
}));
vi.mock("@/composables/useChannelDraft", () => ({
  useChannelDraft: () => ({ flush: async () => {}, blurred() {}, clear: async () => {}, load: async () => {}, ready: Promise.resolve() }),
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
import { db } from "@/store/db/dexie";
import { EXPRESSION_RESOLVER, createStoreResolver } from "@/lib/expressions/resolver";
import { suggestIndices } from "@/lib/chat/emojiSuggest/indices";
import {
  emojiSuggestionsEnabled,
  replaceEmoticons,
  suggestCustomEmoji,
  suggestEmoji,
  suggestStickers,
} from "@/lib/chat/emojiSuggest/settings";

const item = (itemId: string, kind: ExpressionKind, emoji: string[], sortOrder = 0): ExpressionItem => ({
  itemId,
  packId: kind === ExpressionKind.Emoji ? "ep" : "sp",
  spaceId: "s1",
  kind,
  format: ExpressionFormat.Lottie,
  name: itemId.replace(/-/g, "_"),
  fileId: `file-${itemId}`,
  thumbFileId: null,
  width: kind === ExpressionKind.Emoji ? 100 : 512,
  height: kind === ExpressionKind.Emoji ? 100 : 512,
  fileSize: 1000,
  emoji,
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder,
  downloadUrl: "https://cdn.example/item.json",
  thumbUrl: null,
  creatorId: null,
});

const pack = (packId: string, kind: ExpressionKind, items: ExpressionItem[]): ExpressionPack => ({
  packId,
  spaceId: "s1",
  kind,
  title: packId,
  slug: packId,
  coverItemId: null,
  sortOrder: kind === ExpressionKind.Sticker ? 0 : 1,
  version: 1n,
  items,
  creatorId: null,
});

function seed(packs: ExpressionPack[]) {
  useExpressionsStore().bySpace.set("s1", { version: "v1", packs, loadedAt: Date.now() });
}

const mounted: VueWrapper[] = [];

async function composer(props: Record<string, unknown> = { spaceId: "s1", channelId: "c1" }) {
  const wrapper = mount(EnterText, {
    props: { replyTo: null, ...props },
    attachTo: document.body,
    global: { provide: { [EXPRESSION_RESOLVER as symbol]: createStoreResolver() } },
  });
  mounted.push(wrapper);
  const input = wrapper.findComponent(MessageInput);
  const editor = input.find<HTMLElement>("[contenteditable]").element;
  await userEvent.click(editor);
  if (emojiSuggestionsEnabled.value) await until(() => suggestIndices.value.length > 0);
  return { wrapper, editor, value: () => (input.vm as unknown as { getValue(): { text: string; entities: any[] } }).getValue() };
}

async function until(check: () => boolean, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
const strip = () => $("[data-testid=emoji-suggest]");
const cells = () => [...document.querySelectorAll<HTMLElement>("[data-testid=emoji-suggest-item]")];
const selected = () => cells().filter((c) => c.getAttribute("aria-selected") === "true");
const nameOf = (hexcode: string) => emojiRegistry.getByHexcode(hexcode)!.name;
/** An emoji arrives as one insertText (an OS picker, an IME); the test keyboard would send its surrogate halves. */
const typeEmoji = (emoji: string) => document.execCommand("insertText", false, emoji);

beforeAll(async () => {
  await initializeEmojix();
  await page.viewport(1280, 900);
});

beforeEach(async () => {
  localStorage.clear();
  setActivePinia(createPinia());
  await db.servers.clear();
  for (const setting of [emojiSuggestionsEnabled, suggestEmoji, replaceEmoticons, suggestCustomEmoji, suggestStickers]) setting.value = true;
  h.sendMessage.mockReset();
  h.sendMessage.mockImplementation(async (spaceId: string, channelId: string) => ({
    isSuccessSendMessage: () => true,
    isFailedSendMessage: () => false,
    readback: { messageId: 7n, channelId, spaceId },
  }));
  seed([]);
});

afterEach(async () => {
  for (const w of mounted.splice(0)) w.unmount();
  await flushPromises();
  document.body.innerHTML = "";
  // Storage is shared with the other browser test files: the switches are left as they were found, on.
  for (const setting of [emojiSuggestionsEnabled, suggestEmoji, replaceEmoticons, suggestCustomEmoji, suggestStickers]) setting.value = true;
});

describe("the strip", () => {
  test("`:thu` shows 👍 first and selected; Tab puts it in and the strip closes", async () => {
    const { value } = await composer();
    await userEvent.keyboard(":thu");
    await until(() => cells()[0]?.title === nameOf("1f44d"));
    expect(strip()!.getAttribute("role")).toBe("listbox");
    expect(selected()).toEqual([cells()[0]]);
    expect(cells().map((c) => c.title)).toContain(nameOf("1f44e"));

    await userEvent.keyboard("{Tab}");
    await until(() => value().text === "👍");
    await until(() => !strip());
  });

  test("Right and Left move the selection and wrap; Enter puts the selected one in", async () => {
    const { value } = await composer();
    await userEvent.keyboard(":thu");
    await until(() => cells().length > 2 && cells()[0].title === nameOf("1f44d"));
    await userEvent.keyboard("{ArrowRight}");
    expect(selected()).toEqual([cells()[1]]);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(selected()).toEqual([cells()[cells().length - 1]]);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    const second = cells()[1].title;
    expect(second).toBe(nameOf("1f44e"));
    await userEvent.keyboard("{Enter}");
    await until(() => value().text === "👎");
    expect(h.sendMessage).not.toHaveBeenCalled();
  });

  test("a lone word waits, selects nothing, and Enter sends the message", async () => {
    const { value } = await composer();
    await userEvent.keyboard("fire");
    expect(strip()).toBeNull();
    await until(() => cells()[0]?.title === nameOf("1f525"));
    expect(selected()).toEqual([]);

    await userEvent.keyboard("{Enter}");
    await until(() => h.sendMessage.mock.calls.length === 1);
    expect(h.sendMessage.mock.calls[0][2]).toBe("fire");
    expect(value().text).toBe("");
    await until(() => !strip());
  });

  test("a click puts the emoji in and focus stays in the input", async () => {
    const { editor, value } = await composer();
    await userEvent.keyboard("hi :fir");
    await until(() => cells().some((c) => c.title === nameOf("1f525")));
    await userEvent.click(cells().find((c) => c.title === nameOf("1f525"))!);
    await until(() => value().text === "hi 🔥");
    expect(document.activeElement).toBe(editor);
  });

  test("Esc closes the strip only: the reply stays", async () => {
    const { wrapper } = await composer({ spaceId: "s1", channelId: "c1", replyTo: { messageId: 5n } });
    await userEvent.keyboard(":thu");
    await until(() => !!strip());
    await userEvent.keyboard("{Escape}");
    await until(() => !strip());
    expect(wrapper.emitted("clear-reply")).toBeUndefined();
  });

  test("the user's skin tone is applied", async () => {
    localStorage.setItem("argon_emoji_skin_tone", JSON.stringify("medium"));
    const { value } = await composer();
    await userEvent.keyboard(":thu");
    await until(() => cells()[0]?.title === nameOf("1f44d-1f3fd"));
    await userEvent.keyboard("{Tab}");
    await until(() => value().text === "👍🏽");
  });

  test("moving the caret closes it", async () => {
    await composer();
    await userEvent.keyboard("x :thu");
    await until(() => !!strip());
    await userEvent.keyboard("{Home}");
    await until(() => !strip());
  });
});

describe("instant replacements", () => {
  test("`:)` turns into 🙂 and a space; Backspace right after brings `:)` back", async () => {
    const { value } = await composer();
    await userEvent.keyboard(":)");
    await until(() => value().text === "🙂 ");
    await userEvent.keyboard("{Backspace}");
    await until(() => value().text === ":)");
  });

  test("the user's own space after it is not doubled", async () => {
    const { value } = await composer();
    await userEvent.keyboard(":) ok");
    await until(() => value().text === "🙂 ok");
  });

  test("`:D` waits for the next boundary, which stays", async () => {
    const { value } = await composer();
    await userEvent.keyboard(":D");
    expect(value().text).toBe(":D");
    await userEvent.keyboard(",");
    await until(() => value().text === "😄,");
  });

  test("`:joy:` becomes 😂 on its closing colon", async () => {
    const { value } = await composer();
    await userEvent.keyboard("so :joy:");
    await until(() => value().text === "so 😂 ");
  });

  test("a custom emoji of that name comes first", async () => {
    seed([pack("ep", ExpressionKind.Emoji, [item("joy", ExpressionKind.Emoji, [])])]);
    const { value } = await composer();
    await userEvent.keyboard(":joy:");
    await until(() => value().entities.length === 1);
    expect(value().text).toBe(":joy: ");
    expect(value().entities[0]).toMatchObject({ type: EntityType.CustomEmoji, offset: 0, itemId: "joy" });
  });
});

describe("custom emoji and stickers for an emoji", () => {
  test("a typed emoji offers the space's custom emoji tagged with it; a click replaces it", async () => {
    seed([pack("ep", ExpressionKind.Emoji, [item("smiley-blob", ExpressionKind.Emoji, ["🙂"]), item("other", ExpressionKind.Emoji, ["😺"])])]);
    const { value } = await composer();
    await userEvent.keyboard("hi ");
    typeEmoji("🙂");
    await until(() => cells().length === 1);
    expect(cells()[0].dataset.type).toBe("custom");
    expect(cells()[0].title).toBe(":smiley_blob:");
    expect(selected()).toEqual([]);

    await userEvent.click(cells()[0]);
    await until(() => value().entities.length === 1);
    expect(value().text).toBe("hi :smiley_blob:");
  });

  test("a message of one emoji offers stickers tagged with it; a click sends the sticker and clears the text", async () => {
    seed([pack("sp", ExpressionKind.Sticker, [item("wave", ExpressionKind.Sticker, ["🙂"]), item("cat", ExpressionKind.Sticker, ["😺"])])]);
    const { value } = await composer();
    typeEmoji("🙂");
    await until(() => cells().length === 1);
    expect(cells()[0].dataset.type).toBe("sticker");

    await userEvent.click(cells()[0]);
    await until(() => h.sendMessage.mock.calls.length === 1);
    const [, , text, entities] = h.sendMessage.mock.calls[0];
    expect(text).toBe("");
    expect((entities as MessageEntitySticker[]).map((e) => e.itemId)).toEqual(["wave"]);
    await until(() => value().text === "");
    expect(useExpressionsStore().recentStickers[0]).toBe("wave");
  });
});

describe("settings", () => {
  test("replace emoticons off: `:)` stays", async () => {
    replaceEmoticons.value = false;
    const { value } = await composer();
    await userEvent.keyboard(":) :joy:");
    await pause(100);
    expect(value().text).toBe(":) :joy:");
  });

  test("suggest emoji off: no strip for `:thu` or a lone word", async () => {
    suggestEmoji.value = false;
    await composer();
    await userEvent.keyboard(":thu");
    await pause(400);
    expect(strip()).toBeNull();
  });

  test("custom emoji off: a typed emoji offers nothing", async () => {
    seed([pack("ep", ExpressionKind.Emoji, [item("smiley-blob", ExpressionKind.Emoji, ["🙂"])])]);
    suggestCustomEmoji.value = false;
    await composer();
    await userEvent.keyboard("hi ");
    typeEmoji("🙂");
    await pause(200);
    expect(strip()).toBeNull();
  });

  test("stickers off: a one-emoji message offers nothing", async () => {
    seed([pack("sp", ExpressionKind.Sticker, [item("wave", ExpressionKind.Sticker, ["🙂"])])]);
    suggestStickers.value = false;
    await composer();
    typeEmoji("🙂");
    await pause(200);
    expect(strip()).toBeNull();
  });

  test("the master switch off: no strip, no keyword data held, emoticons stay; the text table still works", async () => {
    emojiSuggestionsEnabled.value = false;
    await nextTick();
    const { value } = await composer();
    await userEvent.keyboard(":thu");
    await pause(400);
    expect(strip()).toBeNull();
    expect(suggestIndices.value).toEqual([]);
    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}:) :joy:");
    await pause(100);
    expect(value().text).toBe(":) :joy:");

    await userEvent.keyboard(" a--");
    await until(() => value().text === ":) :joy: a—");
    await userEvent.keyboard("{Backspace}");
    await until(() => value().text === ":) :joy: a--");
  });
});
