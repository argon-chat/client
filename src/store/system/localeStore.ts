import { persistedValue } from "@argon/storage";
import { defineStore } from "pinia";
import { metrics } from "@/lib/telemetry/metrics";
import { watch } from "vue";
import { ensureLocale, i18n } from "@/lib/i18n";

/**
 * The locale key as an HTML `lang` value.
 *
 * **Why it is not just the key.** The bundles are named with an underscore — `ru_pt` — and BCP 47
 * has no underscore in it, so putting the key straight onto `<html lang>` produces a tag every
 * consumer of it rejects. The consumers are the ones nobody sees working: a screen reader choosing
 * a voice, the browser choosing hyphenation and quotation marks, a translation prompt deciding
 * whether to offer itself. All of them fail silently and fall back to English.
 *
 * Region is upper-cased because that is the convention the tag is matched by, and an unknown region
 * is harmless — the language subtag in front of it is what anything actually acts on.
 */
export function documentLanguage(locale: string): string {
  const [language, region] = locale.replace(/_/g, "-").split("-");

  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

export const useLocale = defineStore("locale", () => {
  const currentLocale = persistedValue<string>("locale", "en");

  // One global composer. The store used to open a second, component-local vue-i18n scope with every
  // locale's messages in it, so the app carried two full copies of all five bundles — and `$t` in
  // templates, which reads the global scope, never followed a language switch.
  const { t } = i18n.global;

  function updateLocale(key: string) {
    if (key !== currentLocale.value) metrics.count("locale.changed", { locale: key, from: currentLocale.value });
    currentLocale.value = key as any;
  }

  /**
   * Kept on the document as well as in the store, because the things that read it are outside the
   * app: assistive technology, hyphenation, the browser's own offer to translate the page. It was
   * left at the `en` index.html ships with, so every one of them was told the wrong language.
   */
  function announceLanguage(locale: string) {
    if (typeof document !== "undefined") document.documentElement.lang = documentLanguage(locale);
  }

  announceLanguage(currentLocale.value);

  void ensureLocale(currentLocale.value);
  watch(currentLocale, (x) => {
    announceLanguage(x);
    void ensureLocale(x);
  });

  return {
    t,
    currentLocale,
    updateLocale,
  };
});
