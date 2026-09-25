import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useTone } from "@/store/media/toneStore";
import { Subject } from "rxjs";
import { useBus } from "@/store/realtime/busStore";

const LONG_RECONNECT_TIMEOUT = 5000;
const RESYNC_JITTER_MS = 15000;

export const useSystemStore = defineStore("system", () => {
  // voice
  let lastMicMuted = false;
  const microphoneMuted = ref(false);
  const headphoneMuted = ref(false);
  const tone = useTone();

  // reconnection
  const isLongReconnecting = ref(false);
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const muteEvent = new Subject<boolean>();
  const muteHeadphoneEvent = new Subject<boolean>();

  // network

  const activeRetries = ref<Map<string, number>>(new Map());
  function startRequestRetry(serviceName: string, methodName: string) {
    const key = `${serviceName}.${methodName}`;
    if (!activeRetries.value.has(key)) {
      activeRetries.value.set(key, Date.now());
    }
  }

  function hasRequestRetry(serviceName: string, methodName: string) {
    return activeRetries.value.has(`${serviceName}.${methodName}`);
  }

  function stopRequestRetry(
    serviceName: string,
    methodName: string
  ): number | null {
    const key = `${serviceName}.${methodName}`;
    const startTime = activeRetries.value.get(key);
    activeRetries.value.delete(key);

    if (startTime != null) {
      const durationMs = Date.now() - startTime;
      return Math.round(durationMs / 1000);
    }

    return null;
  }

  const isRequestRetrying = computed(() => activeRetries.value.size > 0);

  /** Options for the mute setters. */
  interface MuteOptions {
    /** Skip the mute/unmute tones: push-to-talk flips the microphone on every key press. */
    silent?: boolean;
  }

  // A moderator's mute/deafen in the space we are talking in (set by the call manager). While it
  // holds, unmuting is refused — through the buttons, hotkeys, push-to-talk and the taskbar alike.
  const serverMuted = ref(false);
  const serverDeafened = ref(false);
  const microphoneLocked = computed(() => serverMuted.value || serverDeafened.value);
  const headphonesLocked = computed(() => serverDeafened.value);

  async function setMicrophoneMuted(muted: boolean, opts?: MuteOptions) {
    if (microphoneMuted.value === muted) return;
    if (!muted && microphoneLocked.value) return;

    microphoneMuted.value = muted;

    if (!muted && headphoneMuted.value) headphoneMuted.value = false;

    if (!opts?.silent) {
      if (muted) tone.playMuteAllSound();
      else tone.playUnmuteAllSound();
    }

    muteEvent.next(microphoneMuted.value);
    muteHeadphoneEvent.next(headphoneMuted.value);
  }

  async function setHeadphoneMuted(muted: boolean, opts?: MuteOptions) {
    if (headphoneMuted.value === muted) return;
    if (!muted && headphonesLocked.value) return;

    if (!headphoneMuted.value) lastMicMuted = microphoneMuted.value;

    headphoneMuted.value = muted;

    if (muted) microphoneMuted.value = true;
    else if (!lastMicMuted && !microphoneLocked.value) microphoneMuted.value = false;

    if (!opts?.silent) {
      if (muted) tone.playMuteAllSound();
      else tone.playUnmuteAllSound();
    }

    muteHeadphoneEvent.next(headphoneMuted.value);
    muteEvent.next(microphoneMuted.value);
  }

  /**
   * Set by the call manager. A new restriction mutes locally too, silently (the manager raises a
   * toast instead); lifting one leaves the user muted, so nobody's microphone opens because a
   * moderator changed a flag.
   */
  function setServerVoiceRestriction(restriction: { muted: boolean; deafened: boolean }) {
    serverMuted.value = restriction.muted;
    serverDeafened.value = restriction.deafened;
    if (restriction.deafened && !headphoneMuted.value) void setHeadphoneMuted(true, { silent: true });
    else if (restriction.muted && !microphoneMuted.value) void setMicrophoneMuted(true, { silent: true });
  }

  async function toggleMicrophoneMute() {
    await setMicrophoneMuted(!microphoneMuted.value);
  }

  async function toggleHeadphoneMute() {
    await setHeadphoneMuted(!headphoneMuted.value);
  }

  const bus = useBus();
  
  watch(() => bus.isReconnecting, (isReconnecting) => {
    if (isReconnecting) {
      if (!hasRequestRetry("realtime", "connection")) {
        startRequestRetry("realtime", "connection");
      }
      
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          isLongReconnecting.value = true;
        }, LONG_RECONNECT_TIMEOUT);
      }
    } else {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (hasRequestRetry("realtime", "connection")) {
        stopRequestRetry("realtime", "connection");
      }
    }
  });

  // The stream came back on the same server-side session: nothing to reload, however long it took.
  bus.resumed.subscribe(() => {
    isLongReconnecting.value = false;
  });

  bus.reconnected.subscribe(() => {
    void (async () => {
      const wasLong = isLongReconnecting.value;
      isLongReconnecting.value = false;
      try {
        if (wasLong) {
          await new Promise((r) => setTimeout(r, Math.random() * RESYNC_JITTER_MS));

          const { usePoolStore } = await import("../");
          await usePoolStore().loadServerDetails();

          const { useNotificationStore } = await import("../data/notificationStore");
          await useNotificationStore().initFromGlobalBadges();
        } else {
          const { useUnifiedCall } = await import("../media/unifiedCallStore");
          await useUnifiedCall().reconcileVoiceMembersFromLiveKit();
        }
      } catch (e) {
        console.error("Failed to recover state after reconnect:", e);
      }
    })();
  });

  bus.needFullResync.subscribe(() => {
    void (async () => {
      isLongReconnecting.value = false;
      try {
        await new Promise((r) => setTimeout(r, Math.random() * RESYNC_JITTER_MS));

        const { usePoolStore } = await import("../");
        await usePoolStore().loadServerDetails();

        const { useNotificationStore } = await import("../data/notificationStore");
        await useNotificationStore().initFromGlobalBadges();
      } catch (e) {
        console.error("Failed full resync after reconnect:", e);
      }
    })();
  });

  return {
    microphoneMuted,
    headphoneMuted,
    toggleHeadphoneMute,
    toggleMicrophoneMute,
    setMicrophoneMuted,
    setHeadphoneMuted,

    serverMuted,
    serverDeafened,
    microphoneLocked,
    headphonesLocked,
    setServerVoiceRestriction,

    muteEvent,
    muteHeadphoneEvent,

    activeRetries,

    isRequestRetrying,
    isLongReconnecting,
    startRequestRetry,
    stopRequestRetry,
    hasRequestRetry,
  };
});
