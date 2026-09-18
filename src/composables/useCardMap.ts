import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { ArgonUserProfile } from "@argon/glue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { boardHeight } from "@/cosmetics/boardLayout";
import { AUTHORED_CARD_WIDTH, type CosmeticSurface } from "@/cosmetics/types";

/**
 * Where the parts of a profile card are, published for the things drawn on top of it.
 *
 * <b>The other direction of the seam `useCosmeticFit` opens.</b> That one carries what a cosmetic
 * asks of the card — room to overhang, edges it has taken over. This carries what the card can tell
 * a cosmetic about itself, and it exists because a whole-card cosmetic has exactly two questions and
 * both are about the card's own layout: where does the board start, and where is the face.
 *
 * <b>Nothing here measures the DOM.</b> The board's height is arithmetic (see `boardLayout`) and the
 * face is wherever the host's own CSS puts it — both are known before anything is on screen, which
 * is what a popover that opens under the cursor needs. A ResizeObserver would answer a frame late,
 * and a scene that settles into place a frame after the card appears is a scene that visibly jumps.
 *
 * <b>Every number belongs to the host, not to this file.</b> A popover is 384px wide with a 92px
 * avatar; a settings card is 320px with a 65px one, in a different place. So a host hands in its own
 * measurements and a third one that draws a card differently supplies a third set, instead of this
 * keeping a copy of a layout it cannot see.
 */
export interface CardGeometry {
  /** The card's width in pixels, against the 384 a cosmetic's numbers are authored for. */
  readonly width: number;

  /** From the card's top to the line the glass starts at, before any worn inset. */
  readonly glassTop: number;

  /** Where the avatar's centre sits, from the card's top-left, before any worn inset. */
  readonly faceX: number;
  readonly faceY: number;
  readonly faceRadius: number;

  /** What the board's rows are drawn at here. */
  readonly rowHeight: number;

  /**
   * What is under the board and still inside the card: the glass body's own bottom padding.
   *
   * The space <i>above</i> the board is deliberately not part of this. What a scene needs is the
   * distance from the card's bottom edge up to the board's top edge, and measuring upwards means
   * whatever sits above the board — a bio of one line or six — never enters into it.
   */
  readonly boardTail: number;
}

/**
 * The profile popover: 24rem wide, a 100px hero, and a 92px avatar pulled 44px up into it.
 *
 * The avatar is 80px of picture inside 3px of padding inside a 3px border, which is the 92 and the
 * 46 below; the 16 is `.glass-body`'s padding.
 */
export const POPOVER_CARD: CardGeometry = {
  width: AUTHORED_CARD_WIDTH,
  glassTop: 100,
  faceX: 16 + 46,
  faceY: 100 - 44 + 46,
  faceRadius: 46,
  rowHeight: 28,
  boardTail: 16,
};

/**
 * The settings column's card: the same card drawn smaller, with its own numbers throughout.
 *
 * 56px of picture inside 2px of padding inside a 2.5px border is a 65px box, so the radius is 32.5
 * and not a rounder number. Taking the popover's numbers here would put a scene's face-shaped hole
 * a centimetre from the face.
 */
export const SETTINGS_CARD: CardGeometry = {
  width: 320,
  glassTop: 90,
  faceX: 12 + 32.5,
  faceY: 90 - 32 + 32.5,
  faceRadius: 32.5,
  rowHeight: 28,
  boardTail: 12,
};

export function useCardMap(
  profile: MaybeRefOrGetter<ArgonUserProfile | null | undefined>,
  surface: CosmeticSurface,
  geometry: CardGeometry,
): ComputedRef<Record<string, string>> {
  const cosmetics = useCosmeticsStore();

  return computed(() => {
    const wearer = toValue(profile);
    const worn = wearer ? cosmetics.resolve(wearer, surface) : [];

    const cells = worn.filter(item => item.kind.board).map(item => item.cell);
    const board = boardHeight(cells, geometry.rowHeight);

    // Nothing on the board is no board at all rather than a board of no rows: `CosmeticBoard`
    // renders nothing, so there is no box to leave room under and no padding beneath it either.
    const reach = board === 0 ? 0 : board + geometry.boardTail;

    return {
      "--cosmetic-card-width": `${geometry.width}px`,
      "--cosmetic-board-height": `${reach}px`,

      // Written as a calc rather than added up here, so these follow a frame that changes its mind
      // without this having to recompute — the inset is itself a custom property the host is setting
      // from what somebody is wearing.
      "--cosmetic-glass-top": `calc(${geometry.glassTop}px + var(--cosmetic-inset-top, 0px))`,
      "--cosmetic-face-cx": `calc(${geometry.faceX}px + var(--cosmetic-inset-left, 0px))`,
      "--cosmetic-face-cy": `calc(${geometry.faceY}px + var(--cosmetic-inset-top, 0px))`,
      "--cosmetic-face-r": `${geometry.faceRadius}px`,
    };
  });
}
