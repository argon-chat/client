// Re-export from @argon/audio package
import { AudioManagement as BaseAudioManagement, type IAudioManagement, createDTMFPlayer } from "@argon/audio";
import { WebRTCProcessor } from "./WebRTCProcessor";

export type { IAudioManagement, DeviceId, WorkletPath, WorkletId, AudioManagerConfig, DTMFPlayer, RemoteAudioGraph, RemoteAudioGraphOptions } from "@argon/audio";

// Extended AudioManagement with app-specific features
class AppAudioManagement extends BaseAudioManagement {
  createRtcProcessor(): WebRTCProcessor {
    return new WebRTCProcessor(this);
  }
}

// App-specific audio instance with worklet path pointing to public/audio
const audio = new AppAudioManagement({
  workletBasePath: '/audio',
  sampleRate: 48000,
});

// App-specific DTMF player
export const dtmfPlayer = createDTMFPlayer(audio);
export const playDTMF = dtmfPlayer.playDTMF;
export const playBusyTone = dtmfPlayer.playBusyTone;

/**
 * Soft ringback tone — gentle ascending two-note chime that loops.
 * Played to the caller while waiting for the peer to pick up.
 */
export function createDialTone() {
  const ctx = audio.getCurrentAudioContext();
  const dest = audio.getOutputDestination();

  const masterGain = ctx.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(dest);

  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function playChime() {
    if (stopped) return;
    const now = ctx.currentTime;

    // Two soft sine tones: gentle ascending interval (C5 → E5)
    const freqs = [523.25, 659.25];
    const noteDuration = 0.18;
    const noteGap = 0.06;
    const attack = 0.015;
    const release = 0.06;

    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const noteGain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = freqs[i];

      const noteStart = now + i * (noteDuration + noteGap);

      noteGain.gain.setValueAtTime(0, noteStart);
      noteGain.gain.linearRampToValueAtTime(0.045, noteStart + attack);
      noteGain.gain.setValueAtTime(0.045, noteStart + noteDuration - release);
      noteGain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDuration);

      osc.connect(noteGain).connect(masterGain);
      osc.start(noteStart);
      osc.stop(noteStart + noteDuration + 0.01);
    }

    // Repeat every ~3 seconds
    const totalChimeDuration = freqs.length * (noteDuration + noteGap);
    timeoutId = setTimeout(playChime, (totalChimeDuration + 2.8) * 1000);
  }

  // Fade in master
  const now = ctx.currentTime;
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(1, now + 0.3);

  playChime();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      const t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.linearRampToValueAtTime(0, t + 0.15);
      setTimeout(() => masterGain.disconnect(), 300);
    },
  };
}

export { audio };
