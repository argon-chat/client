/**
 * Sea Battle sound effects — synthesized via Web Audio (no asset files), so the
 * bundle stays tiny and runs inside the sandboxed iframe. Lazily created and
 * resumed on the first user gesture.
 */

export type SfxKind = "fire" | "miss" | "hit" | "sunk" | "place" | "click" | "win" | "lose" | "turn";

export interface Sfx {
  play(kind: SfxKind): void;
  unlock(): void;
  dispose(): void;
}

interface ToneSpec {
  type: OscillatorType;
  freq: number | [number, number];
  dur: number;
  gain?: number;
  at?: number;
}

const RECIPES: Record<SfxKind, ToneSpec[]> = {
  fire: [{ type: "sawtooth", freq: [700, 120], dur: 0.22, gain: 0.22 }],
  miss: [{ type: "sine", freq: [320, 160], dur: 0.18, gain: 0.18 }],
  hit: [
    { type: "square", freq: [180, 60], dur: 0.18, gain: 0.28, at: 0 },
    { type: "sawtooth", freq: [90, 40], dur: 0.22, gain: 0.2, at: 0.02 },
  ],
  sunk: [
    { type: "square", freq: [150, 50], dur: 0.3, gain: 0.3, at: 0 },
    { type: "triangle", freq: 196, dur: 0.16, gain: 0.22, at: 0.18 },
    { type: "triangle", freq: 147, dur: 0.26, gain: 0.22, at: 0.32 },
  ],
  place: [{ type: "square", freq: 520, dur: 0.05, gain: 0.16 }],
  click: [{ type: "sine", freq: 660, dur: 0.04, gain: 0.14 }],
  turn: [{ type: "sine", freq: 880, dur: 0.07, gain: 0.16 }],
  win: [
    { type: "triangle", freq: 523, dur: 0.12, gain: 0.25, at: 0 },
    { type: "triangle", freq: 659, dur: 0.12, gain: 0.25, at: 0.12 },
    { type: "triangle", freq: 784, dur: 0.22, gain: 0.25, at: 0.24 },
  ],
  lose: [
    { type: "triangle", freq: 392, dur: 0.16, gain: 0.22, at: 0 },
    { type: "triangle", freq: 294, dur: 0.26, gain: 0.22, at: 0.16 },
  ],
};

export function createSfx(): Sfx {
  const AC: typeof AudioContext | undefined =
    (window as any).AudioContext ?? (window as any).webkitAudioContext;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;

  function ensure(): AudioContext | null {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  function note(c: AudioContext, dst: AudioNode, spec: ToneSpec, t0: number): void {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = spec.type;
    const start = t0 + (spec.at ?? 0);
    const end = start + spec.dur;
    const peak = spec.gain ?? 0.2;
    if (Array.isArray(spec.freq)) {
      osc.frequency.setValueAtTime(spec.freq[0], start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freq[1]), end);
    } else {
      osc.frequency.setValueAtTime(spec.freq, start);
    }
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(dst);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  return {
    unlock(): void {
      const c = ensure();
      if (c && c.state === "suspended") void c.resume();
    },
    play(kind: SfxKind): void {
      const c = ensure();
      if (!c || !master) return;
      if (c.state === "suspended") void c.resume();
      const t0 = c.currentTime;
      for (const spec of RECIPES[kind]) note(c, master, spec, t0);
    },
    dispose(): void {
      void ctx?.close();
      ctx = null;
      master = null;
    },
  };
}
