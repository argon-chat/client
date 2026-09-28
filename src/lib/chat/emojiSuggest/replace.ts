import type { Emoticon } from "@argon-chat/emojix";
import { colonOpens, type Placed } from "./triggers";

/** Typed text turned into something else as soon as its last character is typed. */
export const TEXT_REPLACEMENTS: readonly { pattern: string; replacement: string }[] = [
  { pattern: "--", replacement: "—" },
  { pattern: "...", replacement: "…" },
  { pattern: "->", replacement: "→" },
  { pattern: "<-", replacement: "←" },
  { pattern: "<3", replacement: "♥" },
  { pattern: "(c)", replacement: "©" },
  { pattern: "(r)", replacement: "®" },
  { pattern: "(tm)", replacement: "™" },
  { pattern: "+-", replacement: "±" },
  { pattern: "!=", replacement: "≠" },
  { pattern: "<=", replacement: "≤" },
  { pattern: ">=", replacement: "≥" },
  { pattern: "~=", replacement: "≈" },
  { pattern: "<<", replacement: "«" },
  { pattern: ">>", replacement: "»" },
  { pattern: "(shrug)", replacement: "¯\\_(ツ)_/¯" },
  { pattern: "(check)", replacement: "✓" },
  { pattern: "(x)", replacement: "✗" },
];

/** `<3` with emoticon replacement on: ❤️ rather than ♥. */
export const HEART_HEXCODE = "2764-fe0f";

const BOUNDARY = /^[\s\p{P}]$/u;
const CLOSING_CODE = /:([A-Za-z0-9_+-]{1,64}):$/;

export type ReplacementContent =
  | { kind: "unicode"; hexcode: string }
  | { kind: "custom"; name: string }
  | { kind: "text"; text: string };

export interface InstantReplacement {
  /** [start, end) of the text being replaced. */
  start: number;
  end: number;
  content: ReplacementContent;
  /** Typed characters after `end` that stay where they are (the boundary after `:D`). */
  keep: number;
  /** An emoji put in with nothing after it gets a space. */
  trailingSpace: boolean;
}

export interface ReplaceDeps {
  emoticonBefore(text: string): { emoticon: Emoticon; start: number } | null;
  shortcodeExact(code: string): string | null;
  /** Whether the composer has a custom emoji of this name. */
  hasCustomEmoji(name: string): boolean;
}

export interface TypedInput {
  text: string;
  caret: number;
  /** What was just typed, ending at the caret. */
  typed: string;
  emoticons: boolean;
  placed: readonly Placed[];
}

/** The text inserted by an edit that turned `before` into `after` and left the caret after it; null for anything else. */
export function typedAt(before: string, after: string, caret: number): string | null {
  const n = after.length - before.length;
  if (n <= 0 || caret < n || caret > after.length) return null;
  const at = caret - n;
  if (after.slice(0, at) !== before.slice(0, at) || after.slice(caret) !== before.slice(at)) return null;
  return after.slice(at, caret);
}

/** An odd number of backticks before the caret: inside `code`. */
export function insideInlineCode(before: string): boolean {
  let n = 0;
  for (let i = 0; i < before.length; i++) if (before.charCodeAt(i) === 96) n++;
  return n % 2 === 1;
}

const overlaps = (start: number, end: number, placed: readonly Placed[]) =>
  placed.some((e) => e.offset < end && e.offset + e.length > start);

/** `:code:` closed by the colon just typed. */
export function closingCode(before: string, placed: readonly Placed[] = []): { start: number; code: string } | null {
  const match = CLOSING_CODE.exec(before);
  if (!match) return null;
  const start = match.index;
  if (!colonOpens(before, start, placed) || overlaps(start, before.length, placed)) return null;
  return { start, code: match[1] };
}

/** A non-immediate emoticon (`:D`) ending exactly at `end`. */
function pendingEmoticon(before: string, deps: ReplaceDeps) {
  const hit = deps.emoticonBefore(before);
  return hit && !hit.emoticon.immediate && hit.start + hit.emoticon.text.length === before.length ? hit : null;
}

/** What typing `typed` turns into, if anything (rule 5). */
export function replacementForTyped(input: TypedInput, deps: ReplaceDeps): InstantReplacement | null {
  const { text, caret, typed, placed } = input;
  const before = text.slice(0, caret);
  if (!typed || !before.endsWith(typed) || insideInlineCode(before)) return null;
  const atEnd = caret === text.length;

  if (input.emoticons) {
    if (typed === ":") {
      const closed = closingCode(before, placed);
      if (closed) {
        const content: ReplacementContent | null = deps.hasCustomEmoji(closed.code)
          ? { kind: "custom", name: closed.code }
          : unicode(deps.shortcodeExact(closed.code.toLowerCase()));
        if (content) return { start: closed.start, end: caret, content, keep: 0, trailingSpace: atEnd };
      }
    }
    const hit = deps.emoticonBefore(before);
    if (hit?.emoticon.immediate && hit.start + hit.emoticon.text.length === caret && !overlaps(hit.start, caret, placed)) {
      return { start: hit.start, end: caret, content: { kind: "unicode", hexcode: hit.emoticon.hexcode }, keep: 0, trailingSpace: atEnd };
    }
    if (BOUNDARY.test(typed)) {
      const prior = before.slice(0, -typed.length);
      const pending = pendingEmoticon(prior, deps);
      if (pending && !overlaps(pending.start, prior.length, placed)) {
        return {
          start: pending.start,
          end: prior.length,
          content: { kind: "unicode", hexcode: pending.emoticon.hexcode },
          keep: typed.length,
          trailingSpace: false,
        };
      }
    }
  }

  for (const { pattern, replacement } of TEXT_REPLACEMENTS) {
    if (!before.endsWith(pattern)) continue;
    const start = caret - pattern.length;
    if (overlaps(start, caret, placed)) continue;
    if (pattern === "<3" && input.emoticons) {
      return { start, end: caret, content: { kind: "unicode", hexcode: HEART_HEXCODE }, keep: 0, trailingSpace: atEnd };
    }
    return { start, end: caret, content: { kind: "text", text: replacement }, keep: 0, trailingSpace: false };
  }
  return null;
}

/** A line break is about to be typed: the non-immediate emoticon before the caret, if any. */
export function replacementBeforeBreak(
  text: string,
  caret: number,
  placed: readonly Placed[],
  deps: ReplaceDeps,
): InstantReplacement | null {
  const before = text.slice(0, caret);
  if (insideInlineCode(before)) return null;
  const pending = pendingEmoticon(before, deps);
  if (!pending || overlaps(pending.start, caret, placed)) return null;
  return { start: pending.start, end: caret, content: { kind: "unicode", hexcode: pending.emoticon.hexcode }, keep: 0, trailingSpace: false };
}

function unicode(hexcode: string | null): ReplacementContent | null {
  return hexcode ? { kind: "unicode", hexcode } : null;
}

/** A replacement made, for Backspace to take back. */
export interface ReplacementRecord {
  start: number;
  /** What the replacement reads as in the text (an emoji's characters, a trailing space). */
  inserted: string;
  /** What was typed. */
  original: string;
  keep: number;
}

/** Where Backspace right after the replacement puts the typed text back, or null. */
export function revertTarget(
  record: ReplacementRecord,
  text: string,
  caret: number,
): { start: number; end: number; original: string; caret: number } | null {
  const end = record.start + record.inserted.length;
  if (caret !== end + record.keep || text.slice(record.start, end) !== record.inserted) return null;
  return { start: record.start, end, original: record.original, caret: record.start + record.original.length + record.keep };
}
