import { persistedValue } from "@argon/storage";
import { defineStore } from "pinia";
import { metrics } from "@/lib/telemetry/metrics";
import { watch } from "vue";
import { ensureLocale, i18n } from "@/lib/i18n";

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

  void ensureLocale(currentLocale.value);
  watch(currentLocale, (x) => {
    void ensureLocale(x);
  });

  return {
    t,
    currentLocale,
    updateLocale,
  };
});
