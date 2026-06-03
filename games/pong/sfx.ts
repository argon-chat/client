/**
 * Pong sound effects via the Web Audio API.
 *
 * No asset files — every cue is synthesized from oscillators + a short gain
 * envelope, so the bundle stays tiny and works inside the sandboxed iframe.
 * The AudioContext is created lazily and resumed on the first user gesture
 * (browsers block audio until then).
 */

export type SfxKind = "hit" | "wall" | "score" | "win" | "lose" | "count" | "go";

export interface Sfx {
  /** Play a cue (no-op until audio is unlocked by a gesture). */
  play(kind: SfxKind): void;
  /** Resume the AudioContext; call from a user-gesture handler. */
  unlock(): void;
  dispose(): void;
}

interface ToneSpec {
  type: OscillatorType;
  /** Frequency over the note: single value, or [from, to] for a glide. */
  freq: number | [number, number];
  /** Note length in seconds. */
  dur: number;
  /** Peak gain (0..1). */
  gain?: number;
  /** Delay before the note starts (for arpeggios). */
  at?: number;
}

// Each cue is one or more notes.
const RECIPES: Record<SfxKind, ToneSpec[]> = {
  // crisp paddle hit
  hit: [{ type: "square", freq: 440, dur: 0.06, gain: 0.25 }],
  // duller wall bounce
  wall: [{ type: "sine", freq: 240, dur: 0.05, gain: 0.2 }],
  // descending blip when a point is scored
  score: [{ type: "sawtooth", freq: [520, 180], dur: 0.22, gain: 0.22 }],
  // rising major arpeggio on win
  win: [
    { type: "triangle", freq: 523, dur: 0.12, gain: 0.25, at: 0 },
    { type: "triangle", freq: 659, dur: 0.12, gain: 0.25, at: 0.12 },
    { type: "triangle", freq: 784, dur: 0.2, gain: 0.25, at: 0.24 },
  ],
  // falling minor on loss
  lose: [
    { type: "triangle", freq: 392, dur: 0.14, gain: 0.22, at: 0 },
    { type: "triangle", freq: 311, dur: 0.22, gain: 0.22, at: 0.14 },
  ],
  // countdown tick (3, 2, 1)
  count: [{ type: "sine", freq: 660, dur: 0.08, gain: 0.2 }],
  // higher "GO!" tone
  go: [{ type: "sine", freq: 990, dur: 0.18, gain: 0.25 }],
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

    // Fast attack, exponential decay — avoids clicks.
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
