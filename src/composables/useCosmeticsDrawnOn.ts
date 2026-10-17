import {
  computed,
  type ComputedRef,
} from "vue";

import type { CosmeticSurface } from "@/cosmetics/types";
import { kindsForSurface } from "@/cosmetics/registry";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

/** Whether anything could be drawn on these surfaces at all, so a host asks for nothing when it cannot. */
export function useCosmeticsDrawnOn(surfaces: readonly CosmeticSurface[]): ComputedRef<boolean> {
  const cosmetics = useCosmeticsStore();

  return computed(() => {
    for (const surface of surfaces) {
      for (const kind of kindsForSurface(surface)) {
        if (cosmetics.isKindEnabled(kind.key)) {
          return true;
        }
      }
    }

    return false;
  });
}
