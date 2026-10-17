const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The first `count` user-perceived characters, so a shortened name never ends in half an emoji. */
export function leadingGraphemes(text: string, count: number): string {
  let taken = "";
  let takenCount = 0;

  for (const { segment } of graphemes.segment(text)) {
    if (takenCount >= count) {
      break;
    }

    taken += segment;
    takenCount++;
  }

  return taken;
}
