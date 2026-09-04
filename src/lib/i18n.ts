/**
 * The app's single vue-i18n instance.
 *
 * Only English is in the boot bundle; any other language is fetched as its own chunk the first
 * time it is needed and installed into this instance. main.ts awaits the saved language before
 * mounting so the first paint is already in it; the locale store switches through the same path.
 */
import { createI18n } from "vue-i18n";
import {
  coreMessages,
  isSupportedLocale,
  loadCoreMessages,
  type CoreLocaleSchema,
  type SupportedLocale,
} from "@argon/i18n";

export const i18n = createI18n<[CoreLocaleSchema], SupportedLocale>({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: coreMessages as any,
  silentTranslationWarn: true,
  missingWarn: false,
  fallbackWarn: false,
  warnHtmlMessage: false,
});

const installed = new Set<SupportedLocale>(["en"]);

/** Fetches the locale's bundle if needed, installs it and makes it current. Unknown locales mean English. */
export async function ensureLocale(locale: string): Promise<SupportedLocale> {
  const key: SupportedLocale = isSupportedLocale(locale) ? locale : "en";
  if (!installed.has(key)) {
    const messages = await loadCoreMessages(key);
    i18n.global.setLocaleMessage(key, messages as any);
    installed.add(key);
  }
  (i18n.global.locale as unknown as { value: string }).value = key;
  return key;
}
