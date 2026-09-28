/**
 * The keyword indices: loaded on demand for the UI locale and the browser's languages (English
 * always), never while suggestions are off; turning them off releases what was loaded, turning them
 * back on loads again on the next request.
 */

import { describe, expect, test, vi, beforeAll, beforeEach } from "vitest";
import { nextTick } from "vue";

// The first transform is slow when every project runs at once; the tests re-import it fresh.
beforeAll(async () => {
  await import("@/lib/chat/emojiSuggest/indices");
}, 60_000);

const h = vi.hoisted(() => ({ load: vi.fn(), release: vi.fn() }));

// Only what indices.ts uses; the real locale resolution, without loading the whole package.
vi.mock("@argon-chat/emojix", async () => {
  const { resolveSuggestLocales } = await import("../../../../packages/emojix/src/core/suggest/locales");
  return { loadKeywordIndex: h.load, releaseKeywordIndexes: h.release, resolveSuggestLocales };
});

type Indices = typeof import("@/lib/chat/emojiSuggest/indices");
type Settings = typeof import("@/lib/chat/emojiSuggest/settings");

async function load(): Promise<{ indices: Indices; settings: Settings }> {
  vi.resetModules();
  const settings = await import("@/lib/chat/emojiSuggest/settings");
  const indices = await import("@/lib/chat/emojiSuggest/indices");
  return { indices, settings };
}

const fakeIndex = (locale: string) => ({ locale, longestKey: 12, matchPrefix: () => [], matchExact: () => [] });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
  h.load.mockReset();
  h.load.mockImplementation(async (locale: string) => fakeIndex(locale));
  h.release.mockReset();
  vi.stubGlobal("navigator", { languages: ["ru-RU", "en-US"] });
  return () => vi.unstubAllGlobals();
});

describe("keyword indices", () => {
  test("the UI locale, then the browser's, English among them; loaded once", async () => {
    const { indices } = await load();
    await indices.ensureSuggestIndices("jp");
    expect(h.load.mock.calls.map((c) => c[0])).toEqual(["ja", "ru", "en"]);
    expect(indices.suggestLocales.value).toEqual(["ja", "ru", "en"]);
    expect(indices.longestSuggestKey.value).toBe(12);
    await indices.ensureSuggestIndices("jp");
    expect(h.load).toHaveBeenCalledTimes(3);
  });

  test("a locale that fails is left out; the others load", async () => {
    h.load.mockImplementation(async (locale: string) => {
      if (locale === "ru") throw new Error("offline");
      return fakeIndex(locale);
    });
    const { indices } = await load();
    await indices.ensureSuggestIndices("en");
    expect(indices.suggestLocales.value).toEqual(["en"]);
  });

  test("with suggestions off nothing is loaded", async () => {
    const { indices, settings } = await load();
    settings.emojiSuggestionsEnabled.value = false;
    await nextTick();
    await indices.ensureSuggestIndices("en");
    expect(h.load).not.toHaveBeenCalled();
    expect(indices.suggestIndices.value).toEqual([]);
  });

  test("turned off, what was loaded is released; turned on, it loads again when asked", async () => {
    const { indices, settings } = await load();
    await indices.ensureSuggestIndices("en");
    expect(indices.suggestIndices.value).toHaveLength(2);

    settings.emojiSuggestionsEnabled.value = false;
    await nextTick();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(indices.suggestIndices.value).toEqual([]);

    settings.emojiSuggestionsEnabled.value = true;
    await nextTick();
    expect(h.load).toHaveBeenCalledTimes(2);
    await indices.ensureSuggestIndices("en");
    expect(h.load).toHaveBeenCalledTimes(4);
    expect(indices.suggestIndices.value).toHaveLength(2);
  });

  test("turning off with nothing loaded releases nothing", async () => {
    const { settings } = await load();
    settings.emojiSuggestionsEnabled.value = false;
    await nextTick();
    expect(h.release).not.toHaveBeenCalled();
  });
});
