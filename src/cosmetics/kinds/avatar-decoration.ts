import { defineCosmeticKind } from "@/cosmetics/types";

export interface AvatarDecorationPayload {
  insetPct: number;
  beneath: boolean;
}

/**
 * The frame or ornament composited with an avatar.
 */
export default defineCosmeticKind<AvatarDecorationPayload>({
  key: "avatar.decoration",
  surfaces: ["avatar"],
  primitive: "imageLayer",
  layer: 200,
  scope: "both",
  labelKey: "cosmetic_kind_avatar_decoration",

  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as Partial<AvatarDecorationPayload>;
    const inset = typeof value.insetPct === "number" ? value.insetPct : 0;

    if (!Number.isFinite(inset) || inset < 0 || inset > 40) return null;

    return { insetPct: inset, beneath: value.beneath === true };
  },
});
