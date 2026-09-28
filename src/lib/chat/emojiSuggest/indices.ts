import { computed, shallowRef, watch } from "vue";
import { loadKeywordIndex, releaseKeywordIndexes, resolveSuggestLocales, type KeywordIndex } from "@argon-chat/emojix";
import { logger } from "@argon/core";
import { emojiSuggestionsEnabled } from "./settings";

// The keyword indices the strip searches: the UI language, the browser's, and English. Loaded the
// first time a composer is focused, not at boot; never while suggestions are off.

const loaded = shallowRef<readonly KeywordIndex[]>([]);
let requested: string | null = null;

export const suggestIndices = computed(() => loaded.value);
export const suggestLocales = computed(() => loaded.value.map((i) => i.locale));
export const longestSuggestKey = computed(() => loaded.value.reduce((max, i) => Math.max(max, i.longestKey), 0));

/** Loads the indices for `uiLocale` (and the browser's languages) unless they are already there. */
export async function ensureSuggestIndices(uiLocale: string): Promise<void> {
  if (!emojiSuggestionsEnabled.value) return;
  const languages = typeof navigator !== "undefined" ? (navigator.languages ?? []) : [];
  const locales = resolveSuggestLocales(uiLocale, languages);
  const key = locales.join(",");
  if (key === requested) return;
  requested = key;
  const results = await Promise.all(
    locales.map((locale) =>
      loadKeywordIndex(locale).catch((e) => {
        logger.warn(`emoji keywords for ${locale} did not load`, e);
        return null;
      }),
    ),
  );
  if (requested !== key) return;
  loaded.value = results.filter((i): i is KeywordIndex => !!i);
}

/** Forgets the indices here and in the package's cache, so their data can be collected. */
export function releaseSuggestIndices(): void {
  const held = requested !== null;
  requested = null;
  loaded.value = [];
  if (held) releaseKeywordIndexes();
}

// Turned off: the data goes. Turned on again: loaded on the next focus.
watch(emojiSuggestionsEnabled, (on) => {
  if (!on) releaseSuggestIndices();
});
