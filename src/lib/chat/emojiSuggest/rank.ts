import type { EmojiEntry, KeywordMatch, ShortcodeMatch } from "@argon-chat/emojix";
import type { ExpressionItem } from "@argon/glue";
import { baseHexcode } from "./emoji";

export const SUGGEST_LIMIT = 24;

export interface RankedEmoji {
  /** Base hexcode (see baseHexcode). */
  hexcode: string;
  /** The keyword or shortcode it was found by. */
  key: string;
  exact: boolean;
  unmatched: number;
  shortcode: boolean;
  /** How much the best match of the other kind (shortcode for a keyword, and back) left over; Infinity for none. */
  other: number;
  /** Index into the locale order; shortcodes come after every locale. */
  locale: number;
  rating: number;
  /** Position in the input: the index's own order (key, then emoji order) breaks the last tie. */
  order: number;
}

export type Suggestion =
  | { type: "unicode"; key: string; hexcode: string; entry: EmojiEntry; label: string }
  | { type: "custom"; key: string; item: ExpressionItem; label: string }
  | { type: "sticker"; key: string; item: ExpressionItem; label: string };

export const unicodeKey = (hexcode: string) => `u:${baseHexcode(hexcode)}`;
export const customKey = (itemId: string) => `c:${itemId}`;

function compare(a: RankedEmoji, b: RankedEmoji): number {
  return (
    b.rating - a.rating ||
    Number(b.exact) - Number(a.exact) ||
    a.unmatched - b.unmatched ||
    a.other - b.other ||
    Number(a.shortcode) - Number(b.shortcode) ||
    a.locale - b.locale ||
    a.order - b.order
  );
}

/**
 * Keyword matches of every loaded locale and shortcode matches, one per base emoji (its best match),
 * in order: the user's rating, exact, fewest unmatched, how well the other kind matched it (a
 * keyword tie goes to the one its shortcode also names closely: `:thu` is 👍, not 🫰), keyword
 * before shortcode, locale order, then the order they came in (the index sorts by key and emoji order).
 */
export function rankUnicode(
  keywords: readonly KeywordMatch[],
  shortcodes: readonly ShortcodeMatch[],
  locales: readonly string[],
  rating: (key: string) => number,
): RankedEmoji[] {
  const best = new Map<string, RankedEmoji>();
  const closest = new Map<string, [keyword: number, shortcode: number]>();
  const offer = (candidate: RankedEmoji) => {
    const held = closest.get(candidate.hexcode) ?? [Infinity, Infinity];
    const kind = candidate.shortcode ? 1 : 0;
    held[kind] = Math.min(held[kind], candidate.unmatched);
    closest.set(candidate.hexcode, held);
    const current = best.get(candidate.hexcode);
    if (!current || compare(candidate, current) < 0) best.set(candidate.hexcode, candidate);
  };
  let order = 0;
  for (const m of keywords) {
    const hexcode = baseHexcode(m.hexcode);
    const locale = locales.indexOf(m.locale);
    offer({
      hexcode,
      key: m.key,
      exact: m.exact,
      unmatched: m.unmatched,
      shortcode: false,
      other: Infinity,
      locale: locale < 0 ? locales.length : locale,
      rating: rating(unicodeKey(hexcode)),
      order: order++,
    });
  }
  for (const m of shortcodes) {
    const hexcode = baseHexcode(m.hexcode);
    offer({
      hexcode,
      key: m.code,
      exact: m.exact,
      unmatched: m.unmatched,
      shortcode: true,
      other: Infinity,
      locale: locales.length + 1,
      rating: rating(unicodeKey(hexcode)),
      order: order++,
    });
  }
  const ranked = [...best.values()];
  for (const r of ranked) r.other = closest.get(r.hexcode)![r.shortcode ? 0 : 1];
  return ranked.sort(compare);
}

export interface CustomSource {
  /** Items associated with a base emoji (by hexcode). */
  associated(hexcode: string): readonly ExpressionItem[];
  /** Items found by name or keyword, best first. */
  named: readonly ExpressionItem[];
  isRecent(itemId: string): boolean;
}

export interface BuildInput {
  ranked: readonly RankedEmoji[];
  /** The entry that draws a base emoji, with the user's skin tone applied where it takes one. */
  resolve(hexcode: string): EmojiEntry | undefined;
  custom: CustomSource | null;
  limit?: number;
}

const customSuggestion = (item: ExpressionItem): Suggestion => ({
  type: "custom",
  key: customKey(item.itemId),
  item,
  label: `:${item.name}:`,
});

/**
 * The strip's cells: each unicode emoji with the custom emoji tagged with it (before it when
 * recently used, else right after), then custom emoji found only by name or keyword.
 */
export function buildSuggestions({ ranked, resolve, custom, limit = SUGGEST_LIMIT }: BuildInput): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (s: Suggestion) => {
    if (out.length >= limit || seen.has(s.key)) return;
    seen.add(s.key);
    out.push(s);
  };
  for (const r of ranked) {
    if (out.length >= limit) break;
    const entry = resolve(r.hexcode);
    if (!entry) continue;
    const tagged = custom ? custom.associated(r.hexcode).filter((i) => !seen.has(customKey(i.itemId))) : [];
    for (const item of tagged) if (custom!.isRecent(item.itemId)) push(customSuggestion(item));
    push({ type: "unicode", key: unicodeKey(r.hexcode), hexcode: r.hexcode, entry, label: entry.name });
    for (const item of tagged) push(customSuggestion(item));
  }
  for (const item of custom?.named ?? []) push(customSuggestion(item));
  return out;
}
