/**
 * Turns what the user typed into the text that is sent plus the entities that describe it.
 *
 * Shared by the channel composer (EnterText) and the DM composer (ChatInput), which used to carry
 * two copies of this. Pure: no store, no component state — the mention registry is passed in.
 *
 * Supported markup:
 * - `__text__` italic, `**text**` bold, `~~text~~` strikethrough, `||text||` spoiler
 * - `` `text` `` monospace, `^^text^^` capitalized, `^text` ordinal (superscript)
 * - `1/2` fraction, `#hashtag`, `<tailwind-colour:text>` coloured underline
 * - `@mention`, from the registry the composer fills as the user picks people
 * - `@everyone`, only when the caller says the sender may use it (`everyone` option)
 * - links, as written (see detectLinks)
 *
 * Overlaps: matches are sorted by start (longer first on a tie) and the first one wins, so a
 * fraction, hashtag or underscore inside a link never takes the link apart. The one exception is a
 * link *inside* a styled span. Entities cannot nest (the renderer paints one entity per fragment),
 * so the span is split around the link: `**see https://argon.gl now**` becomes bold "see ", the
 * link, bold " now", with the markers gone. Such links are looked for in the span's own text, not
 * the raw one: `_`, `~` and `*` are legal in a URL, so against the raw text the closing marker
 * would be read as part of the address. A spoiler is deliberately not split — its whole point is
 * that nothing inside it shows until revealed, and a live link inside would give it away.
 */

import {
  EntityType,
  type IMessageEntity,
  MessageEntityBold,
  MessageEntityCapitalized,
  MessageEntityFraction,
  MessageEntityHashTag,
  MessageEntityItalic,
  MessageEntityMention,
  MessageEntityMentionEveryone,
  MessageEntityMonospace,
  MessageEntityOrdinal,
  MessageEntitySpoiler,
  MessageEntityStrikethrough,
  MessageEntityUnderline,
  MessageEntityUrl,
} from "@argon/glue";
import { findLinks } from "@/lib/linkPreview/detectLinks";

export interface ParsedMessage {
  text: string;
  entities: IMessageEntity[];
}

export interface ParseOptions {
  /** Turn `@everyone` into a mention of everyone. Off unless the sender holds MentionEveryone. */
  everyone?: boolean;
}

const EVERYONE = "@everyone";

interface FormatMatch {
  /** Raw range, markers included. */
  start: number;
  end: number;
  /** Raw range of the text that survives, i.e. without the markers. */
  contentStart: number;
  contentEnd: number;
  content: string;
  type: EntityType;
  extra?: Record<string, any>;
}

interface Pattern {
  regex: RegExp;
  type: EntityType;
  /** Which capture group is the text that stays; 0 keeps the whole match. */
  contentGroup: number;
  /** How many raw characters precede / follow the content inside the match. */
  prefix: number | ((m: RegExpMatchArray) => number);
  suffix: number;
  extraHandler?: (m: RegExpMatchArray) => Record<string, any>;
}

const PATTERNS: Pattern[] = [
  { regex: /__(.+?)__/g, type: EntityType.Italic, contentGroup: 1, prefix: 2, suffix: 2 },
  { regex: /\*\*(.+?)\*\*/g, type: EntityType.Bold, contentGroup: 1, prefix: 2, suffix: 2 },
  { regex: /~~(.+?)~~/g, type: EntityType.Strikethrough, contentGroup: 1, prefix: 2, suffix: 2 },
  { regex: /\|\|(.+?)\|\|/g, type: EntityType.Spoiler, contentGroup: 1, prefix: 2, suffix: 2 },
  { regex: /`([^`]+)`/g, type: EntityType.Monospace, contentGroup: 1, prefix: 1, suffix: 1 },
  { regex: /\^\^(.+?)\^\^/g, type: EntityType.Capitalized, contentGroup: 1, prefix: 2, suffix: 2 },
  { regex: /\^(\w+)/g, type: EntityType.Ordinal, contentGroup: 1, prefix: 1, suffix: 0 },
  {
    regex: /(\d+)\/(\d+)/g,
    type: EntityType.Fraction,
    contentGroup: 0,
    prefix: 0,
    suffix: 0,
    extraHandler: (m) => ({ numerator: Number.parseInt(m[1], 10), denominator: Number.parseInt(m[2], 10) }),
  },
  { regex: /#(\w+)/g, type: EntityType.Hashtag, contentGroup: 0, prefix: 0, suffix: 0 },
  {
    regex: /<([a-z]+-\d{3}):(.+?)>/g,
    type: EntityType.Underline,
    contentGroup: 2,
    prefix: (m) => 1 + m[1].length + 1, // "<" + colour key + ":"
    suffix: 1,
    extraHandler: (m) => {
      const colorKey = m[1];
      const mapped = (globalThis as any).tailwindColorMap?.[colorKey];
      const hex = mapped?.replace(/^#/, "") || "ffffff";
      return { colour: Number.parseInt(hex, 16) };
    },
  },
];

/** Styles a link may sit inside of; the span is split around the link (see the header). */
const SPLIT_AROUND_LINK = new Set<EntityType>([
  EntityType.Bold,
  EntityType.Italic,
  EntityType.Underline,
  EntityType.Strikethrough,
]);

const overlaps = (a: FormatMatch, b: FormatMatch) => !(a.end <= b.start || a.start >= b.end);

export function parseMessageContent(
  raw: string,
  mentions: ReadonlyMap<string, string> = new Map(),
  options: ParseOptions = {},
): ParsedMessage {
  const rawText = raw.trim();
  const formatMatches: FormatMatch[] = [];

  for (const { regex, type, contentGroup, prefix, suffix, extraHandler } of PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpMatchArray | null;
    while ((match = regex.exec(rawText)) !== null) {
      const start = match.index!;
      const end = start + match[0].length;
      const before = typeof prefix === "function" ? prefix(match) : prefix;
      formatMatches.push({
        start,
        end,
        contentStart: start + before,
        contentEnd: end - suffix,
        content: contentGroup === 0 ? match[0] : match[contentGroup],
        type,
        extra: extraHandler?.(match),
      });
    }
  }

  for (const [mentionText, userId] of mentions) {
    let searchPos = 0;
    while (true) {
      const idx = rawText.indexOf(mentionText, searchPos);
      if (idx === -1) break;
      formatMatches.push({
        start: idx,
        end: idx + mentionText.length,
        contentStart: idx,
        contentEnd: idx + mentionText.length,
        content: mentionText,
        type: EntityType.Mention,
        extra: { userId },
      });
      searchPos = idx + mentionText.length;
    }
  }

  if (options.everyone) {
    const everyone = /(?<![\w@])@everyone(?!\w)/g;
    let match: RegExpMatchArray | null;
    while ((match = everyone.exec(rawText)) !== null) {
      const start = match.index!;
      formatMatches.push({
        start,
        end: start + EVERYONE.length,
        contentStart: start,
        contentEnd: start + EVERYONE.length,
        content: EVERYONE,
        type: EntityType.MentionEveryone,
      });
    }
  }

  // Links, as written. Found here and not by a pattern above so that a fraction, hashtag or
  // underscore inside a URL never wins over the URL: the overlap pass keeps the earliest match.
  for (const link of findLinks(rawText)) {
    formatMatches.push({
      start: link.offset,
      end: link.offset + link.length,
      contentStart: link.offset,
      contentEnd: link.offset + link.length,
      content: link.text,
      type: EntityType.Url,
      extra: { domain: link.domain, path: link.path },
    });
  }

  // Sort by start position, then by length (longer matches first for same position)
  formatMatches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Remove overlapping matches (keep first one)
  const kept: FormatMatch[] = [];
  for (const fm of formatMatches) {
    if (!kept.some((existing) => overlaps(fm, existing))) kept.push(fm);
  }

  // Cut every splittable span that has links in its text into the pieces between them. A piece may
  // be empty of content (the link sat right after the opening marker) and still has to exist as a
  // range, so the marker it covers is dropped from the text; it produces no entity.
  const nonOverlapping: FormatMatch[] = [];
  for (const fm of kept) {
    const links = SPLIT_AROUND_LINK.has(fm.type) ? linksWithin(fm) : [];
    if (links.length === 0) {
      nonOverlapping.push(fm);
      continue;
    }
    let cursor = fm.start;
    let contentCursor = fm.contentStart;
    for (const link of links) {
      nonOverlapping.push({
        ...fm,
        start: cursor,
        end: link.start,
        contentStart: contentCursor,
        contentEnd: link.start,
        content: rawText.slice(contentCursor, link.start),
      });
      nonOverlapping.push(link);
      cursor = link.end;
      contentCursor = link.end;
    }
    nonOverlapping.push({
      ...fm,
      start: cursor,
      end: fm.end,
      contentStart: contentCursor,
      contentEnd: fm.contentEnd,
      content: rawText.slice(contentCursor, fm.contentEnd),
    });
  }

  // Build clean text and entities with adjusted offsets
  const entities: IMessageEntity[] = [];
  let cleanText = "";
  let lastEnd = 0;

  for (const fm of nonOverlapping) {
    cleanText += rawText.slice(lastEnd, fm.start);
    const entityStart = cleanText.length;
    cleanText += fm.content;
    const entityLength = cleanText.length - entityStart;
    lastEnd = fm.end;
    if (entityLength === 0) continue;
    entities.push(toEntity(fm, entityStart, entityLength));
  }

  cleanText += rawText.slice(lastEnd);

  return { text: cleanText, entities };
}

/** The links in a span's own text, as matches positioned in the raw text. */
function linksWithin(span: FormatMatch): FormatMatch[] {
  return findLinks(span.content).map((link) => {
    const start = span.contentStart + link.offset;
    const end = start + link.length;
    return {
      start,
      end,
      contentStart: start,
      contentEnd: end,
      content: link.text,
      type: EntityType.Url,
      extra: { domain: link.domain, path: link.path },
    };
  });
}

/** Entities go through their constructors: the serializer needs the real classes, not literals. */
function toEntity(fm: FormatMatch, offset: number, length: number): IMessageEntity {
  const version = 1;
  switch (fm.type) {
    case EntityType.Mention:
      return new MessageEntityMention(EntityType.Mention, offset, length, version, fm.extra!.userId);
    case EntityType.MentionEveryone:
      return new MessageEntityMentionEveryone(EntityType.MentionEveryone, offset, length, version);
    case EntityType.Hashtag:
      return new MessageEntityHashTag(EntityType.Hashtag, offset, length, version, fm.content.slice(1));
    case EntityType.Underline:
      return new MessageEntityUnderline(EntityType.Underline, offset, length, version, fm.extra?.colour ?? 0xffffff);
    case EntityType.Bold:
      return new MessageEntityBold(EntityType.Bold, offset, length, version);
    case EntityType.Italic:
      return new MessageEntityItalic(EntityType.Italic, offset, length, version);
    case EntityType.Strikethrough:
      return new MessageEntityStrikethrough(EntityType.Strikethrough, offset, length, version);
    case EntityType.Spoiler:
      return new MessageEntitySpoiler(EntityType.Spoiler, offset, length, version);
    case EntityType.Monospace:
      return new MessageEntityMonospace(EntityType.Monospace, offset, length, version);
    case EntityType.Ordinal:
      return new MessageEntityOrdinal(EntityType.Ordinal, offset, length, version);
    case EntityType.Capitalized:
      return new MessageEntityCapitalized(EntityType.Capitalized, offset, length, version);
    case EntityType.Fraction:
      return new MessageEntityFraction(EntityType.Fraction, offset, length, version, fm.extra!.numerator, fm.extra!.denominator);
    case EntityType.Url:
      return new MessageEntityUrl(EntityType.Url, offset, length, version, fm.extra!.domain, fm.extra!.path);
    default:
      throw new Error(`parseMessageContent: no entity for type ${fm.type}`);
  }
}

export interface SerializedMessage {
  /** The text with markers back in, as the composer holds it. */
  raw: string;
  /** Mention text to user id, for the composer's mention registry. */
  mentions: Map<string, string>;
}

const WRAP: Partial<Record<EntityType, [string, string]>> = {
  [EntityType.Bold]: ["**", "**"],
  [EntityType.Italic]: ["__", "__"],
  [EntityType.Strikethrough]: ["~~", "~~"],
  [EntityType.Spoiler]: ["||", "||"],
  [EntityType.Monospace]: ["`", "`"],
  [EntityType.Capitalized]: ["^^", "^^"],
  [EntityType.Ordinal]: ["^", ""],
};

/**
 * The reverse of {@link parseMessageContent}, for editing a sent message: puts the markers back so
 * that parsing the result gives the same text and entities. Links, hashtags, fractions and
 * `@everyone` are found again by the parser and stay as written. Attachments, GIFs and link cards
 * are not text and are left out; the server keeps them through an edit.
 */
export function serializeMessageContent(text: string, entities: readonly IMessageEntity[]): SerializedMessage {
  const mentions = new Map<string, string>();
  const spans: IMessageEntity[] = [];
  for (const entity of [...entities].sort((a, b) => a.offset - b.offset || b.length - a.length)) {
    if (entity.length <= 0 || entity.offset < 0 || end(entity) > text.length) continue;
    if (spans.length && entity.offset < end(spans[spans.length - 1])) continue;
    spans.push(entity);
  }

  let raw = "";
  let cursor = 0;

  for (let i = 0; i < spans.length; i++) {
    const entity = spans[i];
    raw += text.slice(cursor, entity.offset);

    // The parser cuts a style around a link inside it. Put the span back together, or the closing
    // marker right after the link would be read as part of the address.
    const next = spans[i + 1];
    const style = SPLIT_AROUND_LINK.has(entity.type)
      ? entity
      : entity.type === EntityType.Url && next && SPLIT_AROUND_LINK.has(next.type) && next.offset === end(entity)
        ? next
        : null;

    if (style) {
      let last = i;
      while (
        last + 1 < spans.length &&
        spans[last + 1].offset === end(spans[last]) &&
        (spans[last + 1].type === EntityType.Url || sameStyle(spans[last + 1], style))
      ) last++;

      const content = text.slice(entity.offset, end(spans[last]));
      const markers = markersFor(style);
      raw += markers ? markers[0] + content + markers[1] : content;
      cursor = end(spans[last]);
      i = last;
      continue;
    }

    const content = text.slice(entity.offset, end(entity));
    const markers = markersFor(entity);
    if (entity.type === EntityType.Mention) mentions.set(content, (entity as MessageEntityMention).userId);
    raw += markers ? markers[0] + content + markers[1] : content;
    cursor = end(entity);
  }

  raw += text.slice(cursor);
  return { raw, mentions };
}

const end = (e: IMessageEntity) => e.offset + e.length;

const sameStyle = (a: IMessageEntity, b: IMessageEntity) =>
  a.type === b.type &&
  (a.type !== EntityType.Underline || (a as MessageEntityUnderline).colour === (b as MessageEntityUnderline).colour);

function markersFor(entity: IMessageEntity): [string, string] | null {
  const wrap = WRAP[entity.type];
  if (wrap) return wrap;
  if (entity.type !== EntityType.Underline) return null;
  const key = colourKey((entity as MessageEntityUnderline).colour);
  return key ? [`<${key}:`, ">"] : null;
}

function colourKey(colour: number): string | null {
  const map = (globalThis as any).tailwindColorMap as Record<string, string> | undefined;
  if (!map) return null;
  const hex = colour.toString(16).padStart(6, "0");
  for (const [key, value] of Object.entries(map)) {
    if (/^[a-z]+-\d{3}$/.test(key) && value.replace(/^#/, "").toLowerCase() === hex) return key;
  }
  return null;
}
