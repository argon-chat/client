/**
 * The composer's suggestions with the master switch: off, the composable does nothing at all (no
 * keyword data, no replacements, no listeners); on, focus loads the data and typing `:)` replaces it.
 */

import { describe, expect, test, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { defineComponent, h as render, nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { initializeEmojix } from "@argon-chat/emojix";

const h = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn() }));

vi.mock("@argon-chat/emojix", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@argon-chat/emojix")>()),
  loadKeywordIndex: h.load,
  releaseKeywordIndexes: h.release,
}));
vi.mock("@/store/data/expressionsStore", () => ({
  useExpressionsStore: () => ({
    itemsOf: () => [],
    recentEmoji: [],
    recentStickerItems: () => [],
    searchStickers: () => [],
    pushRecentEmoji() {},
    pushRecentSticker() {},
  }),
}));

import type { MessageInputApi } from "@/components/chats/messageInput";
import { useEmojiSuggest, type EmojiSuggest } from "@/composables/useEmojiSuggest";
import { emojiSuggestionsEnabled } from "@/lib/chat/emojiSuggest/settings";

let text = "";
let wrapper: VueWrapper | null = null;

function fakeEditor() {
  const el = document.createElement("div");
  document.body.append(el);
  return {
    el,
    getCursorOffset: () => text.length,
    getText: () => text,
    insertEmoji: vi.fn(),
    insertCustomEmoji: vi.fn(() => true),
    insertTextAtCursor: vi.fn(),
    replaceRange: vi.fn(),
    setCursorOffset: vi.fn(),
  };
}

function setup() {
  const editor = fakeEditor();
  let suggest!: EmojiSuggest;
  wrapper = mount(
    defineComponent({
      setup() {
        suggest = useEmojiSuggest({
          editor: () => editor as unknown as MessageInputApi,
          text: () => text,
          placed: () => [],
          spaceId: () => "s1",
          canSendStickers: () => true,
          blocked: () => false,
          uiLocale: () => "en",
          sendSticker: () => {},
        });
        return () => render("div");
      },
    }),
  );
  return { editor, suggest };
}

/** The user typed `typed` at the end of the text. */
function type(suggest: EmojiSuggest, typed: string) {
  const previous = text;
  text += typed;
  return suggest.onInput(previous);
}

beforeAll(async () => {
  await initializeEmojix();
});

beforeEach(() => {
  localStorage.clear();
  text = "";
  h.load.mockReset();
  h.load.mockImplementation(async (locale: string) => ({ locale, longestKey: 10, matchPrefix: () => [], matchExact: () => [] }));
  emojiSuggestionsEnabled.value = true;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  emojiSuggestionsEnabled.value = true;
});

describe("with suggestions off", () => {
  test("focus loads no keyword data; no strip, no listener; emoticons and `:codes:` stay as typed", async () => {
    emojiSuggestionsEnabled.value = false;
    await nextTick();
    const listen = vi.spyOn(document, "addEventListener");
    const { editor, suggest } = setup();

    suggest.onFocus();
    expect(h.load).not.toHaveBeenCalled();

    expect(type(suggest, ":)")).toBe(false);
    expect(type(suggest, " :joy:")).toBe(false);
    text = ":D";
    expect(type(suggest, " ")).toBe(false);
    expect(editor.insertEmoji).not.toHaveBeenCalled();
    expect(editor.insertCustomEmoji).not.toHaveBeenCalled();
    text = ":thu";
    suggest.update();
    expect(suggest.state.mode).toBeNull();
    expect(suggest.onKeydown(new KeyboardEvent("keydown", { key: "Backspace" }))).toBe(false);
    expect(listen.mock.calls.some(([name]) => name === "selectionchange")).toBe(false);
    expect(h.load).not.toHaveBeenCalled();
  });

  test("the text table still applies, and Backspace right after puts the typed text back", async () => {
    emojiSuggestionsEnabled.value = false;
    await nextTick();
    const { editor, suggest } = setup();

    text = "a-";
    expect(type(suggest, "-")).toBe(true);
    expect(editor.replaceRange).toHaveBeenCalledWith(1, 3, "—");

    text = "a—";
    const backspace = new KeyboardEvent("keydown", { key: "Backspace", cancelable: true });
    expect(suggest.onKeydown(backspace)).toBe(true);
    expect(backspace.defaultPrevented).toBe(true);
    expect(editor.replaceRange).toHaveBeenLastCalledWith(1, 2, "--");
  });

  test("`<3` is the ♥ character, not the emoji", async () => {
    emojiSuggestionsEnabled.value = false;
    await nextTick();
    const { editor, suggest } = setup();
    text = "I<";
    expect(type(suggest, "3")).toBe(true);
    expect(editor.replaceRange).toHaveBeenCalledWith(1, 3, "♥");
    expect(editor.insertEmoji).not.toHaveBeenCalled();
  });

  test("turned off while mounted: the strip closes and the listener goes", async () => {
    const unlisten = vi.spyOn(document, "removeEventListener");
    const { suggest } = setup();
    text = "🙂";
    suggest.update();
    emojiSuggestionsEnabled.value = false;
    await nextTick();
    expect(suggest.state.mode).toBeNull();
    expect(unlisten.mock.calls.some(([name]) => name === "selectionchange")).toBe(true);
  });
});

describe("with suggestions on", () => {
  test("focus loads the keyword data; `:)` is replaced by 🙂 and a space", () => {
    const { editor, suggest } = setup();
    suggest.onFocus();
    expect(h.load).toHaveBeenCalled();

    expect(type(suggest, ":")).toBe(false);
    expect(type(suggest, ")")).toBe(true);
    expect(editor.insertEmoji).toHaveBeenCalledWith(expect.objectContaining({ hexcode: expect.stringMatching(/^1f642/) }), { start: 0, end: 2 });
    expect(editor.insertTextAtCursor).toHaveBeenCalledWith(" ");
  });

  test("a paste is not typing: nothing is replaced", () => {
    const { editor, suggest } = setup();
    suggest.markPaste();
    expect(type(suggest, ":)")).toBe(false);
    expect(editor.insertEmoji).not.toHaveBeenCalled();
  });
});
