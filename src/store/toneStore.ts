import { defineStore } from "pinia";
import { logger } from "@/lib/logger";

import * as Tone from "tone";

(window as any).Tone = Tone;

export const useTone = defineStore("tone", () => {
  function init() {
    const customAudioContext = new AudioContext({
      sampleRate: 48000,
      latencyHint: "playback",
    });
    Tone.setContext(customAudioContext);
    logger.info(`inited audio context '${customAudioContext.sampleRate}'Hz`);
  }

  function playCallSound() {
    const baseSynth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.3, decay: 0.6, sustain: 0.1, release: 1.5 },
    }).toDestination();

    const accentSynth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.2, decay: 0.5, sustain: 0.1, release: 1 },
    }).toDestination();

    const reverb = new Tone.Reverb(4).toDestination();
    baseSynth.connect(reverb);
    accentSynth.connect(reverb);

    const arpeggio = new Tone.Sequence(
      (time, note) => {
        accentSynth.triggerAttackRelease(note, "16n", time);
      },
      ["C5", "E5", "G5", "B5"],
      "4n"
    );

    const basePattern = new Tone.Part(
      (time) => {
        baseSynth.triggerAttackRelease("C4", "2n", time);
      },
      [[0, "C4"]]
    );

    arpeggio.start(0);
    basePattern.start(0);

    Tone.Transport.scheduleRepeat(() => {
      arpeggio.stop("+3.5");
      arpeggio.start("+4");
      basePattern.stop("+3.5");
      basePattern.start("+4");
    }, "4:0");

    Tone.Transport.start();
  }

  function playSoftEnterSound() {
    const reverb = new Tone.Reverb(2).toDestination();
    const synth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.03, decay: 0.3, sustain: 0.2, release: 0.7 },
    }).connect(reverb);

    synth.triggerAttackRelease("D5", "16n");
    setTimeout(() => {
      synth.triggerAttackRelease("G5", "16n");
    }, 120);
  }

  function playSoftLeaveSound() {
    const reverb = new Tone.Reverb(2).toDestination();
    const synth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.03, decay: 0.3, sustain: 0.1, release: 0.7 },
    }).connect(reverb);

    synth.triggerAttackRelease("D5", "16n");
    setTimeout(() => {
      synth.triggerAttackRelease("A4", "16n");
    }, 120);
  }

  function playMuteAllSound() {
    const reverb = new Tone.Reverb({
      decay: 1.5,
      wet: 0.2,
    }).toDestination();

    const synth = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.6 },
      portamento: 0.1,
    }).connect(reverb);

    const notes = ["C5", "A4", "F4", "D4", "G3"];
    let index = 0;

    const interval = setInterval(() => {
      synth.triggerAttackRelease(notes[index], "8n");
      index++;
      if (index >= notes.length) {
        clearInterval(interval);
      }
    }, 30);
  }

  function playUnmuteAllSound() {
    const reverb = new Tone.Reverb({
      decay: 1.5,
      wet: 0.2,
    }).toDestination();

    const synth = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.2, release: 0.6 },
      portamento: 0.1,
    }).connect(reverb);

    const notes = ["G3", "D4", "F4", "A4", "C5"];
    let index = 0;

    const interval = setInterval(() => {
      synth.triggerAttackRelease(notes[index], "8n");
      index++;
      if (index >= notes.length) {
        clearInterval(interval);
      }
    }, 30);
  }

  return { init, playSoftLeaveSound, playSoftEnterSound, playCallSound, playMuteAllSound, playUnmuteAllSound };
});
