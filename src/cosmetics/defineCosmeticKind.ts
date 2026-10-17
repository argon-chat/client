import type { CosmeticKindModule } from "@/cosmetics/types";

export function defineCosmeticKind<TPayload>(module: CosmeticKindModule<TPayload>): CosmeticKindModule<TPayload> {
  return module;
}
