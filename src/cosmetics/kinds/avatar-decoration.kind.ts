import type { AvatarDecorationPayload } from "@/cosmetics/kinds/avatar-decoration";
import { defineCosmeticKind } from "@/cosmetics/defineCosmeticKind";
import { avatarDecorationOf } from "@/cosmetics/wire";

export default defineCosmeticKind<AvatarDecorationPayload>({
  key: "avatar.decoration",
  surfaces: ["avatar"],
  primitive: "imageLayer",
  layer: 200,
  labelKey: "cosmetic_kind_avatar_decoration",

  parsePayload: avatarDecorationOf,
});
