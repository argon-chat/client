import type { ResolvedOption } from "@/cosmetics/types";

/**
 * What a picker gives an option to draw itself with.
 *
 * A compositional kind supplies its own chip, because only it knows whether one of its rows is a
 * face or a treatment — and a picker that switched on kind keys would be the one file every new
 * option kind had to be added to.
 */
export interface CosmeticOptionChipProps {
  /** The row as resolved: its slug, its payload, and the file a face is loaded from. */
  readonly option: ResolvedOption;

  /** Text to set the sample in, so a face is judged on real letters. */
  readonly sample: string;

  /** A readable stand-in colour, for a treatment that composes one before any is chosen. */
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
