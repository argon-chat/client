/**
 * The strip's order: the user's rating first (a used emoji beats an exact match), then exact, fewest
 * unmatched, keyword before shortcode, locale order and the index's own order; one cell per base
 * emoji. Custom emoji tagged with a unicode one sit before it when recently used, after it
 * otherwise; those found by name only come last; 24 at most.
 */

import { describe, expect, test } from "vitest";
import type { EmojiEntry, KeywordMatch, ShortcodeMatch } from "@argon-chat/emojix";
import type { ExpressionItem } from "@argon/glue";
import { buildSuggestions, rankUnicode, SUGGEST_LIMIT, type CustomSource } from "@/lib/chat/emojiSuggest/rank";

const kw = (hexcode: string, key: string, over: Partial<KeywordMatch> = {}): KeywordMatch => ({
  hexcode,
  key,
  kind: "keyword",
  exact: false,
  unmatched: 3,
  locale: "en",
  ...over,
});
const sc = (hexcode: string, code: string, over: Partial<ShortcodeMatch> = {}): ShortcodeMatch => ({
  hexcode,
  code,
  exact: false,
  unmatched: 3,
  ...over,
});
const none = () => 0;
const hexes = (list: readonly { hexcode: string }[]) => list.map((r) => r.hexcode);

describe("unicode order", () => {
  test("exact, then fewest unmatched", () => {
    const ranked = rankUnicode([kw("1f525", "fireworks", { unmatched: 5 }), kw("1f386", "fire", { exact: true, unmatched: 0 }), kw("1f692", "fire engine", { unmatched: 7 })], [], ["en"], none);
    expect(hexes(ranked)).toEqual(["1f386", "1f525", "1f692"]);
  });

  test("the user's rating beats an exact match", () => {
    const rating = (key: string) => (key === "u:1f692" ? 3 : 0);
    const ranked = rankUnicode([kw("1f525", "fire", { exact: true, unmatched: 0 }), kw("1f692", "fire engine", { unmatched: 7 })], [], ["en"], rating);
    expect(hexes(ranked)).toEqual(["1f692", "1f525"]);
  });

  test("on a tie a keyword comes before a shortcode, then locale order, then the order given", () => {
    const ranked = rankUnicode(
      [kw("1f600", "b", { locale: "ru" }), kw("1f601", "a", { locale: "en" }), kw("1f602", "z"), kw("1f603", "y")],
      [sc("1f604", "aaa")],
      ["en", "ru"],
      none,
    );
    expect(hexes(ranked)).toEqual(["1f601", "1f602", "1f603", "1f600", "1f604"]);
  });

  test("on a tie, the one the other kind also names more closely comes first (`:thu` is 👍, not 🫰)", () => {
    const ranked = rankUnicode(
      [kw("1faf0", "thumb", { unmatched: 2 }), kw("1f44d", "thumb", { unmatched: 2 }), kw("1f44e", "thumb", { unmatched: 2 })],
      [
        sc("1f44e", "thumbsdown", { unmatched: 7 }),
        sc("1f44d", "thumbsup", { unmatched: 5 }),
        sc("1faf0", "hand_with_index_finger_and_thumb_crossed", { unmatched: 41 }),
      ],
      ["en"],
      none,
    );
    expect(hexes(ranked)).toEqual(["1f44d", "1f44e", "1faf0"]);
    expect(ranked[0]).toMatchObject({ key: "thumb", shortcode: false, other: 5 });
  });

  test("with the real shortcodes, `thu` puts 👍 before 🫰", async () => {
    const { matchShortcodes } = await import("@argon-chat/emojix");
    const keywords = [kw("1faf0", "thumb", { unmatched: 2 }), kw("1f44d", "thumb", { unmatched: 2 }), kw("1f44e", "thumb", { unmatched: 2 })];
    expect(hexes(rankUnicode(keywords, matchShortcodes("thu"), ["en"], none)).slice(0, 2)).toEqual(["1f44d", "1f44e"]);
  });

  test("one per base emoji, skin tones and VS16 merged, the best match kept", () => {
    const ranked = rankUnicode(
      [kw("1f44d-1f3fd", "thumb", { unmatched: 5 }), kw("1f44d", "thumbs up", { unmatched: 1 }), kw("2764-fe0f", "heart")],
      [sc("2764", "heart", { exact: true, unmatched: 0 })],
      ["en"],
      none,
    );
    expect(hexes(ranked)).toEqual(["2764", "1f44d"]);
    expect(ranked[0]).toMatchObject({ shortcode: true, exact: true });
    expect(ranked[1]).toMatchObject({ key: "thumbs up", unmatched: 1 });
  });

  test("upper- and lower-case hexcodes are one emoji", () => {
    expect(hexes(rankUnicode([kw("1F525", "fire"), kw("1f525", "flame")], [], ["en"], none))).toEqual(["1f525"]);
  });
});

const entry = (hexcode: string): EmojiEntry => ({ id: hexcode, hexcode, codepoints: [], shortcode: hexcode, name: `emoji ${hexcode}` }) as unknown as EmojiEntry;

const item = (itemId: string, emoji: string[] = []): ExpressionItem =>
  ({ itemId, name: itemId, emoji, keywords: [] }) as unknown as ExpressionItem;

describe("the cells", () => {
  const ranked = rankUnicode([kw("1f525", "fire", { exact: true, unmatched: 0 }), kw("1f386", "fireworks")], [], ["en"], none);

  test("a unicode emoji the registry cannot draw is left out; resolve decides the entry (skin tone)", () => {
    const cells = buildSuggestions({ ranked, resolve: (hex) => (hex === "1f525" ? entry("1f525-toned") : undefined), custom: null });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ type: "unicode", key: "u:1f525", hexcode: "1f525", entry: { hexcode: "1f525-toned" } });
  });

  test("custom emoji tagged with a result: before it when recently used, right after otherwise; name-only matches last", () => {
    const fireCat = item("fire-cat");
    const fireDog = item("fire-dog");
    const sparkle = item("sparkle");
    const named = item("fire-named");
    const custom: CustomSource = {
      associated: (hex) => (hex === "1f525" ? [fireCat, fireDog] : hex === "1f386" ? [sparkle, fireCat] : []),
      named: [named, fireDog],
      isRecent: (id) => id === "fire-dog",
    };
    const cells = buildSuggestions({ ranked, resolve: entry, custom });
    expect(cells.map((c) => c.key)).toEqual(["c:fire-dog", "u:1f525", "c:fire-cat", "u:1f386", "c:sparkle", "c:fire-named"]);
    expect(cells[0]).toMatchObject({ type: "custom", label: ":fire-dog:" });
  });

  test("at most 24", () => {
    const many = rankUnicode(
      Array.from({ length: 40 }, (_, i) => kw((0x1f600 + i).toString(16), `k${i}`)),
      [],
      ["en"],
      none,
    );
    expect(buildSuggestions({ ranked: many, resolve: entry, custom: null })).toHaveLength(SUGGEST_LIMIT);
    expect(SUGGEST_LIMIT).toBe(24);
  });
});
