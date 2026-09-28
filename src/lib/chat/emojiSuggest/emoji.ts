import { unifiedFromText, unifiedHexcode } from "@argon-chat/emojix";

const TONE = /^1f3f[b-f]$/;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const KEYCAP = /^[#*0-9]️?⃣$/u;
const WORDY = /[\p{L}\p{N}]/u;
const STRIP = /[︎️\u{1F3FB}-\u{1F3FF}]/gu;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Lower-case code points without presentation selectors or skin tones: what emoji are compared and counted by. */
export function baseHexcode(hexcode: string): string {
  return unifiedHexcode(hexcode)
    .split("-")
    .filter((h) => h && !TONE.test(h))
    .join("-");
}

export const baseHexcodeOf = (text: string): string => baseHexcode(unifiedFromText(text));

/** The emoji as typed, without VS16/VS15 and tones (how item associations are matched). */
export const stripEmoji = (text: string): string => text.replace(STRIP, "");

export const textOfHexcode = (hexcode: string): string =>
  String.fromCodePoint(...hexcode.split("-").map((h) => parseInt(h, 16)));

/** One grapheme that is a unicode emoji (not a letter or digit, keycaps and flags included). */
export function isEmojiGrapheme(g: string): boolean {
  if (!g) return false;
  if (KEYCAP.test(g) || FLAG.test(g)) return true;
  return PICTOGRAPH.test(g) && !WORDY.test(g);
}

export function graphemes(text: string): Intl.SegmentData[] {
  return [...segmenter.segment(text)];
}
