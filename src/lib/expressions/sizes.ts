/** CSS pixel sizes of stickers and custom emoji across the app. */
export const EXPRESSION_SIZES = {
  chatSticker: 200,
  chatStickerNarrow: 180,
  pickerCell: 72,
  emojiPickerCell: 42,
  preview: 360,
  customEmojiDefault: 20,
} as const;

/** A custom emoji in text is the font size plus 4 px. */
export function customEmojiSize(fontSizePx?: number | null): number {
  return fontSizePx && fontSizePx > 0 ? Math.round(fontSizePx + 4) : EXPRESSION_SIZES.customEmojiDefault;
}

/** Aspect-fits width×height into a square box of `box` px. */
export function fitSize(width: number, height: number, box: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: box, height: box };
  const scale = Math.min(box / width, box / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
