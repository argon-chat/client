/**
 * Reaction identity: a custom emoji reaction is its item, a unicode one its emoji, and the two
 * never merge. A removal event names only `emoji`: the unicode reaction wins, else the custom one
 * whose item id (or emoji text) it is.
 */

import { describe, expect, test } from "vitest";
import type { ReactionInfo } from "@argon/glue";
import { applyReactionAdded, applyReactionRemoved, findReaction, hasReacted, reactionKey } from "@/lib/chat/reactions";

const r = (emoji: string, customEmojiId: string | null, userIds: string[]): ReactionInfo =>
  ({ emoji, customEmojiId, count: userIds.length, userIds }) as any;

describe("reaction keys", () => {
  test("custom by item, unicode by emoji", () => {
    expect(reactionKey({ emoji: "👍", customEmojiId: null })).toBe("emoji:👍");
    expect(reactionKey({ emoji: "👍", customEmojiId: "item-1" })).toBe("custom:item-1");
    expect(reactionKey({ emoji: ":party:", customEmojiId: "item-1" })).toBe(reactionKey({ emoji: "", customEmojiId: "item-1" }));
  });

  test("a custom reaction beside a unicode one with the same text stays separate", () => {
    let list = [r("👍", null, ["a"])];
    list = applyReactionAdded(list, { emoji: "👍", customEmojiId: "item-1" }, "b");
    expect(list.map((x) => [reactionKey(x), x.count])).toEqual([["emoji:👍", 1], ["custom:item-1", 1]]);
    expect(hasReacted(list, { emoji: "👍", customEmojiId: null }, "b")).toBe(false);
    expect(hasReacted(list, { emoji: "", customEmojiId: "item-1" }, "b")).toBe(true);
  });

  test("adding twice counts once; the server's emoji text fills an optimistic blank", () => {
    let list: ReactionInfo[] = [];
    list = applyReactionAdded(list, { emoji: "", customEmojiId: "item-1" }, "me");
    list = applyReactionAdded(list, { emoji: ":party:", customEmojiId: "item-1" }, "me");
    list = applyReactionAdded(list, { emoji: ":party:", customEmojiId: "item-1" }, "you");
    expect(list).toHaveLength(1);
    expect([list[0].emoji, list[0].count, list[0].userIds]).toEqual([":party:", 2, ["me", "you"]]);
  });

  test("a removal by ref takes the right one and drops it at zero", () => {
    let list = [r("👍", null, ["a"]), r("👍", "item-1", ["a", "b"])];
    list = applyReactionRemoved(list, { emoji: "", customEmojiId: "item-1" }, "a");
    expect(list.map((x) => [reactionKey(x), x.count])).toEqual([["emoji:👍", 1], ["custom:item-1", 1]]);
    list = applyReactionRemoved(list, { emoji: "👍", customEmojiId: null }, "a");
    expect(list.map(reactionKey)).toEqual(["custom:item-1"]);
  });

  test("a removal event names only the emoji: unicode first, then a custom one by id or text", () => {
    const list = [r(":party:", "item-1", ["a"]), r("👍", null, ["a"]), r("👍", "item-2", ["a"])];
    expect(reactionKey(findReaction(list, "👍")!)).toBe("emoji:👍");
    expect(reactionKey(findReaction(list, "item-1")!)).toBe("custom:item-1");
    expect(reactionKey(findReaction(list, ":party:")!)).toBe("custom:item-1");
    expect(findReaction(list, "🔥")).toBeUndefined();
  });
});
