/**
 * Short synthesized cues: recording a hotkey, and the walkie-talkie beeps of push-to-talk.
 *
 * Synthesized rather than sampled because they are tiny, must never wait on an asset, and are
 * played while the user is looking elsewhere (in a game), where a bit of timbre variation between
 * "on" and "off" matters more than fidelity. Every call is best-effort: a missing audio context
 * (no output device, autoplay blocked) is swallowed, since a cue is never worth an error.
 */

import { audio } from "@/lib/audio/AudioManager";

export type UiBeep = "capture-start" | "capture-ok" | "capture-fail" | "ptt-on" | "ptt-off";

interface BeepSpec {
  freq: number;
  durationSec: number;
  volume: number;
  slide: "up" | "down" | null;
}

const SPECS: Record<UiBeep, BeepSpec> = {
  "capture-start": { freq: 720, durationSec: 0.04, volume: 0.02, slide: null },
  "capture-ok": { freq: 1280, durationSec: 0.05, volume: 0.025, slide: "up" },
  "capture-fail": { freq: 260, durationSec: 0.07, volume: 0.03, slide: "down" },
  "ptt-on": { freq: 960, durationSec: 0.05, volume: 0.03, slide: "up" },
  "ptt-off": { freq: 620, durationSec: 0.08, volume: 0.03, slide: "down" },
};

export function playUiBeep(kind: UiBeep): void {
  try {
    const spec = SPECS[kind];
    const ctx = audio.getCurrentAudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc1.type = "sine";
    osc2.type = "sine";

    const slideAmount = 0.02;
    const slideTime = 0.02;
    const startFreq =
      spec.slide === "up" ? spec.freq * (1 - slideAmount)
      : spec.slide === "down" ? spec.freq * (1 + slideAmount)
      : spec.freq;

    osc1.frequency.setValueAtTime(startFreq, now);
    osc2.frequency.setValueAtTime(startFreq * 1.006, now);
    osc1.frequency.exponentialRampToValueAtTime(spec.freq, now + slideTime);
    osc2.frequency.exponentialRampToValueAtTime(spec.freq * 1.006, now + slideTime);
    osc2.detune.value = -3;

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(spec.freq, now);
    filter.Q.setValueAtTime(0.7, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.volume, now + 0.01);
    gain.gain.setValueAtTime(spec.volume * 0.9, now + spec.durationSec * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.durationSec);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(audio.getOutputDestination());

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + spec.durationSec + 0.03);
    osc2.stop(now + spec.durationSec + 0.03);
  } catch {
    // A cue that cannot play is not worth reporting.
  }
}
