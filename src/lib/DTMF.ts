import { audio } from "./audio/AudioManager";

const dtmfMap: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
};

export const playDTMF = (key: string) => {
  const freqs = dtmfMap[key];
  if (!freqs) return;

  const audioCtx = audio.getCurrentAudioContext();

  const duration = 0.12;

  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc1.frequency.value = freqs[0];
  osc2.frequency.value = freqs[1];

  gain.gain.value = 0.25;

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(audioCtx.destination);

  osc1.start();
  osc2.start();
  osc1.stop(audioCtx.currentTime + duration);
  osc2.stop(audioCtx.currentTime + duration);
};
