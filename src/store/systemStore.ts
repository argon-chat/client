import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useTone } from "@/store/toneStore";
import { Subject, Subscription } from "rxjs";
import { useHotkeys } from "./hotKeyStore";

export const useSystemStore = defineStore("system", () => {
  // voice
  const mainSub = new Subscription();
  let lastMicMuted = false;
  const microphoneMuted = ref(false);
  const headphoneMuted = ref(false);
  const tone = useTone();
  const hotkeys = useHotkeys();

  const muteEvent = new Subject<boolean>();

  // network

  const activeRetries = ref<Set<string>>(new Set());
  const preferUseWs = ref(false);
  function startRequestRetry(serviceName: string, methodName: string) {
    activeRetries.value.add(`${serviceName}.${methodName}`);
  }

  function hasRequestRetry(serviceName: string, methodName: string) {
    return activeRetries.value.has(`${serviceName}.${methodName}`);
  }

  function stopRequestRetry(serviceName: string, methodName: string) {
    activeRetries.value.delete(`${serviceName}.${methodName}`);
  }

  const isRequestRetrying = computed(() => activeRetries.value.size > 0);

  mainSub.add(hotkeys.onAction("key.microphone.toggle", () => {
    toggleMicrophoneMute();
  }));
  mainSub.add(hotkeys.onAction("key.microphone.on", () => {
    if (microphoneMuted.value)
      toggleMicrophoneMute();
  }));
  mainSub.add(hotkeys.onAction("key.microphone.off", () => {
    if (!microphoneMuted.value)
      toggleMicrophoneMute();
  }));


  // -----------------------

  preferUseWs.value = true; // TODO

  async function toggleMicrophoneMute() {
    microphoneMuted.value = !microphoneMuted.value;
    if (!microphoneMuted.value && headphoneMuted.value)
      headphoneMuted.value = false;
    if (microphoneMuted.value) tone.playMuteAllSound();
    else tone.playUnmuteAllSound();

    muteEvent.next(microphoneMuted.value);
  }

  async function toggleHeadphoneMute() {
    if (!headphoneMuted.value) lastMicMuted = microphoneMuted.value;

    headphoneMuted.value = !headphoneMuted.value;

    if (headphoneMuted.value) microphoneMuted.value = true;
    else if (!lastMicMuted) microphoneMuted.value = false;

    if (headphoneMuted.value) tone.playMuteAllSound();
    else tone.playUnmuteAllSound();
  }

  return {
    microphoneMuted,
    headphoneMuted,
    toggleHeadphoneMute,
    toggleMicrophoneMute,

    muteEvent,

    preferUseWs,
    activeRetries,


    isRequestRetrying,
    startRequestRetry,
    stopRequestRetry,
    hasRequestRetry
  };
});
