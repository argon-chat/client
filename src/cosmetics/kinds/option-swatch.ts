import { defineAsyncComponent } from "vue";
import { defineCosmeticKind } from "@/cosmetics/types";

export interface SwatchOptionPayload {
  hex: string;
}

/**
 * One colour a nickname treatment is drawn in.
 *
 * No surfaces: nobody wears a colour. It is chosen on another kind's axis, which is what an empty
 * surface list means.
 *
 * The clearest case for options being ordinary catalogue items — a colour is a string, so there is
 * nothing a release could add here that a row created from the admin console cannot.
 */
export default defineCosmeticKind<SwatchOptionPayload>({
  key: "option.swatch",
  surfaces: [],
  primitive: "textStyle",
  layer: 0,
  scope: "both",
  labelKey: "cosmetic_kind_option_swatch",

  chip: defineAsyncComponent(() => import("@/cosmetics/chips/SwatchChip.vue")),

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const { hex } = raw as Partial<SwatchOptionPayload>;

    return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) ? { hex } : null;
  },
});
