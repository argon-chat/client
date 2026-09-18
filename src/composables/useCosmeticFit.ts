import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { ArgonUserProfile } from "@argon/glue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import {
  hiddenEdges,
  insetsOf,
  outsetsOf,
  NO_EDGES,
  NO_SIDES,
  type CosmeticEdges,
  type CosmeticSurface,
} from "@/cosmetics/types";

export interface CosmeticFit {
  /** Custom properties the host adds to the padding, margin and border it already had. */
  readonly style: Record<string, string>;

  /**
   * Whether anything worn has taken over the surface's own edge.
   *
   * Separate from the properties because some of what draws a card's edge is not the card: a profile
   * popover's hairline belongs to the portal box around it, which no custom property set inside can
   * reach. A flag is something a selector can see from outside.
   */
  readonly framed: boolean;
}

/**
 * How far what somebody wears reaches past the card, for a caller that only knows who they are.
 *
 * <b>For keeping a floating card clear of the screen edge.</b> A popover is positioned by measuring
 * its own box, and a frame draws outside that box on purpose — so a card opened from a member list
 * at the right of the window sat flush against it and had its right-hand side cut off by the window.
 * The number goes to the popover's collision padding, which is the one thing that moves it.
 *
 * Read from the batch the surrounding list already filled, so it costs nothing and fetches nothing.
 * Before that batch lands it answers zero, and the popover is repositioned when it arrives.
 */
export function useCosmeticOverhang(
  userId: MaybeRefOrGetter<string | null | undefined>,
  spaceId: MaybeRefOrGetter<string | null | undefined>,
  surface: CosmeticSurface = "profileCard",
): ComputedRef<CosmeticEdges> {
  const cosmetics = useCosmeticsStore();

  return computed(() => {
    const who = toValue(userId);

    if (!who) return NO_EDGES;

    const worn = cosmetics.wornBy(toValue(spaceId) ?? null, who, surface);

    return worn.length > 0 ? outsetsOf(worn) : NO_EDGES;
  });
}

/**
 * How much room the things somebody is wearing need, and what they have taken over.
 *
 * <b>The only direction a cosmetic is allowed to speak in.</b> Everything worn is drawn into the
 * space the surface gives it, with one exception: a frame lies over the card's own top, hangs pieces
 * past its edges, and <i>is</i> that edge rather than sitting on it. None of the three is something
 * the card can work out for itself — only the row carrying the picture knows how much of it is
 * opaque, how far it goes and what it replaces.
 *
 * Three answers rather than one because the hosts want different things from the same frame. A
 * profile popover floats over a page and should let a piece overhang; a card in a settings column has
 * buttons above it and a picker draws a grid of cards side by side, and those reserve the room
 * instead. The frame is identical either way — the difference is a line of CSS in the host, which is
 * where a layout decision belongs.
 */
export function useCosmeticFit(
  profile: MaybeRefOrGetter<ArgonUserProfile | null | undefined>,
  surface: CosmeticSurface,
): ComputedRef<CosmeticFit> {
  const cosmetics = useCosmeticsStore();

  return computed(() => {
    const wearer = toValue(profile);
    const worn = wearer ? cosmetics.resolve(wearer, surface) : [];

    const inside = worn.length > 0 ? insetsOf(worn) : NO_EDGES;
    const outside = worn.length > 0 ? outsetsOf(worn) : NO_EDGES;
    const covered = worn.length > 0 ? hiddenEdges(worn) : NO_SIDES;

    const style: Record<string, string> = {
      "--cosmetic-inset-top": `${inside.top}px`,
      "--cosmetic-inset-right": `${inside.right}px`,
      "--cosmetic-inset-bottom": `${inside.bottom}px`,
      "--cosmetic-inset-left": `${inside.left}px`,

      "--cosmetic-outset-top": `${outside.top}px`,
      "--cosmetic-outset-right": `${outside.right}px`,
      "--cosmetic-outset-bottom": `${outside.bottom}px`,
      "--cosmetic-outset-left": `${outside.left}px`,
    };

    // Only the sides that are covered are named. A host writes `var(--cosmetic-edge-top, 1px)` and
    // keeps its own hairline everywhere nothing has taken it over.
    if (covered.top) style["--cosmetic-edge-top"] = "0px";
    if (covered.right) style["--cosmetic-edge-right"] = "0px";
    if (covered.bottom) style["--cosmetic-edge-bottom"] = "0px";
    if (covered.left) style["--cosmetic-edge-left"] = "0px";

    return {
      style,
      framed: covered.top || covered.right || covered.bottom || covered.left,
    };
  });
}
