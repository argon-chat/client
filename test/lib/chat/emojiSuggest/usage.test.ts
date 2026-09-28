/**
 * How often each emoji is picked, tdesktop-style: at most 54 ratings, the lowest dropped to make
 * room; all halve once one passes 0x4000. Per account, and read again on a seamless switch.
 */

import { describe, expect, test, vi, beforeEach } from "vitest";
import { bumpRating, USAGE_HALVE_ABOVE, USAGE_MAX_KEYS } from "@/lib/chat/emojiSuggest/usage";

describe("ratings", () => {
  test("a bump adds one", () => {
    expect(bumpRating({}, "u:1f525")).toEqual({ "u:1f525": 1 });
    expect(bumpRating({ "u:1f525": 4 }, "u:1f525")).toEqual({ "u:1f525": 5 });
  });

  test("at most 54 keys: the lowest other one makes room", () => {
    let ratings: Record<string, number> = {};
    for (let i = 0; i < USAGE_MAX_KEYS; i++) ratings[`c:${i}`] = i + 2;
    ratings["c:7"] = 1;
    const next = bumpRating(ratings, "u:new");
    expect(Object.keys(next)).toHaveLength(USAGE_MAX_KEYS);
    expect(next["u:new"]).toBe(1);
    expect(next["c:7"]).toBeUndefined();
    expect(USAGE_MAX_KEYS).toBe(54);
  });

  test("the key just bumped is never the one dropped", () => {
    const ratings: Record<string, number> = {};
    for (let i = 0; i < USAGE_MAX_KEYS; i++) ratings[`c:${i}`] = 5;
    const next = bumpRating(ratings, "u:new");
    expect(next["u:new"]).toBe(1);
    expect(Object.keys(next)).toHaveLength(USAGE_MAX_KEYS);
  });

  test("past 0x4000 every rating halves, none below one", () => {
    const next = bumpRating({ "u:a": USAGE_HALVE_ABOVE, "u:b": 10, "u:c": 1 }, "u:a");
    expect(next).toEqual({ "u:a": Math.floor((USAGE_HALVE_ABOVE + 1) / 2), "u:b": 5, "u:c": 1 });
    expect(USAGE_HALVE_ABOVE).toBe(0x4000);
  });
});

describe("stored per account", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("argon_active_account", "acc-1");
    vi.resetModules();
  });

  test("bumps persist under the account's key and are read back after a reload", async () => {
    const usage = await import("@/lib/chat/emojiSuggest/usage");
    usage.bumpUsage("u:1f525");
    usage.bumpUsage("u:1f525");
    expect(usage.usageRating("u:1f525")).toBe(2);
    expect(JSON.parse(localStorage.getItem("argon_emoji_usage::acc-1")!)).toEqual({ "u:1f525": 2 });

    vi.resetModules();
    const again = await import("@/lib/chat/emojiSuggest/usage");
    expect(again.usageRating("u:1f525")).toBe(2);
    expect(again.usageRating("u:1f600")).toBe(0);
  });

  test("a seamless account switch reads the next account's ratings", async () => {
    const usage = await import("@/lib/chat/emojiSuggest/usage");
    const { runSessionReset } = await import("@/store/system/sessionLifecycle");
    usage.bumpUsage("c:item");
    localStorage.setItem("argon_active_account", "acc-2");
    await runSessionReset();
    expect(usage.usageRating("c:item")).toBe(0);
  });
});
