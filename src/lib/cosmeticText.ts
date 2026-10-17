import type {
  CatalogueCosmetic,
  CosmeticText,
} from "@argon/glue";

const FALLBACK_LOCALE = "en";

/**
 * The catalogue carries every language an operator wrote, so a locale switch needs no refetch.
 * The name key is the last resort: rendered as itself, it is the visible sign a row shipped unnamed.
 */
function writtenText(item: Pick<CatalogueCosmetic, "text">, locale: string): CosmeticText | null {
  const texts = item.text;

  if (!texts || texts.length === 0) {
    return null;
  }

  return texts.find(text => text.locale === locale)
    ?? texts.find(text => text.locale === FALLBACK_LOCALE)
    ?? null;
}

export function cosmeticName(item: Pick<CatalogueCosmetic, "text" | "nameKey">, locale: string): string {
  return writtenText(item, locale)?.name ?? item.nameKey;
}

export function cosmeticDescription(item: Pick<CatalogueCosmetic, "text">, locale: string): string | null {
  return writtenText(item, locale)?.description ?? null;
}
