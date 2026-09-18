import { logger } from "@argon/core";
import type { CosmeticKindModule, CosmeticSurface } from "@/cosmetics/types";

/**
 * Every cosmetic kind this build ships, read from the files in `kinds/`.
 *
 * The same arrangement `@argon/inventory` uses for item definitions, and for the same reason: the
 * set is the directory listing, so adding a kind is adding a file and removing one is removing a
 * file. Nothing lists them by hand, so nothing can be out of date.
 *
 * A key the server sends that no file declares resolves to `undefined` and is skipped — which is
 * what makes an older client forward-compatible with kinds shipped after it, for free.
 */
const kindModules = import.meta.glob("./kinds/*.ts", {
  eager: true,
  import: "default",
}) as Record<string, CosmeticKindModule>;

const byKey = new Map<string, CosmeticKindModule>();

for (const [path, module] of Object.entries(kindModules)) {
  if (!module?.key) {
    logger.error("Cosmetic kind file exports no key", path);
    continue;
  }

  const existing = byKey.get(module.key);

  if (existing) {
    logger.error("Two cosmetic kinds claim the same key", module.key, path);
    continue;
  }

  byKey.set(module.key, module);
}

export const cosmeticKinds: readonly CosmeticKindModule[] = [...byKey.values()];

export function resolveKind(kindKey: string): CosmeticKindModule | undefined {
  return byKey.get(kindKey);
}

export function kindsForSurface(surface: CosmeticSurface): CosmeticKindModule[] {
  return cosmeticKinds.filter(kind => kind.surfaces.includes(surface));
}
