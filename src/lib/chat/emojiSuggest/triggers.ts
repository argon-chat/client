import { baseHexcodeOf, graphemes, isEmojiGrapheme } from "./emoji";

/** A custom emoji placeholder in the text (its `:name:`). */
export interface Placed {
  offset: number;
  length: number;
}

export const QUERY_MIN_LENGTH = 2;
export const QUERY_MAX_LENGTH = 64;
export const QUERY_MAX_WORDS = 3;

const QUERY_CHAR = /[\p{L}\p{N}\p{M}_+-]/u;
// A colon after one of these is a time, a link, a word or `::`, not a query.
const COLON_BLOCKED_AFTER = /[\p{L}\p{N}\p{M}_:]/u;
const PAIR_ALLOWED = new Set(["us", "uk", "hi", "ok"]);
const LATIN_PAIR = /^[a-z]{2}$/i;
const DIGITS = /^\p{N}+$/u;

const inside = (at: number, placed: readonly Placed[]) => placed.some((e) => at >= e.offset && at < e.offset + e.length);

/** Whether the `:` at `at` may open an emoji query or a `:code:`. */
export function colonOpens(text: string, at: number, placed: readonly Placed[] = []): boolean {
  if (inside(at, placed)) return false;
  if (at === 0 || placed.some((e) => e.offset + e.length === at)) return true;
  return !COLON_BLOCKED_AFTER.test(text[at - 1]);
}

function validQuery(q: string): boolean {
  if (q.length < QUERY_MIN_LENGTH || q.length > QUERY_MAX_LENGTH) return false;
  if (q.startsWith(" ") || q.endsWith(" ") || q.includes("  ")) return false;
  return q.split(" ").length <= QUERY_MAX_WORDS;
}

export interface ColonQuery {
  /** Offset of the `:`. */
  start: number;
  query: string;
}

/** `:query` right before the caret (rule 1). */
export function findColonQuery(before: string, placed: readonly Placed[] = []): ColonQuery | null {
  const limit = Math.max(0, before.length - QUERY_MAX_LENGTH - 1);
  for (let i = before.length - 1; i >= limit; i--) {
    const ch = before[i];
    if (ch === ":") {
      const query = before.slice(i + 1);
      return validQuery(query) && colonOpens(before, i, placed) ? { start: i, query } : null;
    }
    if (ch !== " " && !QUERY_CHAR.test(ch)) return null;
  }
  return null;
}

/** The whole message is one word being typed at its end (rule 2). */
export function findBareWord(text: string, caret: number, longestKey: number): string | null {
  if (!text || caret !== text.length || /\s/u.test(text)) return null;
  const length = [...text].length;
  if (length < 2 || length > longestKey) return null;
  if (DIGITS.test(text)) return null;
  if (LATIN_PAIR.test(text) && !PAIR_ALLOWED.has(text.toLowerCase())) return null;
  return text;
}

export interface EmojiRun {
  start: number;
  /** One emoji of the run, as typed. */
  emoji: string;
  base: string;
  count: number;
}

const RUN_WINDOW = 256;

/** The run of identical unicode emoji right before the caret (rule 3). */
export function emojiRunBefore(before: string): EmojiRun | null {
  const from = Math.max(0, before.length - RUN_WINDOW);
  const segments = graphemes(before.slice(from));
  let i = segments.length - 1;
  if (i < 0 || !isEmojiGrapheme(segments[i].segment)) return null;
  const emoji = segments[i].segment;
  const key = emoji.replace(/️/g, "");
  let start = segments[i].index;
  let count = 1;
  while (i > 0 && segments[i - 1].segment.replace(/️/g, "") === key) {
    i--;
    start = segments[i].index;
    count++;
  }
  return { start: from + start, emoji, base: baseHexcodeOf(emoji), count };
}

/** The message, trimmed, is one unicode emoji and the caret is after it (rule 4). */
export function singleEmoji(text: string, caret: number): string | null {
  const trimmed = text.trim();
  // The longest emoji (a family, a tagged flag) is well under this.
  if (!trimmed || trimmed.length > 32) return null;
  const segments = graphemes(trimmed);
  if (segments.length !== 1 || !isEmojiGrapheme(trimmed)) return null;
  return caret >= text.indexOf(trimmed) + trimmed.length ? trimmed : null;
}

export interface SuggestSettings {
  suggestEmoji: boolean;
  suggestCustomEmoji: boolean;
  suggestStickers: boolean;
}

export type Detected =
  | { mode: "query"; start: number; query: string }
  | { mode: "word"; start: 0; word: string }
  | { mode: "emoji"; start: number; run: EmojiRun | null; sticker: string | null };

export interface DetectInput {
  text: string;
  caret: number;
  placed: readonly Placed[];
  /** Longest keyword of the loaded indices; 0 while none is loaded. */
  longestKey: number;
  /** A space's composer: its custom emoji can stand in for a typed emoji. */
  inSpace: boolean;
  canSendStickers: boolean;
  settings: SuggestSettings;
}

/** Which strip the text calls for, if any, with the settings applied. */
export function detect(input: DetectInput): Detected | null {
  const { text, caret, settings } = input;
  const before = text.slice(0, caret);
  if (settings.suggestEmoji) {
    const query = findColonQuery(before, input.placed);
    if (query) return { mode: "query", ...query };
    const word = findBareWord(text, caret, input.longestKey);
    if (word) return { mode: "word", start: 0, word };
  }
  const run = settings.suggestCustomEmoji && input.inSpace ? emojiRunBefore(before) : null;
  const sticker = settings.suggestStickers && input.canSendStickers ? singleEmoji(text, caret) : null;
  if (!run && !sticker) return null;
  return { mode: "emoji", start: run?.start ?? 0, run, sticker };
}
