import { ref } from "vue";
import { logger } from "@argon/core";

// Bumped on each seamless switch to force a remount of the authenticated shell, so component-scoped
// Dexie liveQuery subscriptions (server sidebar, member lists, channel lists) re-subscribe against the
// new account's DB. Store-level state is handled separately by the onSessionReset callbacks below.
export const sessionEpoch = ref(0);

// True while a seamless switch is in progress — drives a full-screen overlay that masks the brief
// teardown/reload so the user never sees an intermediate (half-swapped) state.
export const isSwitchingAccount = ref(false);

// Session lifecycle registry for SEAMLESS account switching (no page reload).
//
// Each account-scoped store registers a teardown callback via onSessionReset() in its setup. On a
// switch, the orchestrator (accountsStore.switchTo) calls runSessionReset() to clear every store's
// in-memory state and drop its Dexie liveQuery subscriptions (which are bound to the OLD database
// instance) — then re-runs the normal post-login load so fresh subscriptions bind to the new account's
// DB. Stores own their own reset, so this list can't drift out of sync from a central orchestrator.
//
// Setup stores run their setup exactly once, so each callback registers once. A store that was never
// instantiated holds no state, so it simply isn't registered — and there's nothing to reset.

type Resetter = () => void | Promise<void>;

const resetters = new Set<Resetter>();

export function onSessionReset(fn: Resetter): void {
  resetters.add(fn);
}

export async function runSessionReset(): Promise<void> {
  for (const fn of resetters) {
    try {
      await fn();
    } catch (e) {
      logger.warn("session reset callback failed", e);
    }
  }
}
