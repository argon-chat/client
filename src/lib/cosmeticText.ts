/**
 * What a cosmetic is called, for the person reading it.
 *
 * The catalogue carries every language an operator has written, not the caller's own, because it is
 * fetched once per session and nothing refetches it when somebody changes language. Resolution
 * therefore happens at render time, against the locale ref, so a switch moves these strings with
 * everything else on screen.
 *
 * `nameKey` is the last resort rather than the first: it is a locale key that no longer has an
 * entry, so it renders as itself — a visible slug is the signal that a row reached a client without
 * a name, which the server's own publish gate is meant to make impossible.
 */
import type { CatalogueCosmetic, CosmeticText } from "@argon/glue";

const FALLBACK_LOCALE = "en";

function written(item: Pick<CatalogueCosmetic, "text">, locale: string): CosmeticText | null {
  const text = item.text;

  if (!text || text.length === 0) {
    return null;
  }

  return text.find((entry) => entry.locale === locale)
    ?? text.find((entry) => entry.locale === FALLBACK_LOCALE)
    ?? null;
}

export function cosmeticName(item: Pick<CatalogueCosmetic, "text" | "nameKey">, locale: string): string {
  return written(item, locale)?.name ?? item.nameKey;
}

export function cosmeticDescription(item: Pick<CatalogueCosmetic, "text">, locale: string): string | null {
  return written(item, locale)?.description ?? null;
}
