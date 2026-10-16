import type { FontOptionPayload } from "@/cosmetics/kinds/option-font";
import { defineCosmeticKind } from "@/cosmetics/defineCosmeticKind";
import { fontOptionOf } from "@/cosmetics/wire";

export default defineCosmeticKind<FontOptionPayload>({
  key: "option.font",
  surfaces: [],
  primitive: "textStyle",
  layer: 0,
  labelKey: "cosmetic_kind_option_font",

  parsePayload: fontOptionOf,
});
