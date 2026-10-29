/**
 * The `<textarea>` composer's value (vue-native): the same `{ text, entities }` the rich composer
 * reads off its DOM, built from the field's text and caret instead. A custom emoji is its `:name:`
 * with an entity over exactly that range, so what is sent is the parser's output either way.
 */

import { describe, expect, test } from "vitest";
import { EntityType, MessageEntityCustomEmoji, type ExpressionItem, type IMessageEntity } from "@argon/glue";
import { composerFragment, readComposer, type ComposerNodes, type ComposerValue } from "@/lib/chat/composerDom";
import { customEmojiFromItem, customEmojiMedia } from "@/lib/chat/customEmoji";
import { parseMessageContent } from "@/lib/chat/parseMessageContent";
import { customEmojiNode } from "@/components/chats/messageInput";
import { changedStretch, cutToMaxLength, fieldEdit, replaceRange, type TextEdit } from "@/lib/vn/textComposer";

const item = (name: string) =>
  ({
    itemId: `item-${name}`,
    spaceId: "space-1",
    format: 1,
    fileId: `file-${name}`,
    name,
    textColor: false,
    downloadUrl: null,
  }) as unknown as ExpressionItem;

const emoji = (name: string, offset: number) => customEmojiFromItem(item(name), offset);

const shape = (value: ComposerValue) => ({
  text: value.text,
  entities: value.entities.map((e) => [e.offset, e.length, e.itemId]),
});
const types = (entities: readonly IMessageEntity[]) => entities.map((e) => [e.type, e.offset, e.length]);

const empty: ComposerValue = { text: "", entities: [] };

/** The user types `typed` at the end, as the field reports it. */
const type = (value: ComposerValue, typed: string) => fieldEdit(value, value.text + typed).value;

/** What the picker does: the emoji's `:name:` over `[start, end)`, its entity at `start`. */
const pick = (value: ComposerValue, name: string, start: number, end = start) =>
  replaceRange(value, start, end, `:${name}:`, [emoji(name, 0)]);

/** The rich composer's DOM for a value, and what it reads back: the reference the textarea matches. */
const nodes: ComposerNodes = {
  customEmoji: (entity) => customEmojiNode(entity, customEmojiMedia(entity)),
  emoji: (text) => document.createTextNode(text),
};
function richComposerReads(value: ComposerValue): ComposerValue {
  const root = document.createElement("div");
  root.append(composerFragment(document, value, nodes));
  return readComposer(root);
}

describe("the value as the user edits", () => {
  test("typing, a custom emoji at the caret, more typing: the rich composer's value", () => {
    let value = type(empty, "hi ");
    value = pick(value, "wave", value.text.length).value;
    value = type(value, " end");

    expect(shape(value)).toEqual({ text: "hi :wave: end", entities: [[3, 6, "item-wave"]] });
    expect(shape(richComposerReads(value))).toEqual(shape(value));
  });

  test("an emoji after a surrogate pair is counted in UTF-16 code units", () => {
    const value = pick(type(empty, "😀 "), "wave", 3).value;
    expect(shape(value)).toEqual({ text: "😀 :wave:", entities: [[3, 6, "item-wave"]] });
  });

  test("text typed before an emoji moves it along", () => {
    const value = pick({ text: "ab", entities: [] }, "x", 2).value;
    const edit = fieldEdit(value, "a-b:x:");
    expect(shape(edit.value)).toEqual({ text: "a-b:x:", entities: [[3, 3, "item-x"]] });
    expect(edit.caret).toBe(2);
  });

  test("typing inside an emoji's `:name:` makes it text", () => {
    const value = pick(empty, "cat", 0).value;
    const edit = fieldEdit(value, ":caat:");
    expect(shape(edit.value)).toEqual({ text: ":caat:", entities: [] });
  });

  test("Backspace right after an emoji takes all of it, and the caret goes where it was", () => {
    const value = type(pick(type(empty, "hi "), "cat", 3).value, " x");
    const edit = fieldEdit(value, "hi :cat x");
    expect(shape(edit.value)).toEqual({ text: "hi  x", entities: [] });
    expect(edit.caret).toBe(3);
  });

  test("Delete at an emoji's start takes all of it too", () => {
    const value = pick({ text: "a ", entities: [] }, "cat", 2).value;
    const edit = fieldEdit(value, "a cat:");
    expect(shape(edit.value)).toEqual({ text: "a ", entities: [] });
  });

  test("a colon deleted next to an emoji's own is that colon, not the emoji", () => {
    // ":x::" — the emoji, then a typed colon. Deleting either colon reads ":x:"; the one that leaves
    // the emoji whole is taken.
    const value = type(pick(empty, "x", 0).value, ":");
    const edit = fieldEdit(value, ":x:");
    expect(shape(edit.value)).toEqual({ text: ":x:", entities: [[0, 3, "item-x"]] });
  });

  test("where the field can say where its caret is, that decides", () => {
    // The same text as above; the field's caret after the deletion is at 2: the emoji's closing colon went.
    const value = type(pick(empty, "x", 0).value, ":");
    const edit = fieldEdit(value, ":x:", 2);
    expect(shape(edit.value)).toEqual({ text: ":", entities: [] });
    expect(edit.caret).toBe(0);
  });

  test("a selection typed over keeps the emoji outside it", () => {
    const value = pick(pick({ text: "one two three", entities: [] }, "a", 0).value, "b", 16).value;
    expect(value.text).toBe(":a:one two three:b:");
    const edit = fieldEdit(value, ":a:one 2 three:b:");
    expect(shape(edit.value)).toEqual({ text: ":a:one 2 three:b:", entities: [[0, 3, "item-a"], [14, 3, "item-b"]] });
    expect(edit.caret).toBe(8);
  });

  test("the caret after typing is where the typing ended, the end of a run of one character", () => {
    expect(fieldEdit({ text: "helo", entities: [] }, "hello").caret).toBe(4);
    expect(fieldEdit({ text: "ab", entities: [] }, "aXb").caret).toBe(2);
    expect(changedStretch("aa", "aaa")).toEqual({ start: 2, beforeEnd: 2, afterEnd: 3 });
  });
});

describe("the composer's own edits", () => {
  test("replaceRange keeps the emoji clear of the range, moves those after it, drops one it cuts", () => {
    const value: ComposerValue = { text: ":a: mid :b: :c:", entities: [emoji("a", 0), emoji("b", 8), emoji("c", 12)] };
    const edit = replaceRange(value, 4, 10, "MIDDLE");
    expect(shape(edit.value)).toEqual({ text: ":a: MIDDLE: :c:", entities: [[0, 3, "item-a"], [12, 3, "item-c"]] });
    expect(edit.caret).toBe(10);
  });

  test("an emoji put in right before another keeps both", () => {
    const value = pick(empty, "b", 0).value;
    const edit = pick(value, "a", 0);
    expect(shape(edit.value)).toEqual({ text: ":a::b:", entities: [[0, 3, "item-a"], [3, 3, "item-b"]] });
    expect(edit.caret).toBe(3);
  });

  test("an emoji picked over a typed `:query` replaces the query", () => {
    const value = type(empty, "so :wa");
    const edit: TextEdit = pick(value, "wave", 3, 6);
    expect(shape(edit.value)).toEqual({ text: "so :wave:", entities: [[3, 6, "item-wave"]] });
    expect(edit.caret).toBe(9);
  });

  test("maxLength counts code points and keeps the emoji that fit", () => {
    const value = pick({ text: "😀😀", entities: [] }, "x", 4).value;
    // Two code points, then three: it fits in five.
    expect(cutToMaxLength(value, 5)).toBeNull();
    expect(shape(cutToMaxLength(value, 4)!)).toEqual({ text: "😀😀:x", entities: [] });
    expect(shape(cutToMaxLength(type(value, "!"), 5)!)).toEqual({ text: "😀😀:x:", entities: [[4, 3, "item-x"]] });
    expect(cutToMaxLength(value, undefined)).toBeNull();
  });
});

describe("what is sent", () => {
  test("the parser gets the same text and entities as from the rich composer", () => {
    let value = type(empty, "**hi** @Alice ");
    value = pick(value, "wave", value.text.length).value;
    value = type(value, " ||secret||");
    const mentions = new Map([["@Alice", "user-alice"]]);

    const fromTextarea = parseMessageContent(value.text, mentions, { customEmoji: value.entities });
    const rich = richComposerReads(value);
    const fromRich = parseMessageContent(rich.text, mentions, { customEmoji: rich.entities });

    expect(fromTextarea.text).toBe("hi @Alice :wave: secret");
    expect(types(fromTextarea.entities)).toEqual([
      [EntityType.Bold, 0, 2],
      [EntityType.Mention, 3, 6],
      [EntityType.CustomEmoji, 10, 6],
      [EntityType.Spoiler, 17, 6],
    ]);
    expect(types(fromTextarea.entities)).toEqual(types(fromRich.entities));
    expect(fromTextarea.text).toBe(fromRich.text);
    const [sent] = fromTextarea.entities.filter((e): e is MessageEntityCustomEmoji => e.type === EntityType.CustomEmoji);
    expect([sent.itemId, sent.spaceId, sent.fileId, sent.name, sent.format]).toEqual(["item-wave", "space-1", "file-wave", "wave", 1]);
  });

  test("a `:name:` typed by hand is text: only a picked emoji is one", () => {
    const value = type(empty, "look :wave:");
    expect(value.entities).toEqual([]);
    expect(types(parseMessageContent(value.text, new Map(), { customEmoji: value.entities }).entities)).toEqual([]);
  });
});
