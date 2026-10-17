import {
  textEffect,
  type TextEffectOptionPayload,
} from "@/cosmetics/kinds/option-text-effect";
import { defineCosmeticKind } from "@/cosmetics/defineCosmeticKind";
import { textEffectOptionOf } from "@/cosmetics/wire";

/** A row is drawable only when this build ships the effect module named by its slug. */
export default defineCosmeticKind<TextEffectOptionPayload>({
  key: "option.text-effect",
  surfaces: [],
  primitive: "textStyle",
  layer: 0,
  labelKey: "cosmetic_kind_option_text_effect",

  parsePayload: textEffectOptionOf,

  implementsSlug: slug => textEffect(slug) !== undefined,
});
