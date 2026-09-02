/**
 * Coming back from a sleeping tab.
 *
 * A backgrounded tab is not a paused app — the browser throttles its timers to a crawl and, under
 * memory pressure, freezes it outright: no timers, no socket, no way to notice any of it happened.
 * When the user returns, the app is holding an access token that expired hours ago, a realtime
 * connection that was closed without the close ever being delivered, and whatever the server has
 * since changed. None of that announces itself, so it is checked here, on the way back in.
 *
 * The desktop build has the equivalent for machine sleep in `useSleepWatcher`, which can afford to
 * simply reload the window. A tab cannot: reloading a page the user just switched back to would
 * throw away their scroll position and half-typed message for what is usually a one-second repair.
 */

import { onBeforeUnmount, onMounted } from "vue";
import { logger } from "@argon/core";
import { metrics, bucket } from "@/lib/telemetry/metrics";
import { hasSession, isExpired } from "@/lib/webAuth";
import { useAuthStore } from "@/store/auth/authStore";
import { useBus } from "@/store/realtime/busStore";

/** Below this, the tab was merely tabbed away from and nothing can have gone stale. */
const STALE_AFTER_MS = 30_000;

export function useTabLifecycle() {
  let hiddenAt = 0;
  let resuming = false;

  async function resume(sleptMs: number) {
    if (resuming) return;
    resuming = true;
    try {
      logger.info(`[tab] resumed after ${Math.round(sleptMs / 1000)}s asleep`);

      // The token first: the realtime connection asks the API for its ticket, so re-dialling with a
      // dead token would only produce a connection attempt that fails on authorization.
      //
      // Renewed only when it is actually spent. A tab can be away for a minute or for a week, and the
      // access token now outlives most of those naps — asking for a new one on every wake would be a
      // round trip bought for nothing, on the path the user is waiting behind.
      const auth = useAuthStore();
      const tokenExpired = isExpired(auth.token);

      // Minutes, hours, overnight, longer: which naps the app actually has to come back from.
      metrics.count("session.resume", {
        slept: bucket(sleptMs / 1000, [60, 600, 3600, 28800]),
        token_expired: tokenExpired,
      });
      metrics.distribution("session.resume.slept", sleptMs / 1000, "second");

      if (tokenExpired) {
        const token = await auth.refreshWebToken();

        if (!token && !hasSession()) {
          // The session is gone and cannot be renewed — there is nothing left to resume into.
          logger.warn("[tab] session expired while asleep, returning to sign-in");
          window.location.reload();
          return;
        }
      }

      // The worker works out whether it is actually still connected; a reconnect from here also
      // fires the bus's `reconnected`, which is what makes the rest of the app resync.
      useBus().wakeConnection();
    } finally {
      resuming = false;
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    if (!hiddenAt) return;
    const slept = Date.now() - hiddenAt;
    hiddenAt = 0;
    if (slept >= STALE_AFTER_MS) void resume(slept);
  }

  // `resume` fires when the browser un-freezes a tab it had discarded from memory. It can arrive
  // without a visibility change of its own, so it is handled separately rather than folded in.
  function onPageResume() {
    const slept = hiddenAt ? Date.now() - hiddenAt : STALE_AFTER_MS;
    hiddenAt = 0;
    void resume(slept);
  }

  function onFreeze() {
    hiddenAt = Date.now();
  }

  // Losing the network and getting it back leaves exactly the same debris as a freeze does, and on
  // a laptop that woke from suspend it is often the only signal that arrives at all.
  function onBackOnline() {
    void resume(STALE_AFTER_MS);
  }

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("resume", onPageResume);
    document.addEventListener("freeze", onFreeze);
    window.addEventListener("online", onBackOnline);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("resume", onPageResume);
    document.removeEventListener("freeze", onFreeze);
    window.removeEventListener("online", onBackOnline);
  });
}
