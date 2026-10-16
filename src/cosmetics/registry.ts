import { logger } from "@argon/core";

import type {
  CosmeticKindModule,
  CosmeticSurface,
} from "@/cosmetics/types";

const kindModules = import.meta.glob("./kinds/*.kind.ts", {
  eager: true,
  import: "default",
}) as Record<string, CosmeticKindModule>;

const byKey = new Map<string, CosmeticKindModule>();

for (const [path, module] of Object.entries(kindModules)) {
  if (!module?.key) {
    logger.error("Cosmetic kind file exports no key", path);
    continue;
  }

  if (byKey.has(module.key)) {
    logger.error("Two cosmetic kinds claim the same key", module.key, path);
    continue;
  }

  byKey.set(module.key, module);
}

/** Every kind this build ships: the directory listing of `kinds/*.kind.ts`. */
export const cosmeticKinds: readonly CosmeticKindModule[] = [...byKey.values()];

export function resolveKind(kindKey: string): CosmeticKindModule | undefined {
  return byKey.get(kindKey);
}

export function kindsForSurface(surface: CosmeticSurface): CosmeticKindModule[] {
  return cosmeticKinds.filter(kind => kind.surfaces.includes(surface));
}
