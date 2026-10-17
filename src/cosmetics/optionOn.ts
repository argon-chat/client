import type {
  CosmeticFacet,
  ResolvedCosmetic,
  ResolvedOption,
} from "@/cosmetics/types";

export function optionOn(cosmetic: ResolvedCosmetic, facetId: CosmeticFacet["id"]): ResolvedOption | undefined {
  return cosmetic.options.find(option => option.facetId === facetId);
}
