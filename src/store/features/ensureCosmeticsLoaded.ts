import { logger } from "@argon/core";

/**
 * Starts loading the cosmetics catalogue and what this account owns, without waiting on it.
 *
 * Imported lazily: boot and reconnect run before anything draws a cosmetic, and a chunk that fails to
 * load must not take either of them down with it.
 */
export function ensureCosmeticsLoaded(): void {
  void import("@/store/features/cosmeticsStore")
    .then(({ useCosmeticsStore }) => useCosmeticsStore().ensureLoaded())
    .catch(error => {
      logger.warn("Could not load cosmetics", error);
    });
}
