import { persistedValue } from "@/lib/persistedValue";
import { locales, type Locale, type LocaleSchema } from "@/locales";
import { defineStore } from "pinia";
import { watch } from "vue";
import { useI18n } from "vue-i18n";

export const useLocale = defineStore("locale", () => {
  const currentLocale = persistedValue<string>("locale", "en");

  const { locale } = useI18n<[LocaleSchema], Locale>({
    locale: "en",
    fallbackLocale: "en",
    /* @ts-ignore */
    messages: locales,
    silentTranslationWarn: true,
    missingWarn: false,
    fallbackWarn: false,
  });

  function updateLocale(key: string) {
    currentLocale.value = key as any;
  }

  locale.value = currentLocale.value as any;

  watch(currentLocale, (x) => {
    locale.value = x as any;
  });

  const t = (key: string, args?: Record<string, any>) => {
    return key;
  }

  return {
    t,
    currentLocale,
    updateLocale,
  };
});
