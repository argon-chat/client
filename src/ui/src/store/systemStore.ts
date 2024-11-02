import { defineStore } from "pinia";
import { ref } from "vue";
import { playUnmuteAllSound, playMuteAllSound } from "@/lib/useTone";

export const useSystemStore = defineStore("system", () => {
  const microphoneMuted = ref(false);
  const headphoneMuted = ref(false);

  let lastMicMuted = false;

  async function toggleMicrophoneMute() {
    microphoneMuted.value = !microphoneMuted.value;
    if (!microphoneMuted.value && headphoneMuted.value)
      headphoneMuted.value = false;
    if (microphoneMuted.value) 
      playMuteAllSound(); 
    else 
      playUnmuteAllSound();
  }

  async function toggleHeadphoneMute() {
    if (!headphoneMuted.value) 
      lastMicMuted = microphoneMuted.value;

    headphoneMuted.value = !headphoneMuted.value;

    if (headphoneMuted.value)
      microphoneMuted.value = true;
    else if (!lastMicMuted)
      microphoneMuted.value = false;

    if (headphoneMuted.value)
      playMuteAllSound(); 
    else 
      playUnmuteAllSound();
  }

  return { microphoneMuted, headphoneMuted, toggleHeadphoneMute, toggleMicrophoneMute };
});