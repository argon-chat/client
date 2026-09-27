import { ExpressionFormat, ExpressionKind } from "@argon/glue";

// A mirror of the server's ExpressionLimits (Telegram's numbers) and of its quota table, so a file
// or a name the server would refuse is refused here first, with a reason the user can act on.

const KiB = 1024;

export const EXPRESSION_LIMITS = {
  stickerSide: 512,
  emojiSide: 100,
  stickerStaticMaxBytes: 512 * KiB,
  stickerLottieMaxBytes: 64 * KiB,
  stickerVideoMaxBytes: 256 * KiB,
  emojiStaticMaxBytes: 128 * KiB,
  emojiLottieMaxBytes: 64 * KiB,
  emojiVideoMaxBytes: 256 * KiB,
  thumbMaxBytes: 128 * KiB,
  maxDurationSeconds: 3,
  lottieMaxFps: 60,
  /** Decompressed Lottie JSON, and a plain-JSON upload before it is gzipped. */
  lottieMaxJsonBytes: 4 * 1024 * KiB,
  emojiNameMin: 2,
  emojiNameMax: 32,
  stickerNameMin: 2,
  stickerNameMax: 30,
  /** Associated emoji are optional: none to 20. */
  maxAssociatedEmoji: 20,
  maxKeywords: 20,
  maxKeywordsTotalLength: 64,
  packTitleMin: 1,
  packTitleMax: 64,
  packSlugMin: 1,
  packSlugMax: 64,
} as const;

/** Per space, by boost level 0–3; packs and per-pack items do not grow with boosts. */
export const EXPRESSION_QUOTAS = {
  emoji: [60, 120, 180, 300],
  stickers: [6, 18, 36, 72],
  packs: 10,
  stickerPackItems: 120,
  emojiPackItems: 200,
} as const;

export interface ExpressionQuota {
  emoji: number;
  stickers: number;
  packs: number;
}

export function quotaFor(boostLevel: number | null | undefined): ExpressionQuota {
  const level = Math.max(0, Math.min(3, Math.floor(boostLevel ?? 0)));
  return { emoji: EXPRESSION_QUOTAS.emoji[level], stickers: EXPRESSION_QUOTAS.stickers[level], packs: EXPRESSION_QUOTAS.packs };
}

export function packItemLimit(kind: ExpressionKind): number {
  return kind === ExpressionKind.Emoji ? EXPRESSION_QUOTAS.emojiPackItems : EXPRESSION_QUOTAS.stickerPackItems;
}

export function maxBytes(kind: ExpressionKind, format: ExpressionFormat): number {
  const L = EXPRESSION_LIMITS;
  const emoji = kind === ExpressionKind.Emoji;
  switch (format) {
    case ExpressionFormat.Static:
      return emoji ? L.emojiStaticMaxBytes : L.stickerStaticMaxBytes;
    case ExpressionFormat.Lottie:
      return emoji ? L.emojiLottieMaxBytes : L.stickerLottieMaxBytes;
    case ExpressionFormat.Video:
      return emoji ? L.emojiVideoMaxBytes : L.stickerVideoMaxBytes;
    default:
      return 0;
  }
}

/**
 * Emoji are exactly 100×100; a Lottie sticker is 512×512; a static or video sticker has one side of
 * exactly 512 and the other at most 512.
 */
export function dimensionsFit(kind: ExpressionKind, format: ExpressionFormat, width: number, height: number): boolean {
  const side = EXPRESSION_LIMITS.stickerSide;
  if (kind === ExpressionKind.Emoji) return width === EXPRESSION_LIMITS.emojiSide && height === EXPRESSION_LIMITS.emojiSide;
  if (format === ExpressionFormat.Lottie) return width === side && height === side;
  return (width === side && height >= 1 && height <= side) || (height === side && width >= 1 && width <= side);
}

const SLUG_LIKE = /^[a-z0-9_]+$/;

function isPlainText(value: string, min: number, max: number): boolean {
  return (
    value.length >= min &&
    value.length <= max &&
    value.trim().length === value.length &&
    value.trim().length > 0 &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it looks for
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/** The i18n key of what is wrong with an item name, or null when the server would take it. */
export function itemNameError(kind: ExpressionKind, name: string): string | null {
  const L = EXPRESSION_LIMITS;
  if (kind === ExpressionKind.Emoji) {
    if (name.length < L.emojiNameMin || name.length > L.emojiNameMax) return "expression_settings_name_length_emoji";
    return SLUG_LIKE.test(name) ? null : "expression_settings_name_chars";
  }
  return isPlainText(name, L.stickerNameMin, L.stickerNameMax) ? null : "expression_settings_name_length_sticker";
}

export function packTitleError(title: string): string | null {
  return isPlainText(title, EXPRESSION_LIMITS.packTitleMin, EXPRESSION_LIMITS.packTitleMax) ? null : "expression_settings_pack_title_invalid";
}

export function packSlugError(slug: string): string | null {
  const L = EXPRESSION_LIMITS;
  return slug.length >= L.packSlugMin && slug.length <= L.packSlugMax && SLUG_LIKE.test(slug) ? null : "expression_settings_pack_slug_invalid";
}

/** None is fine; at most 20, each a non-blank value of at most 32 UTF-16 units. */
export function associatedEmojiError(emoji: readonly string[]): string | null {
  if (emoji.length > EXPRESSION_LIMITS.maxAssociatedEmoji) return "expression_settings_emoji_too_many";
  return emoji.every((e) => e.trim().length > 0 && e.length <= 32) ? null : "expression_settings_emoji_invalid";
}

export function keywordsError(keywords: readonly string[]): string | null {
  const L = EXPRESSION_LIMITS;
  if (keywords.length > L.maxKeywords) return "expression_settings_keywords_too_many";
  if (keywords.some((k) => !k.trim())) return "expression_settings_keywords_too_many";
  return keywords.reduce((sum, k) => sum + k.length, 0) > L.maxKeywordsTotalLength ? "expression_settings_keywords_too_long" : null;
}

/** Lower-case `[a-z0-9_]`, runs of anything else as one `_`, at most `max` long. */
export function slugify(text: string, max: number = EXPRESSION_LIMITS.packSlugMax): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/g, "");
}

/** A name for an uploaded file: its base name, made valid, and for emoji not one of `taken`. */
export function suggestItemName(kind: ExpressionKind, fileName: string, taken: ReadonlySet<string> = new Set()): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const L = EXPRESSION_LIMITS;
  if (kind !== ExpressionKind.Emoji) {
    const name = base.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, L.stickerNameMax).trim();
    return name.length >= L.stickerNameMin ? name : "sticker";
  }
  let name = slugify(base, L.emojiNameMax);
  if (name.length < L.emojiNameMin) name = "emoji";
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = name.slice(0, L.emojiNameMax - suffix.length) + suffix;
    if (!lower.has(candidate)) return candidate;
  }
}

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/** The emoji in `text`, one per grapheme, in order, without repeats. */
export function extractEmoji(text: string): string[] {
  const out: string[] = [];
  const graphemes =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment)
      : Array.from(text);
  for (const g of graphemes) if (PICTOGRAPH.test(g) && !out.includes(g)) out.push(g);
  return out;
}
