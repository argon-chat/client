/**
 * DTMF tone generation.
 *
 * DTMF is a standard: each key is a specific pair of frequencies, and a wrong pair is
 * not "slightly off pitch" — it dials a different digit. So the tests pin the actual
 * ITU-T Q.23 table rather than checking that some oscillator was created.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createDTMFPlayer } from "../src/DTMF";

// ── A recording Web Audio fake ──────────────────────────────────────

class Node {
  outputs: Node[] = [];
  constructor(public kind: string) {}
  connect(target: Node) { this.outputs.push(target); return target; }
  disconnect() { this.outputs = []; }
}

class Param {
  value = 0;
  events: { op: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ op: "set", value, time }); return this; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ op: "ramp", value, time }); return this; }
  cancelScheduledValues(time: number) { this.events.push({ op: "cancel", value: 0, time }); return this; }
}

class Oscillator extends Node {
  type = "";
  frequency = new Param();
  started: number | null = null;
  stopped: number | null = null;
  constructor() { super("osc"); }
  start(t?: number) { this.started = t ?? 0; }
  stop(t?: number) { this.stopped = t ?? 0; }
}

class Gain extends Node {
  gain = new Param();
  constructor() { super("gain"); }
}

class Panner extends Node {
  pan = new Param();
  constructor() { super("panner"); }
}

class Filter extends Node {
  type = "";
  frequency = new Param();
  Q = new Param();
  constructor() { super("filter"); }
}

function makeAudio() {
  const created = { oscillators: [] as Oscillator[], gains: [] as Gain[], panners: [] as Panner[], filters: [] as Filter[] };
  const destination = new Node("output-destination");

  const ctx = {
    currentTime: 0,
    createOscillator: () => { const o = new Oscillator(); created.oscillators.push(o); return o; },
    createGain: () => { const g = new Gain(); created.gains.push(g); return g; },
    createStereoPanner: () => { const p = new Panner(); created.panners.push(p); return p; },
    createBiquadFilter: () => { const f = new Filter(); created.filters.push(f); return f; },
  };

  return {
    created,
    destination,
    ctx,
    manager: {
      getCurrentAudioContext: () => ctx,
      getOutputDestination: () => destination,
    } as any,
  };
}

let audio: ReturnType<typeof makeAudio>;

beforeEach(() => {
  audio = makeAudio();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────

describe("playDTMF", () => {
  /** ITU-T Q.23: low frequency by row, high frequency by column. */
  const TABLE: Record<string, [number, number]> = {
    "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
    "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
    "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
    "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
  };

  test("every key emits its standard frequency pair", () => {
    for (const [key, [low, high]] of Object.entries(TABLE)) {
      const fresh = makeAudio();
      createDTMFPlayer(fresh.manager).playDTMF(key);

      const [oscLow, oscHigh] = fresh.created.oscillators;
      expect(oscLow.frequency.value, `low tone for "${key}"`).toBe(low);
      expect(oscHigh.frequency.value, `high tone for "${key}"`).toBe(high);
    }
  });

  test("rows and columns are shared exactly as the standard requires", () => {
    // Guards against a transposed table: 1/2/3 must share a row, 1/4/7 a column.
    const lowOf = (key: string) => {
      const fresh = makeAudio();
      createDTMFPlayer(fresh.manager).playDTMF(key);
      return fresh.created.oscillators[0].frequency.value;
    };
    const highOf = (key: string) => {
      const fresh = makeAudio();
      createDTMFPlayer(fresh.manager).playDTMF(key);
      return fresh.created.oscillators[1].frequency.value;
    };

    expect(new Set(["1", "2", "3"].map(lowOf)).size).toBe(1);
    expect(new Set(["1", "4", "7"].map(highOf)).size).toBe(1);
    expect(new Set(["1", "4", "7", "*"].map(lowOf)).size).toBe(4);
  });

  test("an unknown key is silently ignored, not played as something else", () => {
    createDTMFPlayer(audio.manager).playDTMF("A");
    createDTMFPlayer(audio.manager).playDTMF("");
    createDTMFPlayer(audio.manager).playDTMF("12");

    expect(audio.created.oscillators).toHaveLength(0);
  });

  test("both tones reach the shared output destination", () => {
    // Routing through getOutputDestination() is what makes the keypad respect the
    // master volume; connecting to ctx.destination would bypass it.
    createDTMFPlayer(audio.manager).playDTMF("5");

    const [oscLow, oscHigh] = audio.created.oscillators;
    const [panLow, panHigh] = audio.created.panners;
    const [gain] = audio.created.gains;
    const [filter] = audio.created.filters;

    expect(oscLow.outputs).toContain(panLow);
    expect(oscHigh.outputs).toContain(panHigh);
    expect(panLow.outputs).toContain(gain);
    expect(panHigh.outputs).toContain(gain);
    expect(gain.outputs).toContain(filter);
    expect(filter.outputs).toContain(audio.destination);
  });

  test("the two tones are panned apart, and symmetrically", () => {
    createDTMFPlayer(audio.manager).playDTMF("5");
    const [panLow, panHigh] = audio.created.panners;

    expect(panLow.pan.value).toBeLessThan(0);
    expect(panHigh.pan.value).toBeGreaterThan(0);
    expect(panLow.pan.value).toBe(-panHigh.pan.value);
  });

  test("is enveloped rather than switched on and off", () => {
    // A bare on/off gate on a sine wave clicks; the ramps are what avoid that.
    createDTMFPlayer(audio.manager).playDTMF("7");
    const [gain] = audio.created.gains;

    expect(gain.gain.events.map((e) => e.op)).toEqual(["set", "ramp", "set", "ramp"]);
    expect(gain.gain.events[0].value).toBe(0);
    expect(gain.gain.events.at(-1)!.value).toBe(0);
    expect(gain.gain.events[1].value).toBeGreaterThan(0);
  });

  test("both oscillators start together and stop after the same duration", () => {
    audio.ctx.currentTime = 10;
    createDTMFPlayer(audio.manager).playDTMF("9");

    const [oscLow, oscHigh] = audio.created.oscillators;
    expect(oscLow.started).toBe(10);
    expect(oscHigh.started).toBe(10);
    expect(oscLow.stopped).toBe(oscHigh.stopped);
    expect(oscLow.stopped!).toBeGreaterThan(10);
  });

  test("tones are scheduled from the context clock, so repeats do not overlap", () => {
    const player = createDTMFPlayer(audio.manager);

    player.playDTMF("1");
    audio.ctx.currentTime = 5;
    player.playDTMF("1");

    const [first, , third] = audio.created.oscillators;
    expect(first.started).toBe(0);
    expect(third.started).toBe(5);
  });

  test("is low-passed to take the edge off the harmonics", () => {
    createDTMFPlayer(audio.manager).playDTMF("3");
    const [filter] = audio.created.filters;

    expect(filter.type).toBe("lowpass");
    // Above the highest DTMF tone, or it would attenuate the signal itself.
    expect(filter.frequency.value).toBeGreaterThan(1477);
  });

  test("uses pure sine tones", () => {
    createDTMFPlayer(audio.manager).playDTMF("0");
    for (const osc of audio.created.oscillators) {
      expect(osc.type).toBe("sine");
    }
  });
});

describe("playBusyTone", () => {
  test("uses the standard busy pair and cycles the requested number of times", async () => {
    vi.useFakeTimers();
    const player = createDTMFPlayer(audio.manager);

    const done = player.playBusyTone(3);
    await vi.advanceTimersByTimeAsync(3 * 1000);
    await done;

    const [osc1, osc2] = audio.created.oscillators;
    expect(osc1.frequency.value).toBe(480);
    expect(osc2.frequency.value).toBe(620);

    // One cancel + three envelope events per cycle.
    const [gain] = audio.created.gains;
    expect(gain.gain.events.filter((e) => e.op === "cancel")).toHaveLength(3);
  });

  test("reuses one oscillator pair for the whole sequence", async () => {
    vi.useFakeTimers();
    const done = createDTMFPlayer(audio.manager).playBusyTone(4);
    await vi.advanceTimersByTimeAsync(4 * 1000);
    await done;

    expect(audio.created.oscillators).toHaveLength(2);
    expect(audio.created.gains).toHaveLength(1);
  });

  test("a zero-length request plays nothing but still resolves", async () => {
    await expect(createDTMFPlayer(audio.manager).playBusyTone(0)).resolves.toBeUndefined();
    const [gain] = audio.created.gains;
    expect(gain.gain.events.filter((e) => e.op === "cancel")).toHaveLength(0);
  });

  test("routes through the shared output destination", async () => {
    vi.useFakeTimers();
    const done = createDTMFPlayer(audio.manager).playBusyTone(1);
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    const [gain] = audio.created.gains;
    expect(gain.outputs).toContain(audio.destination);
  });
});
