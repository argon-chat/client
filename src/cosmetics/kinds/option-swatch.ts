/**
 * One colour a nickname treatment is drawn in.
 *
 * Nobody wears a colour: it is chosen on another kind's axis. The clearest case for options being
 * ordinary catalogue items — a colour is a number, so there is nothing a release could add here
 * that a row created from the admin console cannot.
 */
export interface SwatchOptionPayload {
  /** ARGB. It was a hex string, which was only ever read in order to be parsed. */
  readonly argb: number;
}

export function parseSwatchOptionPayload(raw: unknown): SwatchOptionPayload | null {
  if (typeof raw !== "object" || raw === null) return null;

  const { argb } = raw as Partial<SwatchOptionPayload>;

  if (typeof argb !== "number" || !Number.isInteger(argb)) return null;

  // A swatch nobody can see is a row in a picker that does nothing when it is chosen.
  return (argb >>> 24) === 0 ? null : { argb };
}
