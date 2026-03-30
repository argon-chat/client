import { persistedValue } from "@argon/storage";
import { coreMessages, type SupportedLocale } from "@argon/i18n";
import { defineStore } from "pinia";
import { watch } from "vue";
import { useI18n } from "vue-i18n";

export const useLocale = defineStore("locale", () => {
  const currentLocale = persistedValue<string>("locale", "en");

  const { t, locale } = useI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    messages: coreMessages as any,
    silentTranslationWarn: true,
    missingWarn: false,
    fallbackWarn: false,
    warnHtmlMessage: false,
  } as any);

  function updateLocale(key: string) {
    currentLocale.value = key as any;
  }

  locale.value = currentLocale.value as any;

  watch(currentLocale, (x) => {
    locale.value = x as any;
  });

  return {
    t,
    currentLocale,
    updateLocale,
  };
});
