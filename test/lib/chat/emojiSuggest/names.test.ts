/**
 * Emoji a custom emoji's name suggests in the upload dialog: the whole name as a phrase, then each
 * part's exact matches in turn, then prefix matches; three at most.
 */

import { describe, expect, test } from "vitest";
import { KeywordIndex, type KeywordIndexData, type KeywordMatch } from "@argon-chat/emojix";
import { emojiForName } from "@/lib/chat/emojiSuggest/names";
import enKeywords from "../../../../packages/emojix/src/data/keywords/en.json";

const match = (hexcode: string, key: string, exact = true): KeywordMatch => ({
  hexcode,
  key,
  kind: "keyword",
  exact,
  unmatched: 0,
  locale: "en",
});

function fakeIndex(exact: Record<string, string[]>, prefix: Record<string, string[]> = {}) {
  return {
    matchExact: (q: string) => (exact[q] ?? []).map((h) => match(h, q)),
    matchPrefix: (q: string) => (prefix[q] ?? []).map((h) => match(h, q, false)),
  };
}

describe("emoji for a name", () => {
  test("each part's matches taken in turn, then prefix matches, three at most", () => {
    const index = fakeIndex({ sad: ["1f622", "1f61e"], cat: ["1f431"] }, { pep: ["1f336"] });
    expect(emojiForName("sad_cat", index)).toEqual(["1f622", "1f431", "1f61e"]);
    expect(emojiForName("pep-cat", index)).toEqual(["1f431", "1f336"]);
  });

  test("the whole name as a phrase first; tones and case folded; short parts skipped", () => {
    const index = fakeIndex({ "thumbs up": ["1F44D-1F3FB"], thumbs: ["1f44e"], x: ["274c"] });
    expect(emojiForName("Thumbs_Up", index)).toEqual(["1f44d", "1f44e"]);
    expect(emojiForName("thumbs_x", index)).toEqual(["1f44e"]);
  });

  test("with the real English keywords: pepe_cry suggests 😢", () => {
    const en = new KeywordIndex(enKeywords as unknown as KeywordIndexData);
    const found = emojiForName("pepe_cry", en);
    expect(found).toContain("1f622");
    expect(found).toHaveLength(3);
    expect(emojiForName("party_parrot", en)).toContain("1f99c");
  });
});
