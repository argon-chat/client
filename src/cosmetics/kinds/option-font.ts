import { defineAsyncComponent } from "vue";
import { defineCosmeticKind } from "@/cosmetics/types";

export interface FontOptionPayload {
  cssFamily: string;
}

/**
 * One typeface a display name may be set in.
 *
 * The family is asked for by name, and the name only ever resolves to something this product serves:
 * either a face already in the bundle, or the uploaded file registered under that family by
 * `FontFace`. A raw family reaching CSS would render as whatever the viewer happens to have
 * installed, which is how an unlicensed face ends up on screen without anything having shipped it.
 */
export default defineCosmeticKind<FontOptionPayload>({
  key: "option.font",
  surfaces: [],
  primitive: "textStyle",
  layer: 0,
  scope: "both",
  labelKey: "cosmetic_kind_option_font",

  chip: defineAsyncComponent(() => import("@/cosmetics/chips/FontChip.vue")),

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const { cssFamily } = raw as Partial<FontOptionPayload>;

    return typeof cssFamily === "string" && cssFamily.length > 0 && cssFamily.length <= 96
      ? { cssFamily }
      : null;
  },
});
