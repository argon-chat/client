/**
 * A treatment: the one kind of option a catalogue row cannot carry on its own.
 *
 * The other axis offers data — a face is a family name and a file — so an operator adds one from
 * the admin console and no release is involved. A treatment is rules and
 * keyframes, and letting a row carry those would mean CSS arriving from the database, which is the
 * thing this design refuses outright.
 *
 * So a treatment is still an ordinary item — priced, owned, published, switchable — and the code for
 * it is one file here named after the item's slug. An item whose slug this build has no file for is
 * simply not offered, which is what keeps an older client safe against treatments released after it.
 */
export interface TextEffectContext {
  /**
   * Every colour in play, in the order they were given: the wearer's own if they picked any, else
   * the one the name would have been drawn in anyway, such as its role colour.
   *
   * <b>A treatment is how a name is painted, not what colour it is.</b> The first version handed one
   * colour, so anybody who had chosen two or more of their own got no treatment at all — the
   * renderer painted their list and never asked. Which made the whole axis look broken from the
   * outside: three things to choose between and no difference between them.
   */
  readonly stops: readonly string[];

  /** The first of them, which is all a treatment written for a single colour ever needed. */
  readonly tint: string | null;

  lighten(hex: string, amount: number): string;
  shade(hex: string, amount: number): string;

  /** Paints the colours across the letters, aimed the way the wearer aimed them. */
  gradient(...stops: string[]): Record<string, string>;
}

export interface TextEffectModule {
  /** Must equal the catalogue row's slug. That is how the two halves find each other. */
  readonly slug: string;

  /** CSS for the name. Null leaves it as it would have been drawn with no treatment at all. */
  style(context: TextEffectContext): Record<string, string> | null;

  /**
   * Keyframes this treatment needs, installed with every other one's and gone when the file is.
   * Left out by a still treatment.
   */
  readonly keyframes?: string;
}

/**
 * Hands the treatment back as it was given.
 *
 * It exists for the type: a file under `effects/` is checked against the contract where it is
 * written, rather than turning out to be the wrong shape when the registry finds it.
 */
export function defineTextEffect(effect: TextEffectModule): TextEffectModule {
  return effect;
}
