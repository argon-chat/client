import {
  frameHidesEdges,
  frameInsets,
  frameOutsets,
  type ProfileFramePayload,
} from "@/cosmetics/kinds/profile-frame";
import { defineCosmeticKind } from "@/cosmetics/defineCosmeticKind";
import { profileFrameOf } from "@/cosmetics/wire";

export default defineCosmeticKind<ProfileFramePayload>({
  key: "profile.frame",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "frameAssembly",
  layer: 600,
  labelKey: "cosmetic_kind_profile_frame",

  parsePayload: profileFrameOf,

  insetsOf: item => frameInsets(item.payload),
  outsetsOf: item => frameOutsets(item.payload),
  hidesEdges: item => frameHidesEdges(item.payload),
});
