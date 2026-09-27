import {
  EntityType,
  MessageEntityCustomEmoji,
  type ExpressionItem,
  type IMessageEntity,
  type MessageEntitySticker,
} from "@argon/glue";
import { isEmojiOnly } from "@argon-chat/emojix";
import type { ExpressionMedia } from "@/lib/expressions/types";

/**
 * Custom emoji in text. The text holds `:name:` where one sits (what a client without the emoji
 * shows, what a copy carries) and a MessageEntityCustomEmoji covers exactly that range. Offsets are
 * UTF-16 code units, like every other entity: the parser works on JS strings and the server
 * checks ranges against .NET's `string.Length`.
 */

/** The server's limit, enforced here too: past it, `:name:` stays text. */
export const MAX_CUSTOM_EMOJI_PER_MESSAGE = 100;

export const customEmojiAlt = (name: string) => `:${name}:`;

export function isCustomEmojiEntity(entity: IMessageEntity): entity is MessageEntityCustomEmoji {
  return entity.type === EntityType.CustomEmoji;
}

type CustomEmojiFields = Pick<
  MessageEntityCustomEmoji,
  "itemId" | "spaceId" | "format" | "fileId" | "name" | "textColor" | "downloadUrl"
>;

export function customEmojiEntity(emoji: CustomEmojiFields, offset: number): MessageEntityCustomEmoji {
  return new MessageEntityCustomEmoji(
    EntityType.CustomEmoji,
    offset,
    customEmojiAlt(emoji.name).length,
    1,
    emoji.itemId,
    emoji.spaceId,
    emoji.format,
    emoji.fileId,
    emoji.name,
    emoji.textColor,
    emoji.downloadUrl ?? null,
  );
}

export function customEmojiFromItem(item: ExpressionItem, offset: number): MessageEntityCustomEmoji {
  return customEmojiEntity({ ...item, downloadUrl: null }, offset);
}

/** What the placeholder draws: the pack's current item when it is known, else what the entity carries. */
export function customEmojiMedia(entity: CustomEmojiFields, item?: ExpressionItem | null): ExpressionMedia {
  if (item) return itemMedia(item);
  return {
    fileId: entity.fileId,
    format: entity.format as number as ExpressionMedia["format"],
    width: 0,
    height: 0,
    downloadUrl: entity.downloadUrl ?? null,
    textColor: entity.textColor,
  };
}

export function itemMedia(item: ExpressionItem): ExpressionMedia {
  return {
    fileId: item.fileId,
    format: item.format as number as ExpressionMedia["format"],
    width: item.width,
    height: item.height,
    outline: item.outline ?? null,
    thumbFileId: item.thumbFileId ?? null,
    downloadUrl: item.downloadUrl ?? null,
    thumbUrl: item.thumbUrl ?? null,
    textColor: item.textColor,
  };
}

export function stickerMedia(entity: MessageEntitySticker): ExpressionMedia {
  return {
    fileId: entity.fileId,
    format: entity.format as number as ExpressionMedia["format"],
    width: entity.width,
    height: entity.height,
    outline: entity.outline ?? null,
    thumbFileId: entity.thumbFileId ?? null,
    downloadUrl: entity.downloadUrl ?? null,
    thumbUrl: entity.thumbUrl ?? null,
  };
}

/**
 * The custom emoji that really sit in `text`: in range, over their own `:name:`, not overlapping,
 * in order, at most the limit.
 */
export function validCustomEmoji(
  text: string,
  entities: readonly IMessageEntity[],
  limit = MAX_CUSTOM_EMOJI_PER_MESSAGE,
): MessageEntityCustomEmoji[] {
  const sorted = entities.filter(isCustomEmojiEntity).sort((a, b) => a.offset - b.offset);
  const out: MessageEntityCustomEmoji[] = [];
  let end = 0;
  for (const e of sorted) {
    if (out.length >= limit) break;
    if (e.offset < end || e.length <= 0) continue;
    if (text.slice(e.offset, e.offset + e.length) !== customEmojiAlt(e.name)) continue;
    out.push(e);
    end = e.offset + e.length;
  }
  return out;
}

/**
 * The custom emoji of `before` that survive an edit turning it into `after`: the ones outside the
 * changed stretch (common prefix and suffix), moved by the change in length. One inside it
 * survives when its `:name:` occurs as often in `after` as in `before` (the edit touched the text
 * around it, not it): the n-th occurrence is still the n-th.
 */
export function carryCustomEmoji(
  before: string,
  after: string,
  entities: readonly MessageEntityCustomEmoji[],
): MessageEntityCustomEmoji[] {
  if (before === after) return validCustomEmoji(after, entities);
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) suffix++;

  const tail = before.length - suffix;
  const delta = after.length - before.length;
  const moved: MessageEntityCustomEmoji[] = [];
  for (const e of entities) {
    if (e.offset + e.length <= prefix) moved.push(e);
    else if (e.offset >= tail) moved.push(customEmojiEntity(e, e.offset + delta));
    else {
      const alt = customEmojiAlt(e.name);
      const was = occurrences(before, alt);
      const now = occurrences(after, alt);
      const nth = was.indexOf(e.offset);
      if (nth >= 0 && was.length === now.length) moved.push(customEmojiEntity(e, now[nth]));
    }
  }
  return validCustomEmoji(after, moved);
}

function occurrences(text: string, part: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + part.length)) out.push(i);
  return out;
}

export interface EmojiTrigger {
  /** Offset of the `:`. */
  start: number;
  /** What follows it, up to the caret. */
  query: string;
}

const TRIGGER = /:([\p{L}\p{N}_+-]{2,64})$/u;
const TRIGGER_AFTER = /[\s([{«"'“]/u;

/**
 * An emoji query being typed: `:` and at least two name characters right before the caret, the `:`
 * at the start, after a space or an opening bracket/quote, or right after a custom emoji. Not a
 * time (`12:30`), a link (`http:`) or the closing colon of a custom emoji.
 */
export function findEmojiTrigger(
  beforeCaret: string,
  customEmoji: readonly { offset: number; length: number }[] = [],
): EmojiTrigger | null {
  const match = TRIGGER.exec(beforeCaret);
  if (!match) return null;
  const start = match.index;
  if (customEmoji.some((e) => start >= e.offset && start < e.offset + e.length)) return null;
  if (start > 0 && !TRIGGER_AFTER.test(beforeCaret[start - 1]) && !customEmoji.some((e) => e.offset + e.length === start)) {
    return null;
  }
  return { start, query: match[1] };
}

/** Big emoji: 1 to 7 of them and nothing else, drawn at these sizes (px), as Telegram does. */
export const JUMBO_EMOJI_SIZES = [96, 90, 84, 72, 60, 48, 36] as const;

export interface JumboEmoji {
  count: number;
  size: number;
}

/** The message's text is only emoji (unicode and/or custom), 1–7 of them: how many, and their size. */
export function jumboEmoji(text: string | null | undefined, entities: readonly IMessageEntity[] = []): JumboEmoji | null {
  if (!text?.trim()) return null;
  const custom = entities.filter(isCustomEmojiEntity).sort((a, b) => a.offset - b.offset);
  let rest = "";
  let cursor = 0;
  for (const e of custom) {
    if (e.offset < cursor || e.length <= 0 || e.offset + e.length > text.length) return null;
    rest += `${text.slice(cursor, e.offset)} `;
    cursor = e.offset + e.length;
  }
  rest += text.slice(cursor);

  let count = custom.length;
  const unicode = rest.replace(/\s/g, "");
  if (unicode) {
    const result = isEmojiOnly(unicode, JUMBO_EMOJI_SIZES.length);
    if (!result.isOnlyEmoji) return null;
    count += result.count;
  }
  if (count < 1 || count > JUMBO_EMOJI_SIZES.length) return null;
  return { count, size: JUMBO_EMOJI_SIZES[count - 1] };
}
