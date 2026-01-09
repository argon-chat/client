// @argon/i18n - Internationalization package with merge support
// This package contains ONLY public/shared localization keys
// App-specific keys should be defined in each app's locales folder

import { createI18n, type I18n, type I18nOptions } from "vue-i18n";

// Import core (public) locales
import enCore from "./core/en.json";
import ruCore from "./core/ru.json";
import jpCore from "./core/jp.json";
import amCore from "./core/am.json";
import ruPtCore from "./core/ru_pt.json";

export const coreMessages = {
  en: enCore,
  ru: ruCore,
  jp: jpCore,
  am: amCore,
  ru_pt: ruPtCore,
} as const;

export type SupportedLocale = keyof typeof coreMessages;
export type CoreLocaleSchema = typeof enCore;

export interface CreateArgonI18nOptions<T extends Record<string, unknown>> {
  /** App-specific messages to merge with core messages */
  messages?: Partial<Record<SupportedLocale, T>>;
  /** Default locale */
  locale?: SupportedLocale;
  /** Fallback locale */
  fallbackLocale?: SupportedLocale;
  /** Additional vue-i18n options */
  options?: Partial<I18nOptions>;
}

/**
 * Create an i18n instance with merged core + app-specific messages
 * 
 * @example
 * ```ts
 * // In your app
 * import { createArgonI18n } from '@argon/i18n'
 * import enPrivate from './locales/en.json'
 * import ruPrivate from './locales/ru.json'
 * 
 * const i18n = createArgonI18n({
 *   messages: {
 *     en: enPrivate,
 *     ru: ruPrivate,
 *   }
 * })
 * 
 * app.use(i18n)
 * ```
 */
export function createArgonI18n<T extends Record<string, unknown> = Record<string, never>>(
  options: CreateArgonI18nOptions<T> = {}
): I18n {
  const { 
    messages: appMessages = {}, 
    locale = "en", 
    fallbackLocale = "en",
    options: i18nOptions = {}
  } = options;

  // Merge core messages with app-specific messages
  const mergedMessages = (Object.keys(coreMessages) as SupportedLocale[]).reduce(
    (acc, localeKey) => {
      acc[localeKey] = {
        ...coreMessages[localeKey],
        ...(appMessages[localeKey] || {}),
      };
      return acc;
    },
    {} as Record<string, Record<string, any>>
  );

  return createI18n({
    legacy: false,
    locale,
    fallbackLocale,
    messages: mergedMessages as any,
    ...i18nOptions,
  }) as I18n;
}

// Re-export vue-i18n utilities
export { useI18n } from "vue-i18n";
export type { I18n, I18nOptions } from "vue-i18n";

// Export core messages for direct access if needed
export { enCore, ruCore };
