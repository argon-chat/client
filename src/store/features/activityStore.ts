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
 * Portal 2" to a user who quit hours ago. Retried a few times, spaced by a doubling delay, which
 * covers the failures that actually happen here (a token refresh in flight, a wifi blip, an edge
 * 502) without turning a server that is properly down into a loop.
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

  // Seamless account switch: clear broadcast presence so the new account starts clean.
  onSessionReset(() => {
    lastPublishedPresence.value = null;
    lastRawPresence.value = null;
    lastPublishedAt = 0;
    // Nothing in flight for the old account may still write on behalf of the new one.
    publishGeneration++;
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
    // A repeat of "no activity" is worth nothing: there is no key to keep alive, and a removal
    // that has not landed is retried by the sender rather than by the host's next repeat. A repeat
    // of a live activity is worth re-sending once it is older than the interval — see the remark
    // on REPUBLISH_AFTER_MS.
    if (isRepeat && (!effective || Date.now() - lastPublishedAt < REPUBLISH_AFTER_MS)) return;

    lastPublishedPresence.value = effective;
    lastPublishedAt = Date.now();
    const generation = ++publishGeneration;

    if (!effective) {
      void removeBroadcast(generation);
      return;
    }
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

  async function removeBroadcast(generation: number): Promise<void> {
    for (let attempt = 1; attempt <= REMOVAL_ATTEMPTS; attempt++) {
      // Overtaken: the user started something else while this removal was being retried, and the
      // server is now holding the new activity. Firing here would delete it.
      if (generation !== publishGeneration) return;
      try {
        await api.userInteraction.RemoveBroadcastPresence();
        return;
      } catch (e) {
        if (attempt === REMOVAL_ATTEMPTS) {
          logger.warn("Removing activity presence failed; others may still see the old activity", e);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, REMOVAL_RETRY_MS * 2 ** (attempt - 1)));
      }
    }
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
