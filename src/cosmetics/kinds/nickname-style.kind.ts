import {
  NICKNAME_STYLE_KIND,
  type NicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import { defineCosmeticKind } from "@/cosmetics/defineCosmeticKind";

/** Bare: there are no rows of it. A worn look is its two axes plus its wearer's own tuning. */
export default defineCosmeticKind<NicknameStyleTuning>({
  key: NICKNAME_STYLE_KIND,
  surfaces: ["profileCard", "ownProfile", "nicknameInMessages", "memberListRow"],
  primitive: "textStyle",
  layer: 400,
  labelKey: "cosmetic_kind_nickname_style",
  bare: true,

  facets: [
    { id: "font", labelKey: "cosmetic_facet_font", optionKindKey: "option.font" },
    { id: "effect", labelKey: "cosmetic_facet_effect", optionKindKey: "option.text-effect" },
  ],

  parsePayload: () => null,
});
