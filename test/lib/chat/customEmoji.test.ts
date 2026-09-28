/**
 * Custom emoji in text: the big-emoji rule, and keeping entities in step with an edited text. (The
 * `:` query is tested with the other suggestion triggers, test/lib/chat/emojiSuggest.)
 */

import { describe, expect, test } from "vitest";
import { EntityType, MessageEntityBold, MessageEntityCustomEmoji } from "@argon/glue";
import { carryCustomEmoji, jumboEmoji, MAX_CUSTOM_EMOJI_PER_MESSAGE, validCustomEmoji } from "@/lib/chat/customEmoji";

const emoji = (name: string, offset: number) =>
  new MessageEntityCustomEmoji(EntityType.CustomEmoji, offset, name.length + 2, 1, `item-${name}`, "space", 0, `file-${name}`, name, false, null);

describe("big emoji", () => {
  test("1 to 7 emoji and nothing else, Telegram's sizes", () => {
    expect(jumboEmoji("👍")).toEqual({ count: 1, size: 96 });
    expect(jumboEmoji("👍 👍")).toEqual({ count: 2, size: 90 });
    expect(jumboEmoji("👍👍👍👍👍👍👍")).toEqual({ count: 7, size: 36 });
  });

  test("eight is too many", () => {
    expect(jumboEmoji("👍👍👍👍👍👍👍👍")).toBeNull();
  });

  test("text with the emoji is not big", () => {
    expect(jumboEmoji("ok 👍")).toBeNull();
    expect(jumboEmoji("123")).toBeNull();
    expect(jumboEmoji("   ")).toBeNull();
  });

  test("custom emoji count too, alone or mixed with unicode ones", () => {
    expect(jumboEmoji(":wave:", [emoji("wave", 0)])).toEqual({ count: 1, size: 96 });
    expect(jumboEmoji(":wave: 👍 :cat:", [emoji("wave", 0), emoji("cat", 10)])).toEqual({ count: 3, size: 84 });
    const seven = ":a1::a1::a1::a1:👍👍👍";
    expect(jumboEmoji(seven, [0, 4, 8, 12].map((o) => emoji("a1", o)))).toEqual({ count: 7, size: 36 });
    const eight = ":a1::a1::a1::a1:👍👍👍👍";
    expect(jumboEmoji(eight, [0, 4, 8, 12].map((o) => emoji("a1", o)))).toBeNull();
  });

  test("a custom emoji's :name: without its entity is text", () => {
    expect(jumboEmoji(":wave:")).toBeNull();
    expect(jumboEmoji(":wave: hi", [emoji("wave", 0)])).toBeNull();
  });

  test("styles around the emoji do not matter", () => {
    expect(jumboEmoji("👍", [new MessageEntityBold(EntityType.Bold, 0, 2, 1)])).toEqual({ count: 1, size: 96 });
  });
});

describe("entities that follow the text", () => {
  test("only entities over their own :name:, in order, not overlapping", () => {
    const text = ":a1: x :b2:";
    const kept = validCustomEmoji(text, [emoji("b2", 7), emoji("a1", 0), emoji("zz", 2), emoji("a1", 1)]);
    expect(kept.map((e) => [e.name, e.offset])).toEqual([["a1", 0], ["b2", 7]]);
  });

  test("at most the limit", () => {
    const text = ":a1:".repeat(MAX_CUSTOM_EMOJI_PER_MESSAGE + 5);
    const all = Array.from({ length: MAX_CUSTOM_EMOJI_PER_MESSAGE + 5 }, (_, i) => emoji("a1", i * 4));
    expect(validCustomEmoji(text, all)).toHaveLength(MAX_CUSTOM_EMOJI_PER_MESSAGE);
  });

  test("an edit before, after and over an emoji", () => {
    const before = "hi :wave: there";
    const entities = [emoji("wave", 3)];
    expect(carryCustomEmoji(before, `oh ${before}`, entities).map((e) => e.offset)).toEqual([6]);
    expect(carryCustomEmoji(before, `${before}!`, entities).map((e) => e.offset)).toEqual([3]);
    expect(carryCustomEmoji(before, "hi :waxe: there", entities)).toEqual([]);
    // "->" turned into "→" after the emoji: it stays put.
    expect(carryCustomEmoji("hi :wave: ->", "hi :wave: →", entities).map((e) => e.offset)).toEqual([3]);
  });
});
