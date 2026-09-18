import { defineCosmeticKind } from "@/cosmetics/types";

export interface BadgePayload {
  tooltipKey: string;
  tint: number | null;
}

/**
 * The small icons beside a display name.
 *
 * The tooltip is a translation key rather than a string: a badge outlives the language it was
 * created in, and the three this replaces are hardcoded English today.
 */
export default defineCosmeticKind<BadgePayload>({
  key: "profile.badge",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "iconBadge",
  layer: 300,

  // Ordered, and the order is the order they are drawn in. Mirrors BadgeKind's MaxSlots(8).
  maxSlots: 8,

  scope: "both",
  labelKey: "cosmetic_kind_profile_badge",

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as Partial<BadgePayload>;

    if (typeof value.tooltipKey !== "string" || value.tooltipKey.length === 0) return null;

    return {
      tooltipKey: value.tooltipKey,
      tint: typeof value.tint === "number" ? value.tint : null,
    };
  },
});
