import { emojiRegistry, tokenizeEmoji, type EmojiEntry } from "@argon-chat/emojix";

/**
 * Unicode emoji in message text, drawn from emojix's sprite atlases (Apple's art). The grammar is
 * emojix's (tokenizeEmoji: flags, keycaps, ZWJ sequences, skin tones, VS16 pictographs; a bare
 * digit or © stays text), the same one the composer and the big-emoji rule use.
 */

export interface EmojiTextPiece {
  text: string;
  /** Set when this piece is one emoji the atlases can draw. */
  emoji?: EmojiEntry;
}

/** Could hold an emoji at all: a pictograph, a keycap mark or a regional indicator. */
const MAYBE_EMOJI = /[\p{Extended_Pictographic}⃣\u{1F1E6}-\u{1F1FF}]/u;

export type EmojiLookup = (emoji: string) => EmojiEntry | undefined;

const registryLookup: EmojiLookup = (emoji) => emojiRegistry.getByText(emoji);

/**
 * `text` as runs of plain text and single drawable emoji. Joined back, the pieces are exactly
 * `text`; an emoji without a sprite stays in its text run, and adjacent text is one piece.
 */
export function splitEmojiText(text: string, lookup: EmojiLookup = registryLookup): EmojiTextPiece[] {
  if (!text) return [];
  if (!MAYBE_EMOJI.test(text)) return [{ text }];
  const out: EmojiTextPiece[] = [];
  let run = "";
  for (const segment of tokenizeEmoji(text)) {
    const emoji = segment.type === "emoji" ? lookup(segment.content) : undefined;
    if (!emoji?.atlasRef.atlasId) {
      run += segment.content;
      continue;
    }
    if (run) out.push({ text: run });
    run = "";
    out.push({ text: segment.content, emoji });
  }
  if (run) out.push({ text: run });
  return out;
}
