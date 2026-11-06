/**
 * The `<textarea>` composer's value: what MessageInput's contenteditable stands for (composerDom),
 * kept for a field that can only hold text.
 *
 * The value is the same `{ text, entities }` either way, so the parser and everything after it are
 * unchanged. A custom emoji is its `:name:` in the text with a MessageEntityCustomEmoji over exactly
 * that range; here the `:name:` is also what the field shows. An entity lives as long as its
 * `:name:` does (validCustomEmoji): an edit inside one turns it back into plain text, and a deletion
 * that cuts into one takes all of it, as Backspace takes a placeholder in the rich composer.
 *
 * vue-native has no contenteditable, Selection or Range, so this is its composer. vue-native's
 * research/reports/m26/client-gap.md §4, "<textarea> composer"; client-gap/A-webapi.md #62.
 * Offsets are UTF-16 code units, like every entity.
 */
import type { MessageEntityCustomEmoji } from "@argon/glue";
import type { ComposerValue } from "@/lib/chat/composerDom";
import { carryCustomEmoji, customEmojiEntity, validCustomEmoji } from "@/lib/chat/customEmoji";

/** A value after an edit, and where the caret goes. */
export interface TextEdit {
  value: ComposerValue;
  caret: number;
}

/** Where two texts differ: `[start, beforeEnd)` of `before` became `[start, afterEnd)` of `after`. */
export interface Stretch {
  start: number;
  beforeEnd: number;
  afterEnd: number;
}

/** The changed stretch by common prefix and suffix: the smallest edit that explains the change. */
export function changedStretch(before: string, after: string): Stretch {
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let tail = 0;
  while (tail < max - start && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail))
    tail++;
  return { start, beforeEnd: before.length - tail, afterEnd: after.length - tail };
}

const cuts = (e: MessageEntityCustomEmoji, from: number, to: number) => e.offset < to && e.offset + e.length > from;

/**
 * Replaces `[start, end)` with `replacement` and the custom emoji in it (offsets into `replacement`):
 * a picked emoji's `:name:`, a paste that carried some. Entities clear of the range stay, those after
 * it move, and the caret goes after the replacement.
 */
export function replaceRange(
  value: ComposerValue,
  start: number,
  end: number,
  replacement: string,
  emoji: readonly MessageEntityCustomEmoji[] = [],
): TextEdit {
  const text = value.text.slice(0, start) + replacement + value.text.slice(end);
  const delta = replacement.length - (end - start);
  const kept = value.entities
    .filter((e) => !cuts(e, start, end))
    .map((e) => (e.offset >= end ? customEmojiEntity(e, e.offset + delta) : e));
  for (const e of emoji) kept.push(customEmojiEntity(e, start + e.offset));
  return { value: { text, entities: validCustomEmoji(text, kept) }, caret: start + replacement.length };
}

/**
 * The deletion of `count` characters that turned `before` into `after`, placed where it removes no
 * part of a custom emoji if it can be: a stretch of repeated characters deletes the same way at any
 * of several places, and a colon next to an emoji's own is the usual one.
 */
function placeDeletion(before: ComposerValue, after: string, at: Stretch, exact: number | null): number {
  const count = at.beforeEnd - at.start;
  const fits = (s: number) =>
    s >= 0 && s + count <= before.text.length && before.text.slice(0, s) + before.text.slice(s + count) === after;
  // The field said where its caret is: Backspace and Delete both leave it where the deletion was.
  if (exact !== null && fits(exact)) return exact;
  const whole = (s: number) => !before.entities.some((e) => cuts(e, s, s + count));
  for (let s = at.start; s >= 0 && fits(s); s--) if (whole(s)) return s;
  return at.start;
}

/**
 * The user changed the field's text to `next` (typing, a paste, a native undo). `caret` is the
 * field's own caret after the change when it can tell, else the caret is worked out from the change.
 */
export function fieldEdit(value: ComposerValue, next: string, caret: number | null = null): TextEdit {
  const at = changedStretch(value.text, next);
  if (at.afterEnd === at.start && at.beforeEnd > at.start) {
    const start = placeDeletion(value, next, at, caret);
    const end = start + (at.beforeEnd - at.start);
    const hit = value.entities.filter((e) => cuts(e, start, end));
    // A deletion into a custom emoji takes all of it.
    if (hit.length) {
      const from = Math.min(start, ...hit.map((e) => e.offset));
      const to = Math.max(end, ...hit.map((e) => e.offset + e.length));
      return replaceRange(value, from, to, "");
    }
    return replaceRange(value, start, end, "");
  }
  return {
    value: { text: next, entities: carryCustomEmoji(value.text, next, value.entities) },
    caret: caret ?? at.afterEnd,
  };
}

/** The value cut to `max` code points (MessageInput's `maxLength`), or null when it fits. */
export function cutToMaxLength(value: ComposerValue, max: number | undefined): ComposerValue | null {
  if (!max) return null;
  const chars = [...value.text];
  if (chars.length <= max) return null;
  const text = chars.slice(0, max).join("");
  return { text, entities: carryCustomEmoji(value.text, text, value.entities) };
}
