import type { Component } from "vue";

import FontChip from "@/cosmetics/chips/FontChip.vue";
import TextEffectChip from "@/cosmetics/chips/TextEffectChip.vue";
import { resolveKind } from "@/cosmetics/registry";

const BUILT_IN_CHIPS: Readonly<Record<string, Component>> = {
  "option.font": FontChip,
  "option.text-effect": TextEffectChip,
};

/** How a row of an option kind draws itself in a picker: the kind's own chip, else the built-in one. */
export function chipForOptionKind(optionKindKey: string): Component | null {
  return resolveKind(optionKindKey)?.chip ?? BUILT_IN_CHIPS[optionKindKey] ?? null;
}
