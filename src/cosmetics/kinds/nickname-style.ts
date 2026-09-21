/**
 * The part of a name's look only its wearer decides.
 *
 * An axis is a list somebody else wrote; this is the colour you picked because it is yours. One
 * colour is flat, two or more are a gradient, and the angle says which way it runs.
 *
 * <b>Colours are ARGB integers, not hex strings.</b> A hex string is a parse and a shape check on
 * this side and another on the server's, for a value that is one number — and the two checks are
 * exactly the sort of pair that comes to disagree about whether `#rgb` counts. The client formats
 * the number for CSS at the point of drawing, which is the only place the string form is useful.
 *
 * There is no payload here to go with the tuning: the kind is bare, so there are no catalogue rows
 * of it. Everything anybody sees comes from the three axes and from this.
 */
export type NicknameGradientShape = "linear" | "radial" | "conic";

export interface NicknameStyleTuning {
  /** One to six ARGB colours, or null for a name drawn in whatever colour it would have been. */
  readonly colors: readonly number[] | null;

  readonly angle: number | null;
  readonly shape: NicknameGradientShape | null;

  /** Whether the colours travel along the name rather than sitting still. */
  readonly animate: boolean | null;

  /** The weight the face is set at, in the usual hundreds. */
  readonly weight: number | null;

  /** How far the letters are pushed apart, in hundredths of an em. */
  readonly letterSpacingCentiEm: number | null;
}

export const MAX_STOPS = 6;

const SHAPES: readonly string[] = ["linear", "radial", "conic"];

export function emptyNicknameStyleTuning(): NicknameStyleTuning {
  return { colors: null, angle: null, shape: null, animate: null, weight: null, letterSpacingCentiEm: null };
}

export function isNicknameStyleTuningEmpty(value: NicknameStyleTuning): boolean {
  return value.colors === null || value.colors.length === 0;
}

function bounded(raw: unknown, low: number, high: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;

  const rounded = Math.round(raw);

  return rounded < low || rounded > high ? null : rounded;
}

/**
 * A seventh colour is refused rather than trimmed.
 *
 * Trimming would draw a gradient its wearer did not choose and say nothing about it. Six is what
 * the server stores and what reads as distinct across a name; a list longer than that did not come
 * from this product's own editor.
 */
export function parseNicknameStyleTuning(raw: unknown): NicknameStyleTuning | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Partial<Record<keyof NicknameStyleTuning, unknown>>;

  let colors: number[] | null = null;

  if (Array.isArray(value.colors)) {
    if (value.colors.length > MAX_STOPS) return null;

    const read = value.colors.filter(
      colour => typeof colour === "number" && Number.isFinite(colour),
    ) as number[];

    colors = read.length > 0 ? read : null;
  }

  const shape = typeof value.shape === "string" && SHAPES.includes(value.shape)
    ? value.shape as NicknameGradientShape
    : null;

  return {
    colors,
    angle: bounded(value.angle, 0, 360),
    shape,
    animate: typeof value.animate === "boolean" ? value.animate : null,
    weight: bounded(value.weight, 100, 900),
    letterSpacingCentiEm: bounded(value.letterSpacingCentiEm, -10, 50),
  };
}
