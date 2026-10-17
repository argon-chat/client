import type {
  CosmeticEdges,
  CosmeticSides,
} from "@/cosmetics/edges";
import type { ResolvedCosmetic } from "@/cosmetics/types";

/** The widest ask per side across everything worn: two things wanting the top overlap, they do not stack. */
function widest(
  worn: readonly ResolvedCosmetic[],
  ask: (item: ResolvedCosmetic) => CosmeticEdges | undefined,
): CosmeticEdges {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;

  for (const item of worn) {
    const asked = ask(item);

    if (asked === undefined) {
      continue;
    }

    top = Math.max(top, asked.top);
    right = Math.max(right, asked.right);
    bottom = Math.max(bottom, asked.bottom);
    left = Math.max(left, asked.left);
  }

  return { top, right, bottom, left };
}

/** How far the worn things push the surface's own content in. */
export function wornInsets(worn: readonly ResolvedCosmetic[]): CosmeticEdges {
  return widest(worn, item => item.kind.insetsOf?.(item));
}

/** How far the worn things reach outside the surface, so a host can reserve the room. */
export function wornOutsets(worn: readonly ResolvedCosmetic[]): CosmeticEdges {
  return widest(worn, item => item.kind.outsetsOf?.(item));
}

/** Every edge of the surface that something worn covers, so the surface stops drawing it. */
export function wornHiddenEdges(worn: readonly ResolvedCosmetic[]): CosmeticSides {
  let top = false;
  let right = false;
  let bottom = false;
  let left = false;

  for (const item of worn) {
    const covered = item.kind.hidesEdges?.(item);

    if (covered === undefined) {
      continue;
    }

    top ||= covered.top;
    right ||= covered.right;
    bottom ||= covered.bottom;
    left ||= covered.left;
  }

  return { top, right, bottom, left };
}
