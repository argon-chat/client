/**
 * MessageInput under vue-native: a `<textarea>` with the rich composer's props, events and API, so
 * EnterText drives it unchanged. Run twice: with the selection API every browser has, and without it,
 * as vue-native's field is today — there the caret is read from the edits (lib/vn/useTextComposer.ts).
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import type { ExpressionItem, MessageEntityCustomEmoji } from "@argon/glue";
import { customEmojiFromItem } from "@/lib/chat/customEmoji";

vi.mock("@/lib/vn", () => ({ isVn: true }));
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: () => "",
  cdnFetchUrl: () => "",
  cdnCrossOrigin: () => undefined,
}));

import MessageInput from "@/components/chats/MessageInput.vue";
import type { MessageInputApi } from "@/components/chats/messageInput";

const item = (name: string) =>
  ({ itemId: `item-${name}`, spaceId: "space", format: 0, fileId: `file-${name}`, name, textColor: false, downloadUrl: null }) as unknown as ExpressionItem;

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

/** `selection: false` takes the field's selection API away, as vue-native's textarea has none. */
function show(props: Record<string, unknown> = {}, { selection = true } = {}) {
  const wrapper = mount(MessageInput, { props, attachTo: document.body });
  mounted.push(wrapper);
  const field = wrapper.find("textarea").element as HTMLTextAreaElement;
  if (!selection) {
    Object.defineProperty(field, "selectionStart", { value: undefined, configurable: true });
    Object.defineProperty(field, "selectionEnd", { value: undefined, configurable: true });
    Object.defineProperty(field, "setSelectionRange", { value: undefined, configurable: true });
  }
  return { wrapper, field, api: wrapper.vm as unknown as MessageInputApi };
}

/** The user's edit: the field holds `text` (caret at `caret` when it can say) and reports it. */
function edit(field: HTMLTextAreaElement, text: string, caret = text.length) {
  field.value = text;
  if (typeof field.setSelectionRange === "function") field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event("input"));
}

const key = (field: HTMLTextAreaElement, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
  field.dispatchEvent(event);
  return event;
};

const lastEntities = (wrapper: VueWrapper) =>
  ((wrapper.emitted("update:entities")?.at(-1)?.[0] ?? []) as MessageEntityCustomEmoji[]).map((e) => [e.offset, e.itemId]);

describe("MessageInput as a <textarea>", () => {
  test("renders a field, not a contenteditable, with the placeholder and the disabled state", () => {
    const { wrapper, field } = show({ placeholder: "Message", disabled: true });
    expect(wrapper.find("[contenteditable]").exists()).toBe(false);
    expect(field.placeholder).toBe("Message");
    expect(field.disabled).toBe(true);
  });

  test("typing is the user's input: the text, then `input` with the text before it", () => {
    const { wrapper, field } = show();
    edit(field, "hi");
    expect(wrapper.emitted("update:modelValue")).toEqual([["hi"]]);
    expect(wrapper.emitted("input")).toEqual([[""]]);
  });

  test("a custom emoji goes in at the caret as its `:name:` with its entity, and the caret after it", async () => {
    const { wrapper, field, api } = show();
    edit(field, "hi  end", 3);
    expect(api.insertCustomEmoji(item("wave"))).toBe(true);
    await nextTick();
    await nextTick();

    expect(field.value).toBe("hi :wave: end");
    expect(lastEntities(wrapper)).toEqual([[3, "item-wave"]]);
    expect(api.getCursorOffset()).toBe(9);
    expect(api.getValue().text).toBe("hi :wave: end");
  });

  test("Shift+Enter breaks the line at the caret, and Ctrl+Enter submits", async () => {
    const { wrapper, field, api } = show();
    edit(field, "ab", 1);
    expect(key(field, { key: "Enter", shiftKey: true }).defaultPrevented).toBe(true);
    await nextTick();
    expect(field.value).toBe("a\nb");
    expect(api.getCursorOffset()).toBe(2);
    expect(wrapper.emitted("input")).toHaveLength(2);

    key(field, { key: "Enter", ctrlKey: true });
    expect(wrapper.emitted("submit")).toEqual([["a\nb"]]);
  });

  test("an Enter the parent took in its keydown (EnterText's send) is left alone", async () => {
    const onKeydown = vi.fn((e: KeyboardEvent) => e.preventDefault());
    const { wrapper, field } = show({ onKeydown });
    edit(field, "ab");
    key(field, { key: "Enter" });
    await nextTick();
    expect(onKeydown).toHaveBeenCalledTimes(1);
    expect(field.value).toBe("ab");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  test("singleLine: Enter submits", () => {
    const { wrapper, field } = show({ singleLine: true });
    edit(field, "go");
    key(field, { key: "Enter" });
    expect(wrapper.emitted("submit")).toEqual([["go"]]);
  });

  test("a text from outside (a draft, an edit) is shown, the emoji it does not touch kept", async () => {
    const { wrapper, field, api } = show();
    api.setValue({ text: "x :cat: y", entities: [customEmojiFromItem(item("cat"), 2)] });
    await nextTick();
    expect(field.value).toBe("x :cat: y");
    expect(lastEntities(wrapper)).toEqual([[2, "item-cat"]]);

    await wrapper.setProps({ modelValue: "xx :cat: y" });
    await nextTick();
    expect(field.value).toBe("xx :cat: y");
    expect(lastEntities(wrapper)).toEqual([[3, "item-cat"]]);
  });

  test("Backspace into an emoji takes all of it", async () => {
    const { wrapper, field, api } = show();
    edit(field, "hi ");
    api.insertCustomEmoji(item("cat"));
    await nextTick();
    edit(field, "hi :cat", 7);
    await nextTick();
    expect(field.value).toBe("hi ");
    expect(lastEntities(wrapper)).toEqual([]);
  });

  test("the limit of custom emoji per message is kept", () => {
    const { wrapper, api } = show();
    for (let i = 0; i < 100; i++) expect(api.insertCustomEmoji(item("a"))).toBe(true);
    expect(api.insertCustomEmoji(item("a"))).toBe(false);
    expect(wrapper.emitted("custom-emoji-limit")).toHaveLength(1);
  });
});

describe("without a selection API (vue-native's field today)", () => {
  test("the caret is where the last edit ended, and the composer's edits chain on it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { wrapper, field, api } = show({}, { selection: false });
    edit(field, "helloworld");
    edit(field, "hello,world");
    expect(api.getCursorOffset()).toBe(6);

    // An emoji, then a space after it, as an instant replacement does: both at the caret meant.
    api.insertCustomEmoji(item("x"));
    api.insertTextAtCursor(" ");
    expect(api.getValue().text).toBe("hello,:x: world");
    await nextTick();
    await nextTick();
    expect(field.value).toBe("hello,:x: world");
    expect(lastEntities(wrapper)).toEqual([[6, "item-x"]]);
    // The field put its caret at the end, not after the space: said once, in the console.
    expect(api.getCursorOffset()).toBe(field.value.length);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("after a text is set, and after the caret moved unseen, the caret is at the end", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { field, api } = show({}, { selection: false });
    edit(field, "abc def");
    edit(field, "abXc def");
    expect(api.getCursorOffset()).toBe(3);
    key(field, { key: "ArrowLeft" });
    expect(api.getCursorOffset()).toBe(8);

    edit(field, "abYXc def");
    api.setCursorOffset(1);
    expect(api.getCursorOffset()).toBe(1);
    await nextTick();
    // The field could not be told: the caret is still where the edit left it.
    expect(api.getCursorOffset()).toBe(3);

    api.replaceRange(0, 2, "AB");
    await nextTick();
    expect(api.getCursorOffset()).toBe(field.value.length);
  });
});
