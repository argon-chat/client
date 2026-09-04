// @argon/i18n - Internationalization package with merge support
// This package contains ONLY public/shared localization keys
// App-specific keys should be defined in each app's locales folder

import { createI18n, type I18n, type I18nOptions } from "vue-i18n";

// English is the fallback and the schema, so it is the one bundle that ships in the boot chunk.
// Every other locale is its own chunk, fetched the first time it is selected: keeping all five
// resident cost ~440 KB of parsed JSON plus compiled message functions for languages nobody had
// switched to.
import enCore from "./core/en.json";

export const SUPPORTED_LOCALES = ["en", "ru", "jp", "am", "ru_pt"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type CoreLocaleSchema = typeof enCore;
export type CoreMessages = Record<string, unknown>;

const loaders: Record<SupportedLocale, () => Promise<CoreMessages>> = {
  en: async () => enCore,
  ru: () => import("./core/ru.json").then((m) => m.default as CoreMessages),
  jp: () => import("./core/jp.json").then((m) => m.default as CoreMessages),
  am: () => import("./core/am.json").then((m) => m.default as CoreMessages),
  ru_pt: () => import("./core/ru_pt.json").then((m) => m.default as CoreMessages),
};

const loaded = new Map<SupportedLocale, CoreMessages>([["en", enCore]]);
const inflight = new Map<SupportedLocale, Promise<CoreMessages>>();

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** The bundle for a locale; fetched once, then served from memory. Unknown locales resolve to English. */
export function loadCoreMessages(locale: string): Promise<CoreMessages> {
  const key: SupportedLocale = isSupportedLocale(locale) ? locale : "en";
  const ready = loaded.get(key);
  if (ready) return Promise.resolve(ready);
  let pending = inflight.get(key);
  if (!pending) {
    pending = loaders[key]()
      .then((messages) => {
        loaded.set(key, messages);
        return messages;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/** A locale's bundle if it has already been fetched (English always is). */
export function getLoadedCoreMessages(locale: string): CoreMessages | undefined {
  return isSupportedLocale(locale) ? loaded.get(locale) : undefined;
}

/** Every bundle, for tooling and tests that validate the locales against each other. */
export async function loadAllCoreMessages(): Promise<Record<SupportedLocale, CoreMessages>> {
  const entries = await Promise.all(
    SUPPORTED_LOCALES.map(async (locale) => [locale, await loadCoreMessages(locale)] as const),
  );
  return Object.fromEntries(entries) as Record<SupportedLocale, CoreMessages>;
}

/** The bundles known at build time: English only. Other locales arrive through loadCoreMessages(). */
export const coreMessages: { en: CoreLocaleSchema } = { en: enCore };

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
 * Create an i18n instance with merged core + app-specific messages.
 *
 * Only the core bundles already in memory are merged (English always; others after
 * `loadCoreMessages()` / `loadAllCoreMessages()`), so call those first for any locale the instance
 * must speak from the start.
 *
 * @example
 * ```ts
 * // In your app
 * import { createArgonI18n, loadCoreMessages } from '@argon/i18n'
 * import enPrivate from './locales/en.json'
 * import ruPrivate from './locales/ru.json'
 *
 * await loadCoreMessages('ru')
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
  const mergedMessages: Record<string, Record<string, unknown>> = {};
  for (const localeKey of SUPPORTED_LOCALES) {
    const core = loaded.get(localeKey);
    const app = appMessages[localeKey];
    if (!core && !app) continue;
    mergedMessages[localeKey] = { ...(core ?? {}), ...(app ?? {}) };
  }

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

// Export the English bundle for direct access if needed
export { enCore };
