import { defineCosmeticKind } from "@/cosmetics/types";

/** How a picture drawn over a whole card is laid into it. */
export interface CardLayerPayload {
  fit: "stretch" | "cover";
  opacity: number;
}

/**
 * Something moving across the whole profile card, above the frame and everything else.
 *
 * The layer above a frame, because an effect is weather and a frame is the window: snow falls in
 * front of the glass. It is drawn over somebody's own words and picture, so it is see-through by
 * declaration and takes no clicks.
 */
export default defineCosmeticKind<CardLayerPayload>({
  key: "profile.effect",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "cardLayer",
  layer: 700,
  scope: "both",
  labelKey: "cosmetic_kind_profile_effect",

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as Partial<CardLayerPayload>;
    const opacity = typeof value.opacity === "number" ? value.opacity : 1;

    if (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 1) return null;

    return { fit: value.fit === "stretch" ? "stretch" : "cover", opacity };
  },
});
