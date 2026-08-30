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

  // Seamless account switch: clear broadcast presence so the new account starts clean.
  onSessionReset(() => {
    lastPublishedPresence.value = null;
    lastRawPresence.value = null;
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
    if (isSamePresence(lastPublishedPresence.value, effective)) return;

    lastPublishedPresence.value = effective;

    if (!effective) {
      api.userInteraction.RemoveBroadcastPresence();
      return;
    }
    api.userInteraction.BroadcastPresence({
      kind: effective.kind,
      titleName: effective.titleName,
      startTimestampSeconds: 0n,
    });
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
      // and lost its copy picks it back up. A repeat is not news: it is logged as debug and stops
      // at the dedupe in applyPresence, never reaching the server.
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
