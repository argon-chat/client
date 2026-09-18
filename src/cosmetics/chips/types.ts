/**
 * What a picker gives an option to draw itself with.
 *
 * A compositional kind supplies its own chip, because only it knows whether one of its rows is a
 * colour, a face or a treatment — and a picker that switched on kind keys would be the one file
 * every new option kind had to be added to.
 */
export interface CosmeticOptionChipProps {
  readonly slug: string;
  readonly payload: unknown;

  /** Text to set the sample in, so a face is judged on real letters. */
  readonly sample: string;

  /** The colour chosen elsewhere on the same item, for a treatment that composes one. */
  readonly tint?: string | null;

  /**
   * Every colour the item is actually carrying, where there is more than one.
   *
   * <b>A chip has to be drawn in what the person will get.</b> Showing each treatment over a single
   * swatch while their name is painted in three colours of their own is showing them something that
   * is not going to happen — and with the treatments that only compose several colours, it is a row
   * of samples that all look the same.
   */
  readonly stops?: readonly string[];
}

/**
 * Mixes a colour towards white or black. Shared so a chip draws what the renderer will.
 *
 * Reads `rgb()` as well as hex: a role colour arrives in that form, and a version that understood
 * only hex handed back the colour it was given, which paints as flat.
 */
export function mixToward(colour: string, towards: number, amount: number): string {
  const channels = channelsOf(colour);

  if (!channels) return colour;

  const blended = channels.map(channel => Math.round(channel + (towards - channel) * amount));

  return `#${blended.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function channelsOf(colour: string): number[] | null {
  if (colour.startsWith("#") && colour.length === 7) {
    const value = Number.parseInt(colour.slice(1), 16);

    return Number.isFinite(value) ? [value >> 16 & 0xff, value >> 8 & 0xff, value & 0xff] : null;
  }

  const parsed = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(colour);

  return parsed ? [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])] : null;
}
