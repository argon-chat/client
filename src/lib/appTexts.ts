import { AppByBotUser, AppById, type IAppRef, type LocalizedText } from "@argon/glue";

/** The locale every localized string with a value has; the server refuses one without it. */
export const APP_TEXT_FALLBACK = "en";

/** Keys of applications' localized strings. */
export const AppTextKey = {
  /** A bot's line under the DM header. */
  Motd: "motd",
} as const;

/** An application as the cache names it: by its id, or a bot by the user it acts as. */
export type AppRefKey = `app:${string}` | `bot:${string}`;

export const appRefById = (appId: string): AppRefKey => `app:${appId.toLowerCase()}`;
export const appRefByBotUser = (userId: string): AppRefKey => `bot:${userId.toLowerCase()}`;

export function toAppRef(ref: AppRefKey): IAppRef {
  const id = ref.slice(ref.indexOf(":") + 1);
  return ref.startsWith("bot:") ? new AppByBotUser(id) : new AppById(id);
}

/**
 * A short token for every locale of one key, so "the same text" can be remembered without keeping
 * the text: it changes whenever any locale's value does. Null when the key has no value at all.
 */
export function fingerprintLocalized(texts: readonly LocalizedText[], key: string): string | null {
  const parts = texts
    .filter((t) => t.key === key && t.value)
    .map((t) => `${t.locale.toLowerCase()}\u0000${t.value}`)
    .sort();
  if (parts.length === 0) return null;

  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (const ch of parts.join("\u0001")) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * One key in the reader's language: the exact locale, then the language without its variant
 * (`ru_pt` → `ru`, `en_tengwar` → `en`), then English.
 */
export function pickLocalized(texts: readonly LocalizedText[], key: string, locale: string): string | null {
  const byLocale = new Map<string, string>();
  for (const text of texts) {
    if (text.key === key && text.value) byLocale.set(text.locale.toLowerCase(), text.value);
  }

  const wanted = locale.toLowerCase();
  const base = wanted.split("_")[0];

  return byLocale.get(wanted) ?? byLocale.get(base) ?? byLocale.get(APP_TEXT_FALLBACK) ?? null;
}
