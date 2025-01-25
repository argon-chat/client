import { defineStore } from "pinia";
import { logger } from "@/lib/logger";

import * as Tone from "tone";

(window as any).Tone = Tone;

export const useTone = defineStore("tone", () => {
  const audioCtx: AudioContext = new AudioContext({
    sampleRate: 48000,
    latencyHint: "playback",
  });

  function init() {
    Tone.setContext(audioCtx);
    logger.info(`inited audio context '${audioCtx.sampleRate}'Hz`);
  }

  async function playSoftEnterSound() {
    if (audioCtx.state == "suspended")
      await Tone.start();
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


  async function playReconnectSound() {
    if (audioCtx.state == "suspended")
      await Tone.start();
    const reverb = new Tone.Reverb({
      decay: 2.5,
      wet: 0.4,
    }).toDestination();
  
    const synth = new Tone.Synth({
      oscillator: { type: "sine" }, 
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 0.8 }, // Плавный переход
    }).connect(reverb);
  
    synth.triggerAttackRelease("D4", "16n");
  
    setTimeout(() => {
      synth.triggerAttackRelease("C4" , "16n");
    }, 150);
  
    setTimeout(() => {
      synth.triggerAttackRelease("A4", "16n");
    }, 300);
  }

  async function playSoftLeaveSound() {
    if (audioCtx.state == "suspended")
      await Tone.start();
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

  async function playMuteAllSound() {
    if (audioCtx.state == "suspended")
      await Tone.start();
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

  async function playUnmuteAllSound() {
    if (audioCtx.state == "suspended")
      await Tone.start();
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


  return { init, playSoftLeaveSound, playSoftEnterSound, playReconnectSound, playMuteAllSound, playUnmuteAllSound };
});

(window as any)["toneStore"] = useTone;
