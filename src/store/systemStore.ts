import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useTone } from "@/store/toneStore";
import { Subject, Subscription } from "rxjs";
import { useHotkeys } from "./hotKeyStore";
import { IonWsClient } from "@argon-chat/ion.webcore";
import { HotkeyPhase } from "@/lib/glue/argon.ipc";

const LONG_RECONNECT_TIMEOUT = 5000; // 5 seconds

export const useSystemStore = defineStore("system", () => {
  // voice
  const mainSub = new Subscription();
  let lastMicMuted = false;
  const microphoneMuted = ref(false);
  const headphoneMuted = ref(false);
  const tone = useTone();
  const hotkeys = useHotkeys();

  // reconnection
  const isLongReconnecting = ref(false);
  let reconnectTimer: NodeJS.Timeout | null = null;

  const muteEvent = new Subject<boolean>();
  const muteHeadphoneEvent = new Subject<boolean>();
  const preferUseWs = ref(false);

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

  mainSub.add(
    hotkeys.onAction("key.microphone.toggle", (x) => {
      if (x.phase == HotkeyPhase.Started) setMicrophoneMuted(false);
      else if (x.phase == HotkeyPhase.Ended) setMicrophoneMuted(true);
    })
  );
  mainSub.add(
    hotkeys.onAction("key.microphone.on", () => {
      if (microphoneMuted.value) toggleMicrophoneMute();
    })
  );
  mainSub.add(
    hotkeys.onAction("key.microphone.off", () => {
      if (!microphoneMuted.value) toggleMicrophoneMute();
    })
  );

  preferUseWs.value = true; // TODO

  async function setMicrophoneMuted(muted: boolean) {
    if (microphoneMuted.value === muted) return;

    microphoneMuted.value = muted;

    if (!muted && headphoneMuted.value) headphoneMuted.value = false;

    if (muted) tone.playMuteAllSound();
    else tone.playUnmuteAllSound();

    muteEvent.next(microphoneMuted.value);
    muteHeadphoneEvent.next(headphoneMuted.value);
  }

  async function setHeadphoneMuted(muted: boolean) {
    if (headphoneMuted.value === muted) return;

    if (!headphoneMuted.value) lastMicMuted = microphoneMuted.value;

    headphoneMuted.value = muted;

    if (muted) microphoneMuted.value = true;
    else if (!lastMicMuted) microphoneMuted.value = false;

    if (muted) tone.playMuteAllSound();
    else tone.playUnmuteAllSound();

    muteHeadphoneEvent.next(headphoneMuted.value);
    muteEvent.next(microphoneMuted.value);
  }

  async function toggleMicrophoneMute() {
    await setMicrophoneMuted(!microphoneMuted.value);
  }

  async function toggleHeadphoneMute() {
    await setHeadphoneMuted(!headphoneMuted.value);
  }

  IonWsClient.on("reconnecting", (x, t) => {
    if (!hasRequestRetry("ws", "ws")) {
      startRequestRetry("ws", "ws");
    }

    // Start timer for long reconnect
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        isLongReconnecting.value = true;
      }, LONG_RECONNECT_TIMEOUT);
    }
  });

  IonWsClient.on("reconnected", async () => {
    // Clear timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (hasRequestRetry("ws", "ws")) {
      stopRequestRetry("ws", "ws");
    }

    // If it was a long reconnect, reload server data
    if (isLongReconnecting.value) {
      try {
        const { usePoolStore } = await import("./poolStore");
        const poolStore = usePoolStore();
        await poolStore.loadServerDetails();
      } catch (e) {
        console.error("Failed to reload server details after reconnect:", e);
      } finally {
        isLongReconnecting.value = false;
      }
    }
  });

  return {
    microphoneMuted,
    headphoneMuted,
    toggleHeadphoneMute,
    toggleMicrophoneMute,

    muteEvent,
    muteHeadphoneEvent,

    preferUseWs,
    activeRetries,

    isRequestRetrying,
    isLongReconnecting,
    startRequestRetry,
    stopRequestRetry,
    hasRequestRetry,
  };
});
