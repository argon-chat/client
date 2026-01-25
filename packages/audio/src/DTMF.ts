import type { IAudioManagement } from "./AudioManager";

/** DTMF frequency map: key -> [low freq, high freq] */
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

/**
 * Creates a DTMF player bound to an AudioManagement instance
 */
export function createDTMFPlayer(audio: IAudioManagement) {
  const playDTMF = (key: string) => {
    const freqs = dtmfMap[key];
    if (!freqs) return;

    const audioCtx = audio.getCurrentAudioContext();
    const now = audioCtx.currentTime;

    const duration = 0.12;
    const attack = 0.008;
    const release = 0.02;

    const oscLow = audioCtx.createOscillator();
    const oscHigh = audioCtx.createOscillator();

    const panLow = audioCtx.createStereoPanner();
    const panHigh = audioCtx.createStereoPanner();

    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    oscLow.type = "sine";
    oscHigh.type = "sine";

    oscLow.frequency.value = freqs[0];
    oscHigh.frequency.value = freqs[1];

    panLow.pan.value = -0.12;
    panHigh.pan.value = 0.12;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.075, now + attack);
    gain.gain.setValueAtTime(0.075, now + duration - release);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    filter.type = "lowpass";
    filter.frequency.value = 3000;
    filter.Q.value = 0.7;

    oscLow.connect(panLow).connect(gain);
    oscHigh.connect(panHigh).connect(gain);

    gain.connect(filter);
    filter.connect(audio.getOutputDestination());

    oscLow.start(now);
    oscHigh.start(now);
    oscLow.stop(now + duration);
    oscHigh.stop(now + duration);
  };

  const playBusyTone = async (len: number) => {
    const audioCtx = audio.getCurrentAudioContext();

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc1.type = "sine";
    osc2.type = "sine";

    osc1.frequency.value = 480;
    osc2.frequency.value = 620;

    gain.gain.value = 0;

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audio.getOutputDestination());

    osc1.start();
    osc2.start();

    const attack = 0.01;
    const release = 0.03;
    const onTime = 0.5;
    const offTime = 0.5;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    let i = len;
    while (i) {
      --i;
      const now = audioCtx.currentTime;

      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.08, now + attack);
      gain.gain.setValueAtTime(0.08, now + onTime - release);
      gain.gain.linearRampToValueAtTime(0, now + onTime);

      await sleep((onTime + offTime) * 1000);
    }
  };

  return {
    playDTMF,
    playBusyTone,
  };
}

export type DTMFPlayer = ReturnType<typeof createDTMFPlayer>;
