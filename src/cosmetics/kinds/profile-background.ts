import { defineCosmeticKind } from "@/cosmetics/types";

export interface ProfileBackgroundPayload {
  loop: boolean;
  tintOpacity: number;
}

/**
 * The full-bleed clip behind a profile card.
 */
export default defineCosmeticKind<ProfileBackgroundPayload>({
  key: "profile.background",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "videoLayer",
  layer: 100,
  scope: "both",
  labelKey: "cosmetic_kind_profile_background",

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as Partial<ProfileBackgroundPayload>;
    const tint = typeof value.tintOpacity === "number" ? value.tintOpacity : 0.35;

    if (!Number.isFinite(tint) || tint < 0 || tint > 1) return null;

    return { loop: value.loop !== false, tintOpacity: tint };
  },
});
