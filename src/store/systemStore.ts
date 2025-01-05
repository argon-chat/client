import { defineStore } from "pinia";
import { ref } from "vue";
import { useTone } from "@/store/toneStore";
import { Subject } from "rxjs";

export const useSystemStore = defineStore("system", () => {
  const microphoneMuted = ref(false);
  const headphoneMuted = ref(false);
  const tone = useTone();
  let lastMicMuted = false;

  const muteEvent = new Subject<boolean>();

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

    muteEvent
  };
});
