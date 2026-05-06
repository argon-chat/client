import { defineStore } from "pinia";
import { useApi } from "@/store/system/apiStore";
import { ref } from "vue";
import { logger } from "@argon/core";
import { ActivityPresenceKind } from "@argon/glue";

type Presence = {
  kind: ActivityPresenceKind;
  titleName: string;
} | null;

export interface IMusicEvent {
  title: string;
  author: string;
  isPlaying: boolean;
}

export const useActivity = defineStore("activity", () => {
  const api = useApi();
  const lastPublishedPresence = ref<Presence>(null);

  function isSamePresence(a: Presence, b: Presence): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.kind === b.kind && a.titleName === b.titleName;
  }

  function onPresenceUpdate(presence: Presence) {
    const prev = lastPublishedPresence.value;

    if (isSamePresence(prev, presence)) {
      return;
    }

    lastPublishedPresence.value = presence;

    if (!presence) {
      api.userInteraction.RemoveBroadcastPresence();
      return;
    }

    api.userInteraction.BroadcastPresence({
      kind: presence.kind,
      titleName: presence.titleName,
      startTimestampSeconds: 0n,
    });
  }

  function init() {
    if (!argon.isArgonHost) return;

    window.argonIpc?.onPresenceUpdate((data: any) => {
      logger.info("onPresenceUpdate", data);
      onPresenceUpdate(data as Presence);
    });
  }

  function cleanup() {
    // No-op: IPC listener is cleaned up when window is destroyed
  }

  return {
    init,
    cleanup,
  };
});
