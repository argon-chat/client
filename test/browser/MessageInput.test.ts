/**
 * The composer's input in a real browser: typed text and an inserted custom emoji read back as
 * `{ text, entities }` with UTF-16 offsets (a surrogate-pair emoji before it counts two), Backspace
 * takes the whole placeholder, a text set from outside keeps the placeholders it does not touch,
 * and a paste is plain text.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { userEvent } from "vitest/browser";
import { initializeEmojix } from "@argon-chat/emojix";
import type { ExpressionItem, MessageEntityCustomEmoji } from "@argon/glue";

// A 1×1 red PNG for every static emoji.
const { PNG } = vi.hoisted(() => ({
  PNG: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
}));

vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: () => PNG,
  cdnFetchUrl: () => PNG,
  cdnCrossOrigin: () => undefined,
}));

import MessageInput from "@/components/chats/MessageInput.vue";
import type { MessageInputApi } from "@/components/chats/messageInput";

const item = (name: string): ExpressionItem =>
  ({
    itemId: `item-${name}`,
    packId: "pack",
    spaceId: "space",
    kind: 1,
    format: 0,
    name,
    fileId: `file-${name}`,
    thumbFileId: null,
    width: 64,
    height: 64,
    fileSize: 1,
    emoji: [],
    keywords: [],
    outline: null,
    textColor: false,
    sortOrder: 0,
    downloadUrl: null,
    thumbUrl: null,
  }) as unknown as ExpressionItem;

const mounted: VueWrapper[] = [];

function show(modelValue = "") {
  const wrapper = mount(MessageInput, { props: { modelValue }, attachTo: document.body });
  mounted.push(wrapper);
  const editor = wrapper.find<HTMLElement>("[contenteditable]").element;
  return { wrapper, editor, api: wrapper.vm as unknown as MessageInputApi };
}

const shape = (entities: MessageEntityCustomEmoji[]) => entities.map((e) => [e.offset, e.length, e.itemId]);

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("MessageInput", () => {
  test("typing, then a custom emoji at the caret, then more typing", async () => {
    const { wrapper, editor, api } = show();
    await userEvent.click(editor);
    await userEvent.keyboard("hi ");
    // An emoji arrives as one insertText (an OS picker, an IME); the test keyboard would send
    // its surrogate halves as two keys.
    document.execCommand("insertText", false, "😀 ");
    expect(api.getValue().text).toBe("hi 😀 ");

    expect(api.insertCustomEmoji(item("wave"))).toBe(true);
    await userEvent.keyboard(" end");

    const value = api.getValue();
    expect(value.text).toBe("hi 😀 :wave: end");
    // "hi 😀 " is 6 UTF-16 units: the emoji is a surrogate pair.
    expect(shape(value.entities)).toEqual([[6, 6, "item-wave"]]);
    expect(editor.querySelectorAll(".ce[contenteditable=false]")).toHaveLength(1);

    await nextTick();
    const texts = wrapper.emitted("update:modelValue")!;
    expect(texts[texts.length - 1]).toEqual(["hi 😀 :wave: end"]);
    const entities = wrapper.emitted("update:entities")!;
    expect(shape(entities[entities.length - 1][0] as MessageEntityCustomEmoji[])).toEqual([[6, 6, "item-wave"]]);
  });

  test("inserted in the middle, the text after it moves along", async () => {
    const { editor, api } = show();
    await userEvent.click(editor);
    await userEvent.keyboard("abcdef");
    api.setCursorOffset(3);
    api.insertCustomEmoji(item("cat"));
    expect(api.getValue().text).toBe("abc:cat:def");
    expect(shape(api.getValue().entities)).toEqual([[3, 5, "item-cat"]]);
    expect(api.getCursorOffset()).toBe(8);

    // Two side by side.
    api.insertCustomEmoji(item("dog"));
    expect(api.getValue().text).toBe("abc:cat::dog:def");
    expect(shape(api.getValue().entities)).toEqual([[3, 5, "item-cat"], [8, 5, "item-dog"]]);
  });

  test("a unicode emoji put in over a range before more text goes in once", async () => {
    // Drawn as sprites (atoms), which is what Chromium's insertHTML reports as failed here.
    await initializeEmojix();
    const { editor, api } = show();
    await userEvent.click(editor);
    await userEvent.keyboard(":D,");
    api.insertEmoji("😄", { start: 0, end: 2 });
    expect(api.getValue().text).toBe("😄,");
    expect(editor.querySelectorAll("[data-emoji]")).toHaveLength(1);
    expect(editor.querySelector("[data-ins]")).toBeNull();

    api.setCursorOffset(2);
    api.insertEmoji("👍");
    expect(api.getValue().text).toBe("😄👍,");
    expect(editor.querySelectorAll("[data-emoji]")).toHaveLength(2);
  });

  test("Backspace takes the whole placeholder", async () => {
    const { editor, api } = show();
    await userEvent.click(editor);
    await userEvent.keyboard("x");
    api.insertCustomEmoji(item("wave"));
    expect(api.getValue().text).toBe("x:wave:");

    await userEvent.keyboard("{Backspace}");
    expect(api.getValue()).toEqual({ text: "x", entities: [] });
    expect(editor.querySelector(".ce")).toBeNull();

    await userEvent.keyboard("{Backspace}");
    expect(api.getValue().text).toBe("");
  });

  test("Shift+Enter breaks the line", async () => {
    const { editor, api } = show();
    await userEvent.click(editor);
    await userEvent.keyboard("a{Shift>}{Enter}{/Shift}b");
    expect(api.getValue().text).toBe("a\nb");
  });

  test("a text set from outside keeps the placeholders it does not touch", async () => {
    const { wrapper, editor, api } = show();
    await userEvent.click(editor);
    await userEvent.keyboard("hi ");
    api.insertCustomEmoji(item("wave"));
    await userEvent.keyboard(" @al");
    const placeholder = editor.querySelector(".ce");

    // A mention picked (the composer rewrites the text): the placeholder is the same node.
    await wrapper.setProps({ modelValue: "hi :wave: @Alice " });
    expect(api.getValue().text).toBe("hi :wave: @Alice ");
    expect(shape(api.getValue().entities)).toEqual([[3, 6, "item-wave"]]);
    expect(editor.querySelector(".ce")).toBe(placeholder);

    // Changed on both sides at once: drawn again, the emoji carried over.
    await wrapper.setProps({ modelValue: "oh hi :wave: @Alice!" });
    expect(api.getValue().text).toBe("oh hi :wave: @Alice!");
    expect(shape(api.getValue().entities)).toEqual([[6, 6, "item-wave"]]);

    await wrapper.setProps({ modelValue: "" });
    expect(api.getValue()).toEqual({ text: "", entities: [] });
  });

  test("undo brings back a placeholder Backspace took", async () => {
    const { editor, api } = show();
    await userEvent.click(editor);
    await userEvent.keyboard("x");
    api.insertCustomEmoji(item("wave"));
    await userEvent.keyboard("{Backspace}");
    expect(api.getValue().text).toBe("x");
    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");
    expect(api.getValue().text).toBe("x:wave:");
    expect(shape(api.getValue().entities)).toEqual([[1, 6, "item-wave"]]);
  });

  test("setValue draws placeholders back from entities (an edit, a draft)", () => {
    const { editor, api } = show();
    const [entity] = [item("wave")].map((i) => ({ ...i, offset: 4, length: 6, type: 24, version: 1, downloadUrl: null }));
    api.setValue({ text: "hey :wave: you", entities: [entity as unknown as MessageEntityCustomEmoji] });
    expect(editor.querySelectorAll(".ce")).toHaveLength(1);
    expect(shape(api.getValue().entities)).toEqual([[4, 6, "item-wave"]]);
  });

  test("a paste is plain text, whatever HTML came with it", async () => {
    const { editor, api } = show();
    await userEvent.click(editor);
    const data = new DataTransfer();
    data.setData("text/html", "<b>bold</b> <img src=x onerror=alert(1)>");
    data.setData("text/plain", "bold text\nline two");
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    expect(api.getValue().text).toBe("bold text\nline two");
    expect(editor.querySelector("b, img")).toBeNull();
  });
});
