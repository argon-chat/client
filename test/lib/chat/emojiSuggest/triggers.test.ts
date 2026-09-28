/**
 * When the emoji strip opens, as Telegram Desktop decides it: `:query` (not after a letter or digit,
 * two characters, up to three words), a lone word typed as the whole message, an emoji right before
 * the caret, and a message of exactly one emoji; each gated by its setting.
 */

import { describe, expect, test } from "vitest";
import {
  detect,
  emojiRunBefore,
  findBareWord,
  findColonQuery,
  singleEmoji,
  type DetectInput,
} from "@/lib/chat/emojiSuggest/triggers";

const placed = (offset: number, name: string) => ({ offset, length: name.length + 2 });

describe("`:query`", () => {
  test("at the start, after a space, a line break, a bracket or a quote, and right after a custom emoji", () => {
    expect(findColonQuery(":th")).toEqual({ start: 0, query: "th" });
    expect(findColonQuery("hello :smi")).toEqual({ start: 6, query: "smi" });
    expect(findColonQuery("line\n:th")).toEqual({ start: 5, query: "th" });
    expect(findColonQuery("(:ok")).toEqual({ start: 1, query: "ok" });
    expect(findColonQuery("«:ok")).toEqual({ start: 1, query: "ok" });
    expect(findColonQuery(":wave::th", [placed(0, "wave")])).toEqual({ start: 6, query: "th" });
  });

  test("not after a letter or a digit: links, times, words, `::`", () => {
    expect(findColonQuery("see http:ab")).toBeNull();
    expect(findColonQuery("at 12:30")).toBeNull();
    expect(findColonQuery("a:bc")).toBeNull();
    expect(findColonQuery("std::vector")).toBeNull();
  });

  test("two characters at least: `:D` alone is not a query", () => {
    expect(findColonQuery(":D")).toBeNull();
    expect(findColonQuery(":")).toBeNull();
    expect(findColonQuery(":)")).toBeNull();
  });

  test("spaces inside, up to three words and 64 characters; not right after the colon or at the end", () => {
    expect(findColonQuery(":thumbs up")).toEqual({ start: 0, query: "thumbs up" });
    expect(findColonQuery(":a b c")).toEqual({ start: 0, query: "a b c" });
    expect(findColonQuery(":a b c d")).toBeNull();
    expect(findColonQuery(": th")).toBeNull();
    expect(findColonQuery(":thumbs ")).toBeNull();
    expect(findColonQuery(":thumbs  up")).toBeNull();
    expect(findColonQuery(`:${"a".repeat(64)}`)).toEqual({ start: 0, query: "a".repeat(64) });
    expect(findColonQuery(`:${"a".repeat(65)}`)).toBeNull();
  });

  test("a finished `:name:` or the placeholder's own closing colon does not open one", () => {
    expect(findColonQuery(":smile:")).toBeNull();
    expect(findColonQuery(":wave:", [placed(0, "wave")])).toBeNull();
    expect(findColonQuery(":wave:ab", [placed(0, "wave")])).toBeNull();
  });

  test("any script", () => {
    expect(findColonQuery(":кот")).toEqual({ start: 0, query: "кот" });
    expect(findColonQuery("x :ねこ")).toEqual({ start: 2, query: "ねこ" });
  });
});

describe("a lone word", () => {
  test("the whole message, caret at its end, no longer than the longest key", () => {
    expect(findBareWord("fire", 4, 30)).toBe("fire");
    expect(findBareWord("Огонь", 5, 30)).toBe("Огонь");
    expect(findBareWord("fire", 2, 30)).toBeNull();
    expect(findBareWord("on fire", 7, 30)).toBeNull();
    expect(findBareWord(" fire", 5, 30)).toBeNull();
    expect(findBareWord("firefighter", 11, 5)).toBeNull();
  });

  test("skips one character, digits, and two Latin letters other than us, uk, hi, ok", () => {
    expect(findBareWord("a", 1, 30)).toBeNull();
    expect(findBareWord("12", 2, 30)).toBeNull();
    expect(findBareWord("2024", 4, 30)).toBeNull();
    expect(findBareWord("no", 2, 30)).toBeNull();
    expect(findBareWord("it", 2, 30)).toBeNull();
    for (const word of ["us", "uk", "hi", "ok", "OK", "Hi"]) expect(findBareWord(word, 2, 30)).toBe(word);
    expect(findBareWord("да", 2, 30)).toBe("да");
  });

  test("nothing before an index is loaded", () => {
    expect(findBareWord("fire", 4, 0)).toBeNull();
  });
});

describe("an emoji before the caret", () => {
  test("the run of identical emoji right before the caret; tones and VS16 left out of the base", () => {
    expect(emojiRunBefore("hi 🙂")).toMatchObject({ start: 3, count: 1, base: "1f642", emoji: "🙂" });
    expect(emojiRunBefore("🙂🙂🙂")).toMatchObject({ start: 0, count: 3 });
    expect(emojiRunBefore("😀🙂🙂")).toMatchObject({ start: 2, count: 2 });
    expect(emojiRunBefore("❤️")).toMatchObject({ base: "2764" });
    expect(emojiRunBefore("👍🏽")).toMatchObject({ base: "1f44d", emoji: "👍🏽", count: 1 });
    expect(emojiRunBefore("🇯🇵")).toMatchObject({ count: 1 });
  });

  test("not a letter, a digit, or an emoji followed by a space", () => {
    expect(emojiRunBefore("hi")).toBeNull();
    expect(emojiRunBefore("1")).toBeNull();
    expect(emojiRunBefore("🙂 ")).toBeNull();
    expect(emojiRunBefore("")).toBeNull();
  });

  test("a message of exactly one emoji, the caret after it", () => {
    expect(singleEmoji("🙂", 2)).toBe("🙂");
    expect(singleEmoji(" 🙂 ", 4)).toBe("🙂");
    expect(singleEmoji("🙂🙂", 4)).toBeNull();
    expect(singleEmoji("hi 🙂", 5)).toBeNull();
    expect(singleEmoji("🙂", 0)).toBeNull();
  });
});

describe("settings", () => {
  const on = { suggestEmoji: true, suggestCustomEmoji: true, suggestStickers: true };
  const input = (text: string, over: Partial<DetectInput> = {}): DetectInput => ({
    text,
    caret: text.length,
    placed: [],
    longestKey: 30,
    inSpace: true,
    canSendStickers: true,
    settings: on,
    ...over,
  });

  test("`:query` and the lone word follow suggestEmoji", () => {
    expect(detect(input(":thu"))).toMatchObject({ mode: "query", start: 0, query: "thu" });
    expect(detect(input("fire"))).toMatchObject({ mode: "word", start: 0, word: "fire" });
    expect(detect(input(":thu", { settings: { ...on, suggestEmoji: false } }))).toBeNull();
    expect(detect(input("fire", { settings: { ...on, suggestEmoji: false } }))).toBeNull();
  });

  test("an emoji typed follows suggestCustomEmoji, and needs a space", () => {
    expect(detect(input("hi 🙂"))).toMatchObject({ mode: "emoji", start: 3, run: { count: 1 }, sticker: null });
    expect(detect(input("hi 🙂", { inSpace: false }))).toBeNull();
    expect(detect(input("hi 🙂", { settings: { ...on, suggestCustomEmoji: false } }))).toBeNull();
  });

  test("a one-emoji message follows suggestStickers, and needs stickers to be sendable", () => {
    expect(detect(input("🙂"))).toMatchObject({ mode: "emoji", sticker: "🙂", run: { count: 1 } });
    expect(detect(input("🙂", { inSpace: false }))).toMatchObject({ mode: "emoji", sticker: "🙂", run: null });
    expect(detect(input("🙂", { settings: { ...on, suggestStickers: false } }))).toMatchObject({ sticker: null });
    expect(detect(input("🙂", { canSendStickers: false, inSpace: false }))).toBeNull();
  });

  test("a plain sentence calls for nothing", () => {
    expect(detect(input("see you at 12:30"))).toBeNull();
    expect(detect(input("look at http:ab"))).toBeNull();
  });
});
