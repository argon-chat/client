/**
 * The composer's DOM and the value it stands for: plain text as typed, unicode emoji as their own
 * characters, a custom emoji's placeholder as `:name:` with an entity over exactly that range.
 * Offsets are UTF-16 code units, the unit the parser and the server count in.
 */

import { describe, expect, test } from "vitest";
import { EntityType, MessageEntityCustomEmoji } from "@argon/glue";
import {
  adjacentAtom,
  composerFragment,
  offsetAt,
  pointAt,
  readComposer,
  splitEmoji,
  type ComposerNodes,
  type ComposerValue,
} from "@/lib/chat/composerDom";
import { customEmojiNode } from "@/components/chats/messageInput";
import { customEmojiMedia } from "@/lib/chat/customEmoji";

const emoji = (name: string, offset: number, itemId = `item-${name}`) =>
  new MessageEntityCustomEmoji(EntityType.CustomEmoji, offset, name.length + 2, 1, itemId, "space-1", 1, `file-${name}`, name, false, null);

/** Unicode emoji as sprite atoms, the way the composer draws them once the atlas is loaded. */
const nodes: ComposerNodes = {
  customEmoji: (entity) => customEmojiNode(entity, customEmojiMedia(entity)),
  emoji: (text) => {
    const span = document.createElement("span");
    span.className = "emojix-inline-emoji";
    span.setAttribute("data-emoji", text);
    span.setAttribute("contenteditable", "false");
    return span;
  },
};

function editor(value: ComposerValue): HTMLDivElement {
  const root = document.createElement("div");
  root.append(composerFragment(document, value, nodes));
  return root;
}

const shape = (value: ComposerValue) => ({
  text: value.text,
  entities: value.entities.map((e) => [e.offset, e.length, e.itemId, e.name]),
});

function roundTrip(value: ComposerValue) {
  expect(shape(readComposer(editor(value)))).toEqual(shape(value));
}

describe("DOM ↔ {text, entities}", () => {
  test("plain text, with line breaks", () => {
    roundTrip({ text: "hello\nworld", entities: [] });
    expect(editor({ text: "a\nb", entities: [] }).innerHTML).toBe("a<br>b");
  });

  test("unicode emoji are sprites in the editor and their own characters in the text", () => {
    const root = editor({ text: "hi 👋🏽 and ❤️", entities: [] });
    expect([...root.querySelectorAll("[data-emoji]")].map((e) => e.getAttribute("data-emoji"))).toEqual(["👋🏽", "❤️"]);
    expect(readComposer(root).text).toBe("hi 👋🏽 and ❤️");
  });

  test("a custom emoji at the start, in the middle and at the end", () => {
    roundTrip({ text: ":wave: hi", entities: [emoji("wave", 0)] });
    roundTrip({ text: "hi :wave: there", entities: [emoji("wave", 3)] });
    roundTrip({ text: "hi :wave:", entities: [emoji("wave", 3)] });
  });

  test("the placeholder is non-editable and carries what turns it back into text", () => {
    const root = editor({ text: "x:party:", entities: [emoji("party", 1)] });
    const ce = root.querySelector<HTMLElement>(".ce")!;
    expect(ce.getAttribute("contenteditable")).toBe("false");
    expect(ce.dataset.ceName).toBe("party");
    expect(ce.getAttribute("data-ce-item")).toBe("item-party");
    expect(ce.getAttribute("data-ce-file")).toBe("file-party");
    expect(ce.getAttribute("data-ce-format")).toBe("1");
    const [entity] = readComposer(root).entities;
    expect([entity.type, entity.spaceId, entity.fileId, entity.format]).toEqual([EntityType.CustomEmoji, "space-1", "file-party", 1]);
  });

  test("two placeholders side by side", () => {
    roundTrip({ text: ":a1::b2:", entities: [emoji("a1", 0), emoji("b2", 4)] });
  });

  test("offsets count UTF-16 units: a surrogate pair before the emoji counts two", () => {
    const value = { text: "😀 :wave:", entities: [emoji("wave", 3)] };
    expect("😀 ".length).toBe(3);
    roundTrip(value);
  });

  test("a mention's text next to a custom emoji", () => {
    roundTrip({ text: "@Alice :wave: hi", entities: [emoji("wave", 7)] });
  });

  test("an entity that does not sit on its :name: is not drawn", () => {
    const root = editor({ text: "hi :wave:", entities: [emoji("wave", 2)] });
    expect(root.querySelector(".ce")).toBeNull();
    expect(readComposer(root)).toEqual({ text: "hi :wave:", entities: [] });
  });

  test("what the overlay puts inside a placeholder is not text", () => {
    const root = editor({ text: "a:wave:b", entities: [emoji("wave", 1)] });
    const img = document.createElement("img");
    img.alt = "should not count";
    root.querySelector(".ce")!.append(img, document.createTextNode("junk"));
    expect(shape(readComposer(root))).toEqual(shape({ text: "a:wave:b", entities: [emoji("wave", 1)] }));
  });

  test("blocks the browser makes are lines; caret anchors and trailing breaks are dropped", () => {
    const root = document.createElement("div");
    root.innerHTML = "a﻿<div>b</div><div><br></div><div>c</div><br><br>";
    expect(readComposer(root).text).toBe("a\nb\n\nc");
  });

  test("splitEmoji keeps the characters as typed (no normalising)", () => {
    // U+2764 without VS16 is not an emoji by itself; with it, it is.
    expect(splitEmoji("❤ ❤️")).toEqual([
      { emoji: false, text: "❤ " },
      { emoji: true, text: "❤️" },
    ]);
    expect(splitEmoji("12345")).toEqual([{ emoji: false, text: "12345" }]);
  });
});

describe("caret offsets", () => {
  test("pointAt and offsetAt agree on every offset of the text", () => {
    const value = { text: "ab :wave: c\nd👋e", entities: [emoji("wave", 3)] };
    const root = editor(value);
    document.body.append(root);
    const atomText = new Set([4, 5, 6, 7, 8]); // inside ":wave:" (3..9): lands after it
    for (let i = 0; i <= value.text.length; i++) {
      if (atomText.has(i)) continue;
      // Inside the sprite's surrogate pair there is no caret either.
      if (i === value.text.indexOf("👋") + 1) continue;
      expect(offsetAt(root, pointAt(root, i))).toBe(i);
    }
    expect(offsetAt(root, pointAt(root, 5))).toBe(9);
    root.remove();
  });

  test("an offset inside an emoji's text lands after the emoji", () => {
    const root = editor({ text: "x:wave:y", entities: [emoji("wave", 1)] });
    const point = pointAt(root, 3);
    expect(point.node).toBe(root);
    expect(root.childNodes[point.offset - 1]).toBe(root.querySelector(".ce"));
  });
});

describe("the emoji next to the caret", () => {
  test("Backspace right after a placeholder hits it; with a letter in between it does not", () => {
    const root = editor({ text: "a:wave:b", entities: [emoji("wave", 1)] });
    const ce = root.querySelector(".ce");
    const b = root.lastChild as Text;
    expect(adjacentAtom(root, { node: b, offset: 0 }, true)).toBe(ce);
    expect(adjacentAtom(root, { node: b, offset: 1 }, true)).toBeNull();
    expect(adjacentAtom(root, { node: root.firstChild!, offset: 1 }, false)).toBe(ce);
    expect(adjacentAtom(root, { node: root, offset: 2 }, true)).toBe(ce);
  });

  test("empty text nodes and caret anchors in between are skipped", () => {
    const root = editor({ text: ":wave:", entities: [emoji("wave", 0)] });
    root.append(document.createTextNode(""), document.createTextNode("﻿"));
    expect(adjacentAtom(root, { node: root.lastChild!, offset: 1 }, true)).toBe(root.querySelector(".ce"));
  });
});
