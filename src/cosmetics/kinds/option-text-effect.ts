import { logger } from "@argon/core";
import { defineAsyncComponent } from "vue";
import { defineCosmeticKind } from "@/cosmetics/types";
import type { TextEffectModule } from "@/cosmetics/textEffect";

/**
 * A treatment carries nothing in its payload: what it does is the file named after its slug.
 */
export type TextEffectOptionPayload = Record<string, never>;

const effectModules = import.meta.glob("../effects/*.ts", {
  eager: true,
  import: "default",
}) as Record<string, TextEffectModule>;

const bySlug = new Map<string, TextEffectModule>();

for (const [path, module] of Object.entries(effectModules)) {
  if (!module?.slug) {
    logger.error("A text effect file exports no slug", path);
    continue;
  }

  if (bySlug.has(module.slug)) {
    logger.error("Two text effects claim the same slug", module.slug, path);
    continue;
  }

  bySlug.set(module.slug, module);
}

/** The code for a treatment, or undefined when this build has no file for that row. */
export function textEffect(slug: string): TextEffectModule | undefined {
  return bySlug.get(slug);
}

export function textEffects(): readonly TextEffectModule[] {
  return [...bySlug.values()];
}

/**
 * One treatment a display name may be drawn with.
 *
 * No surfaces: nobody wears a treatment on its own, it is chosen on another kind's axis.
 *
 * <b>The half of this that is code lives in `effects/`, one file per slug.</b> The other half is an
 * ordinary catalogue row, so a treatment is priced, owned, published and switched off exactly like a
 * background is — and a row whose slug has no file here is left out of the picker rather than
 * offered and then rendering as nothing.
 */
export default defineCosmeticKind<TextEffectOptionPayload>({
  key: "option.text-effect",
  surfaces: [],
  primitive: "textStyle",
  layer: 0,
  scope: "both",
  labelKey: "cosmetic_kind_option_text_effect",

  chip: defineAsyncComponent(() => import("@/cosmetics/chips/TextEffectChip.vue")),

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    return {};
  },
});
