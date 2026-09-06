import { defineStore } from "pinia";
import { useApi } from "@/store/system/apiStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { ref, watch } from "vue";
import { logger } from "@argon/core";
import { ActivityPresenceKind } from "@argon/glue";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { useGameOverlaySettings } from "@/store/features/gameOverlaySettingsStore";

type Presence = {
  kind: ActivityPresenceKind;
  titleName: string;
  /** Stable game id (normalized exe path), set by the main process for GAME/SOFTWARE. */
  gameId?: string;
} | null;

export interface IMusicEvent {
  title: string;
  author: string;
  isPlaying: boolean;
}

/**
 * How long a live activity may go without being re-asserted to the server.
 *
 * The activity key used to lapse on its own after ten minutes, which made a game vanish from the
 * roster while it was still running; the server now renews it for as long as the session lives.
 * That fix has a mirror image: nothing expires any more, so an activity the server was never told
 * to drop is shown for the rest of the session. The host repeats the current presence every 30 s,
 * so re-sending whenever the last send is older than this turns that repeat into a self-heal — a
 * broadcast lost to a bad minute comes back, and a client that stops repeating stops renewing.
 */
const REPUBLISH_AFTER_MS = 5 * 60_000;

/**
 * A removal is the one message with no repeat behind it: once the game is gone the host has
 * nothing left to say about it, so a dropped `RemoveBroadcastPresence` is what pins "Playing
 * Portal 2" to a user who quit hours ago. The first send gets a short burst of retries spaced by a
 * doubling delay — six seconds, which covers a request that raced a token refresh or an edge 502.
 *
 * Six seconds does not cover the failures the burst was written for, though: a wifi handover, a
 * laptop that slept, a server rolling through a deploy are all tens of seconds or minutes, and
 * making the burst that long would only turn a server that is properly down into a loop. So the
 * burst is not the whole answer — a removal that has not landed stays OWED and is re-attempted, one
 * attempt at a time, on the two clocks this store already runs on: the host's 30 s presence repeat
 * and the bus's `reconnected`. The same clocks the re-publication above uses, for the same reason.
 */
const REMOVAL_ATTEMPTS = 3;
const REMOVAL_RETRY_MS = 2_000;

export const useActivity = defineStore("activity", () => {
  const api = useApi();
  const lastPublishedPresence = ref<Presence>(null);
  // Last presence received from the main process, BEFORE per-game gating — kept so a
  // settings toggle can re-evaluate publication without waiting for the next change.
  const lastRawPresence = ref<Presence>(null);

  // The host IPC listener outlives any one sign-in, so it is bound once. `init()` runs again on
  // every retry of the boot sequence, on each account switch and after a full resync, and each of
  // those used to add another listener and another settings watcher: nothing was published twice
  // (the dedupe below is shared) but every host message was handled — and logged — N times over.
  let bound = false;

  // When the current presence last went on the wire; 0 means "never, or the last attempt failed",
  // which is what lets a repeat from the host tell "nothing has changed" apart from "nothing has
  // been said for a while".
  let lastPublishedAt = 0;
  // Bumped by every publication. A removal retry that finds it changed has been overtaken by a
  // newer presence and must stay quiet: a late removal would erase the activity that replaced it.
  let publishGeneration = 0;
  // A removal the server has never acknowledged — the activity is still up there as far as we know.
  // It survives the failed attempts rather than dying with the loop that made them, and is cleared
  // only by a `RemoveBroadcastPresence` that came back, or by a newer decision that makes it moot.
  let pendingRemoval = false;
  // One removal chain at a time. Both retry clocks fire while a chain may still be waiting on its
  // RPC, and a second chain entered there would double every attempt for the same one removal.
  let removalInFlight = false;

  // Seamless account switch: clear broadcast presence so the new account starts clean.
  onSessionReset(() => {
    lastPublishedPresence.value = null;
    lastRawPresence.value = null;
    lastPublishedAt = 0;
    // Nothing in flight for the old account may still write on behalf of the new one.
    publishGeneration++;
    // Whatever the old account still owed is not this account's to send: the API client and the
    // credentials behind it have been swapped, and the old session's activity went with them.
    pendingRemoval = false;
  });

  function isSamePresence(a: Presence, b: Presence): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.kind === b.kind && a.titleName === b.titleName;
  }

  /** Whether this presence is allowed to be broadcast (game-activity toggle, flag-gated). */
  function isAllowed(presence: Presence): boolean {
    if (!presence) return true;
    if (presence.kind !== ActivityPresenceKind.GAME && presence.kind !== ActivityPresenceKind.SOFTWARE) {
      return true; // music etc. — never gated by the games journal
    }
    const flags = useFeatureFlags();
    if (!flags.overlayGamesEnabled) return true; // feature off → behave as before
    const settings = useGameOverlaySettings();
    if (!settings.activityPublishEnabled) return false;
    const id = presence.gameId;
    if (!id) return true;
    const g = settings.games[id];
    return g ? g.activityPublish : true;
  }

  function applyPresence(): void {
    const effective = isAllowed(lastRawPresence.value) ? lastRawPresence.value : null;
    const isRepeat = isSamePresence(lastPublishedPresence.value, effective);
    if (isRepeat) {
      // A repeat of "no activity" is worth nothing on its own — there is no key to keep alive —
      // unless a removal is still owed, in which case this repeat is the clock that carries it:
      // the host has stopped talking about the closed game, so nothing else will ask again. A
      // repeat of a live activity is worth re-sending once it is older than the interval — see the
      // remark on REPUBLISH_AFTER_MS.
      if (!effective) {
        retryOwedRemoval();
        return;
      }
      if (Date.now() - lastPublishedAt < REPUBLISH_AFTER_MS) return;
    }

    lastPublishedPresence.value = effective;
    lastPublishedAt = Date.now();
    const generation = ++publishGeneration;

    if (!effective) {
      pendingRemoval = true;
      void removeBroadcast(generation, REMOVAL_ATTEMPTS);
      return;
    }
    // A broadcast supersedes an owed removal: whatever the server is still holding is about to be
    // overwritten by this one, and a removal landing after it would erase the new activity. A
    // broadcast that fails is covered by its own retry — the stamp below — not by this removal.
    pendingRemoval = false;
    void publishBroadcast(effective, generation);
  }

  async function publishBroadcast(presence: NonNullable<Presence>, generation: number): Promise<void> {
    try {
      await api.userInteraction.BroadcastPresence({
        kind: presence.kind,
        titleName: presence.titleName,
        startTimestampSeconds: 0n,
      });
    } catch (e) {
      // Put the stamp back to "never sent" so the host's next repeat re-sends within half a minute
      // instead of the dedupe sitting on it for the whole interval. A send that has already been
      // overtaken says nothing: the newer one owns the stamp.
      if (generation === publishGeneration) lastPublishedAt = 0;
      logger.warn("Broadcasting activity presence failed; re-sending on the next repeat", e);
    }
  }

  async function removeBroadcast(generation: number, attempts: number): Promise<void> {
    if (removalInFlight) return;
    removalInFlight = true;
    try {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        // Overtaken: the user started something else while this removal was being retried, and the
        // server is now holding the new activity. Firing here would delete it. Nothing owed either
        // means someone else's attempt landed while this one was waiting out its delay.
        if (generation !== publishGeneration || !pendingRemoval) return;
        try {
          await api.userInteraction.RemoveBroadcastPresence();
          pendingRemoval = false;
          return;
        } catch (e) {
          if (attempt === attempts) {
            // Still owed, and that is the point: the next host repeat or reconnect picks it up, so
            // an outage measured in minutes ends with the activity coming down rather than with it
            // pinned to the user for the rest of the session.
            logger.warn("Removing activity presence failed; owed until it lands", e);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, REMOVAL_RETRY_MS * 2 ** (attempt - 1)));
        }
      }
    } finally {
      removalInFlight = false;
    }
  }

  /**
   * One more attempt at a removal the server never acknowledged, from a clock that is ticking
   * anyway. Single-shot: the burst that already ran is what covers a blip, and these clocks are
   * half a minute apart — nothing here should turn into a loop of its own.
   */
  function retryOwedRemoval(): void {
    if (pendingRemoval) void removeBroadcast(publishGeneration, 1);
  }

  function onPresenceUpdate(presence: Presence) {
    lastRawPresence.value = presence;
    applyPresence();
  }

  function init() {
    if (!argon.isArgonHost || bound) return;
    bound = true;

    window.argonIpc?.onPresenceUpdate((data: any) => {
      const presence = data as Presence;
      // The host repeats the current presence every half minute, so that a window which reloaded
      // and lost its copy picks it back up. A repeat is not news — it is logged as debug and stops
      // at the dedupe in applyPresence — but it is also the clock the re-publication runs on, so
      // roughly one repeat in ten does reach the server.
      if (isSamePresence(lastRawPresence.value, presence)) logger.debug("onPresenceUpdate (repeat)", data);
      else logger.info("onPresenceUpdate", data);
      onPresenceUpdate(presence);
    });

    // Re-evaluate publication when the user toggles game-activity settings live.
    const settings = useGameOverlaySettings();
    const flags = useFeatureFlags();
    watch(
      () => [settings.activityPublishEnabled, settings.games, flags.overlayGamesEnabled],
      () => applyPresence(),
      { deep: true },
    );
  }

  function cleanup() {
    // No-op: IPC listener is cleaned up when window is destroyed
  }

  return {
    init,
    cleanup,
  };
});
