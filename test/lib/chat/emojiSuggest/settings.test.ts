/**
 * The suggestion settings: a master switch and four below it, per account, all on until turned off.
 */

import { describe, expect, test, vi, beforeAll, beforeEach } from "vitest";
import { USER_SCOPED_BASE_KEYS } from "@/lib/userScopedStorage";

type Settings = typeof import("@/lib/chat/emojiSuggest/settings");

// The first transform is slow when every project runs at once; the tests re-import it fresh.
beforeAll(async () => {
  await import("@/lib/chat/emojiSuggest/settings");
}, 60_000);

async function load(): Promise<Settings> {
  vi.resetModules();
  return import("@/lib/chat/emojiSuggest/settings");
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
});

describe("emoji suggestion settings", () => {
  test("all on by default", async () => {
    const s = await load();
    for (const setting of [s.emojiSuggestionsEnabled, s.suggestEmoji, s.replaceEmoticons, s.suggestCustomEmoji, s.suggestStickers]) {
      expect(setting.value).toBe(true);
    }
  });

  test("a choice is stored under the account's key and survives a reload", async () => {
    const s = await load();
    s.replaceEmoticons.value = false;
    s.emojiSuggestionsEnabled.value = false;
    expect(localStorage.getItem(`${s.REPLACE_EMOTICONS_KEY}::acc-1`)).toBe("false");
    expect(localStorage.getItem(`${s.EMOJI_SUGGESTIONS_KEY}::acc-1`)).toBe("false");

    const again = await load();
    expect(again.replaceEmoticons.value).toBe(false);
    expect(again.emojiSuggestionsEnabled.value).toBe(false);
    expect(again.suggestEmoji.value).toBe(true);
  });

  test("the master switch keeps the others as chosen: turned back on, they are what they were", async () => {
    const s = await load();
    s.suggestStickers.value = false;
    s.emojiSuggestionsEnabled.value = false;
    expect(s.suggestEmoji.value).toBe(true);
    s.emojiSuggestionsEnabled.value = true;
    expect(s.suggestStickers.value).toBe(false);
  });

  test("another account has its own", async () => {
    const s = await load();
    s.suggestEmoji.value = false;
    localStorage.setItem("argon_active_account", "acc-2");
    const other = await load();
    expect(other.suggestEmoji.value).toBe(true);
  });

  test("every key is forgotten with the account", async () => {
    const s = await load();
    for (const key of [s.EMOJI_SUGGESTIONS_KEY, s.SUGGEST_EMOJI_KEY, s.REPLACE_EMOTICONS_KEY, s.SUGGEST_CUSTOM_EMOJI_KEY, s.SUGGEST_STICKERS_KEY, "argon_emoji_usage"]) {
      expect(USER_SCOPED_BASE_KEYS).toContain(key);
    }
  });
});
