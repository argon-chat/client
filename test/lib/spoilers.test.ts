/**
 * Spoilers in plain-text previews (a pinned row, the space's announcement banner): the chat hides
 * them behind a click, a preview has nothing to click, so the text is masked — its length with it.
 */

import { describe, test, expect } from "vitest";
import { EntityType, MessageEntityBold, MessageEntitySpoiler } from "@argon/glue";
import { SPOILER_MASK, maskSpoilers } from "@/lib/chat/spoilers";
import { parseMessageContent } from "@/lib/chat/parseMessageContent";

const spoiler = (offset: number, length: number) => new MessageEntitySpoiler(EntityType.Spoiler, offset, length, 1);

describe("maskSpoilers", () => {
  test("masks each spoiler range and leaves the rest", () => {
    const text = "Bob dies, then Alice wins";
    expect(maskSpoilers(text, [spoiler(0, 8), spoiler(21, 3)])).toBe(`${SPOILER_MASK}, then Alice ${SPOILER_MASK}s`);
  });

  test("the mask does not give the length away", () => {
    expect(maskSpoilers("a", [spoiler(0, 1)])).toBe(maskSpoilers("a very long secret", [spoiler(0, 18)]));
  });

  test("works on what the composer sends for ||…||", () => {
    const { text, entities } = parseMessageContent("the code is ||4815|| ok");

    expect(maskSpoilers(text, entities)).toBe(`the code is ${SPOILER_MASK} ok`);
    expect(maskSpoilers(text, entities)).not.toContain("4815");
  });

  test("other entities, no entities, and ranges out of bounds or overlapping", () => {
    expect(maskSpoilers("bold", [new MessageEntityBold(EntityType.Bold, 0, 4, 1)])).toBe("bold");
    expect(maskSpoilers("plain", null)).toBe("plain");
    expect(maskSpoilers("short", [spoiler(3, 50)])).toBe(`sho${SPOILER_MASK}`);
    expect(maskSpoilers("abcdefgh", [spoiler(4, 3), spoiler(1, 4)])).toBe(`a${SPOILER_MASK}h`);
    expect(maskSpoilers("abc", [spoiler(9, 2)])).toBe("abc");
  });
});
