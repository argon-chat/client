import { logger } from "@argon/core";

import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

/**
 * Starts loading the cosmetics catalogue and what this account owns, without waiting on it.
 *
 * Imported statically: every avatar and name on screen reads the store, so it is in the entry chunk
 * whatever this file does, and a dynamic import here only split nothing and drew a bundler warning.
 * Boot and reconnect still must not go down with it, so a failure to start is logged and dropped.
 */
export function ensureCosmeticsLoaded(): void {
  try {
    useCosmeticsStore()
      .ensureLoaded()
      .catch(error => {
        logger.warn("Could not load cosmetics", error);
      });
  } catch (error) {
    logger.warn("Could not load cosmetics", error);
  }
}
