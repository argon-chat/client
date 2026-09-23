/**
 * The frame or ornament composited with an avatar.
 */
export interface AvatarDecorationPayload {
  /**
   * How far the avatar is pulled in inside the decoration, as whole percent of its own size.
   *
   * A decoration that draws a ring needs the avatar pulled in; an overlay sitting on top needs
   * zero. Whole percent because the thing being multiplied is a forty-pixel avatar, where a
   * fraction of a percent is a fraction of a pixel.
   */
  readonly insetPct: number;

  /** Whether the decoration is drawn under the avatar rather than over it. */
  readonly beneath: boolean;
}

const MAX_INSET_PCT = 40;

/**
 * The decoration's placement, or null when the inset is not a whole percent between 0 and 40.
 *
 * A missing inset is zero and a missing `beneath` is over, which is an overlay drawn on top — the
 * plainest thing a decoration can be. An inset out of range is refused rather than clamped: the
 * server holds the row to the same bound, so one past it is a row the two disagree about.
 */
export function parseAvatarDecorationPayload(raw: unknown): AvatarDecorationPayload | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Partial<AvatarDecorationPayload>;
  const inset = typeof value.insetPct === "number" ? value.insetPct : 0;

  if (!Number.isInteger(inset) || inset < 0 || inset > MAX_INSET_PCT) return null;

  return { insetPct: inset, beneath: value.beneath === true };
}
