/**
 * Pong networking over the PlayFrame SFU messaging API.
 *
 * Host-authoritative: the host simulates everything (paddles, every ball,
 * power-ups, scoring) and broadcasts normalized snapshots to all connected
 * peers. The right-paddle player sends input to the host. Watchers just render
 * snapshots — "watching" is purely a game concept, the platform has no
 * spectator role. A small lobby/roster control plane rides the same channel.
 */

import type { PlayFrameClient } from "@argon/playframe-sdk";

// ---------------------------------------------------------------------------
// Match configuration (host-owned, broadcast for display)
// ---------------------------------------------------------------------------

/** Win condition: first-to-N, or "stack" tug-of-war (both start 10, drive foe to 0). */
export type WinMode = "7" | "12" | "30" | "stack";

export interface MatchConfig {
  win: WinMode;
  /** Whether random power-ups spawn. */
  powerups: boolean;
}

export const DEFAULT_CONFIG: MatchConfig = { win: "7", powerups: true };

// ---------------------------------------------------------------------------
// Normalized world snapshot (0..1) so every client renders at its own size
// ---------------------------------------------------------------------------

export type PowerKind = "multi" | "speed" | "life";

export interface NetBall {
  id: number;
  x: number; // center x fraction
  y: number; // center y fraction
  vx: number; // velocity x in fractions/sec (for client dead-reckoning)
  vy: number; // velocity y in fractions/sec
  o: 0 | 1 | 2; // last paddle to touch: 0 none, 1 left, 2 right
}

export interface NetPower {
  id: number;
  x: number;
  y: number;
  k: PowerKind;
}

export interface PongState {
  balls: NetBall[];
  p1: number; // left paddle top fraction (0..1 of free height)
  p2: number; // right paddle top fraction
  s1: number; // left score
  s2: number; // right score
  l1: number; // left shield/extra-life charges
  l2: number; // right shield/extra-life charges
  pus: NetPower[]; // active power-ups
  ph: 0 | 1; // 0 = normal scoring, 1 = stack/tug phase
}

/** Networked sound cues the host emits so every client plays them in sync. */
export type SfxKind = "hit" | "wall" | "score" | "power" | "life";

/** High-level lifecycle of the host's instance, mirrored to clients. */
export type Phase = "lobby" | "countdown" | "playing" | "gameover";

// ---------------------------------------------------------------------------
// Wire messages
// ---------------------------------------------------------------------------

type NetMsg =
  // control plane
  | { t: "hello" } // joiner → host: I connected (add me as a watcher)
  | { t: "lobby"; cfg: MatchConfig; left: string; right: string; phase: Phase } // host → all: roster/config/phase
  | { t: "claim" } // watcher → host: give me the open right slot
  // gameplay
  | { t: "countdown"; secs: number }
  | { t: "start" }
  | { t: "state"; s: PongState }
  | { t: "input"; up: boolean; down: boolean }
  | { t: "over"; winner: 1 | 2 }
  | { t: "sfx"; k: SfxKind };

export interface PongNetHooks {
  onHello?: (from: string) => void;
  onLobby?: (from: string, cfg: MatchConfig, left: string, right: string, phase: Phase) => void;
  onClaim?: (from: string) => void;
  onCountdown?: (from: string, secs: number) => void;
  onStart?: (from: string) => void;
  onState?: (from: string, s: PongState) => void;
  onInput?: (from: string, up: boolean, down: boolean) => void;
  onOver?: (from: string, winner: 1 | 2) => void;
  onSfx?: (from: string, k: SfxKind) => void;
}

export interface PongNet {
  /** joiner → host: announce I connected (reliable broadcast) */
  hello(): void;
  /** host → all: roster + config + phase snapshot (reliable broadcast) */
  lobby(cfg: MatchConfig, left: string, right: string, phase: Phase): void;
  /** watcher → host: request the open right slot (reliable broadcast) */
  claim(): void;
  /** host → all: pre-match countdown tick, `secs` remaining (reliable) */
  countdown(secs: number): void;
  /** host → all: match started (reliable) */
  start(): void;
  /** host → all: authoritative world snapshot (lossy broadcast) */
  state(s: PongState): void;
  /** player → host: paddle input, edge-triggered (reliable, directed) */
  input(to: string, up: boolean, down: boolean): void;
  /** host → all: game over (reliable) */
  over(winner: 1 | 2): void;
  /** host → all: play a synced sound cue (lossy broadcast) */
  sfx(k: SfxKind): void;
}

export function createPongNet(client: PlayFrameClient, hooks: PongNetHooks): PongNet {
  client.on("message", ({ from, data }) => {
    const m = data as NetMsg;
    if (!m || typeof m.t !== "string") return;
    switch (m.t) {
      case "hello":
        hooks.onHello?.(from);
        break;
      case "lobby":
        hooks.onLobby?.(from, m.cfg, m.left, m.right, m.phase);
        break;
      case "claim":
        hooks.onClaim?.(from);
        break;
      case "countdown":
        hooks.onCountdown?.(from, m.secs);
        break;
      case "start":
        hooks.onStart?.(from);
        break;
      case "state":
        hooks.onState?.(from, m.s);
        break;
      case "input":
        hooks.onInput?.(from, m.up, m.down);
        break;
      case "over":
        hooks.onOver?.(from, m.winner);
        break;
      case "sfx":
        hooks.onSfx?.(from, m.k);
        break;
    }
  });

  return {
    hello: () => client.broadcast({ t: "hello" } satisfies NetMsg, { reliable: true }),
    lobby: (cfg, left, right, phase) =>
      client.broadcast({ t: "lobby", cfg, left, right, phase } satisfies NetMsg, { reliable: true }),
    claim: () => client.broadcast({ t: "claim" } satisfies NetMsg, { reliable: true }),
    countdown: (secs) => client.broadcast({ t: "countdown", secs } satisfies NetMsg, { reliable: true }),
    start: () => client.broadcast({ t: "start" } satisfies NetMsg, { reliable: true }),
    state: (s) => client.broadcast({ t: "state", s } satisfies NetMsg, { reliable: false }),
    // Edge-triggered (sent only on change) → reliable so the host never misses
    // a key release and keeps moving the paddle (a past jitter source).
    input: (to, up, down) =>
      client.sendTo(to, { t: "input", up, down } satisfies NetMsg, { reliable: true }),
    over: (winner) => client.broadcast({ t: "over", winner } satisfies NetMsg, { reliable: true }),
    sfx: (k) => client.broadcast({ t: "sfx", k } satisfies NetMsg, { reliable: false }),
  };
}
