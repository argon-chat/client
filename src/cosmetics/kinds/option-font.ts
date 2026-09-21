/**
 * One typeface a display name may be set in.
 *
 * The family is asked for by name, and the name only ever resolves to something this product
 * serves: either a face already in the bundle, or the uploaded file registered under that family
 * by `FontFace`. A raw family reaching CSS would render as whatever the viewer happens to have
 * installed, which is how an unlicensed face ends up on screen without anything having shipped it.
 */
export interface FontOptionPayload {
  readonly cssFamily: string;
}

/**
 * Letters, digits, spaces, underscores and hyphens, starting with a letter or digit.
 *
 * The same shape the server holds the row to. It reaches a `font-family` declaration on every
 * viewer of the name, so what is allowed through is a shape with no room in it rather than
 * whatever a stylesheet happens to tolerate.
 */
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

const MAX_LENGTH = 96;

export function parseFontOptionPayload(raw: unknown): FontOptionPayload | null {
  if (typeof raw !== "object" || raw === null) return null;

  const { cssFamily } = raw as Partial<FontOptionPayload>;

  return typeof cssFamily === "string" && cssFamily.length <= MAX_LENGTH && FAMILY.test(cssFamily)
    ? { cssFamily }
    : null;
}
