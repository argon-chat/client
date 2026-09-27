/**
 * Unicode emoji in message text become sprites (EmojiText). The text is cut into runs of plain
 * text and single emoji the atlas can draw; the pieces always join back into the text, so what is
 * selected and copied is what was sent. `:name:` of a custom emoji is text here (the entity draws
 * it), and an emoji without art stays in its text run for the system font.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import { initializeEmojix } from "@argon-chat/emojix";
import { splitEmojiText } from "@/lib/chat/emojiText";
import EmojiText from "@/components/chats/EmojiText";

beforeAll(() => initializeEmojix());

/** Each piece as its text, emoji marked with their atlas: `["hi ", "😀@smileys"]`. */
const cut = (text: string) => {
  const pieces = splitEmojiText(text);
  expect(pieces.map((p) => p.text).join("")).toBe(text);
  return pieces.map((p) => (p.emoji ? `${p.text}@${p.emoji.atlasRef.atlasId}` : p.text));
};

describe("splitEmojiText", () => {
  test("plain text is one piece; empty text none", () => {
    expect(cut("Hello, world! 12:30 #42 (c) ©")).toEqual(["Hello, world! 12:30 #42 (c) ©"]);
    expect(splitEmojiText("")).toEqual([]);
  });

  test("a single emoji", () => {
    expect(cut("😀")).toEqual(["😀@smileys"]);
  });

  test("a ZWJ family is one emoji", () => {
    expect(cut("👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦@people"]);
  });

  test("a skin tone stays with its emoji, drawn from the tone atlas", () => {
    expect(cut("👍🏽")).toEqual(["👍🏽@tone3"]);
    expect(cut("🧑🏻‍🤝‍🧑🏿")).toEqual(["🧑🏻‍🤝‍🧑🏿@tone1"]);
  });

  test("a flag is one emoji", () => {
    expect(cut("🇺🇦🇯🇵")).toEqual(["🇺🇦@flags", "🇯🇵@flags"]);
  });

  test("a keycap is an emoji, a bare digit is not", () => {
    expect(cut("1️⃣ vs 1")).toEqual(["1️⃣@symbols", " vs 1"]);
    // Without its VS16, as some keyboards send it: still the keycap, characters kept as sent.
    expect(cut("1⃣")).toEqual(["1⃣@symbols"]);
  });

  test("a custom emoji's :name: is left as text", () => {
    expect(cut("hi :wave: there 😀")).toEqual(["hi :wave: there ", "😀@smileys"]);
  });

  test("emoji right against text split cleanly", () => {
    expect(cut("ok👍done❤️!")).toEqual(["ok", "👍@people", "done", "❤️@smileys", "!"]);
  });

  test("an emoji without art stays in its text run", () => {
    // U+1FAEA DISTORTED FACE (Emoji 17): not in Apple's set yet.
    expect(cut("a\u{1FAEA}b 😀")).toEqual(["a\u{1FAEA}b ", "😀@smileys"]);
  });
});

describe("EmojiText", () => {
  test("renders spans only for emoji, holding their characters; the text reads as sent", () => {
    const text = "hey 👋🏽 look 🇺🇦 ok";
    const w = mount({ render: () => h("p", [h(EmojiText, { text })]) });
    const spans = w.findAll("span.msg-emoji");
    expect(spans.map((s) => s.text())).toEqual(["👋🏽", "🇺🇦"]);
    expect(spans[0]!.attributes("style")).toContain("background-image");
    expect(w.text()).toBe(text);
  });

  test("text without emoji is a single text node", () => {
    const w = mount({ render: () => h("p", [h(EmojiText, { text: "just words" })]) });
    expect(w.element.childNodes).toHaveLength(1);
    expect(w.element.firstChild!.nodeType).toBe(Node.TEXT_NODE);
  });
});
