/**
 * Sea Battle networking over the PlayFrame SFU messaging API.
 *
 * Turn-based, split-authority + host-run economy: each player secretly holds their
 * own board and resolves shots fired at it; the host (player 1) is the public-state
 * aggregator, turn authority AND the bank — it tracks both players' credits, charges
 * every action, and broadcasts a `state` snapshot of everything public (board size,
 * fleet, both boards' grids, credits, whose turn, phase). Ship layouts and un-sprung
 * mines never travel the wire until revealed.
 *
 * Actions are generic so all the purchasable moves reuse one path: the active player
 * names a kind + a target cell, the host expands it to the affected cells and the
 * board owner resolves them. `repair`/`mine` act on the actor's OWN board.
 */

import type { PlayFrameClient } from "@argon/playframe-sdk";

export type Phase = "lobby" | "placement" | "battle" | "gameover";

/** A turn action.
 *  shot — single cell (free) · airstrike — 3×3 strike · radar — 5×5 scan
 *  repair — un-hit one of your own cells · mine — drop a mine on your own water. */
export type Kind = "shot" | "airstrike" | "radar" | "repair" | "mine";

/** Public, broadcastable state. Cell digits: 0 water,1 miss,2 hit,3 sunk,4 detected,5 mine. */
export interface PubState {
  phase: Phase;
  n: number; // board size (n×n)
  fleet: number[]; // ship lengths
  turn: 1 | 2;
  p1Name: string;
  p2Id: string; // "" open, "@bot" cpu, else opponent peer id
  p2Name: string;
  g1: string;
  g2: string;
  sunk1: number[];
  sunk2: number[];
  res1: number; // credits
  res2: number;
  winner: 0 | 1 | 2;
}

/** Per-cell resolution of an action against a board owner. */
export interface Resolved {
  board: 1 | 2;
  kind: Kind;
  hit: number[];
  miss: number[];
  sunk: number[][];
  detect: number[];
  mine: number[]; // cells where the shot sprang a mine
}

type Msg =
  | { t: "hello" }
  | { t: "claim" }
  | { t: "ready" }
  | { t: "fire"; kind: Kind; x: number; y: number }
  | { t: "resolve"; kind: Kind; cells: number[] }
  | { t: "resolved"; r: Resolved }
  | { t: "state"; s: PubState }
  | { t: "over"; winner: 1 | 2 };

export interface NetHooks {
  onHello?: (from: string) => void;
  onClaim?: (from: string) => void;
  onReady?: (from: string) => void;
  onFire?: (from: string, kind: Kind, x: number, y: number) => void;
  onResolve?: (from: string, kind: Kind, cells: number[]) => void;
  onResolved?: (from: string, r: Resolved) => void;
  onState?: (from: string, s: PubState) => void;
  onOver?: (from: string, winner: 1 | 2) => void;
}

export interface Net {
  hello(): void;
  claim(): void;
  ready(): void;
  fire(to: string, kind: Kind, x: number, y: number): void;
  resolve(to: string, kind: Kind, cells: number[]): void;
  resolved(to: string, r: Resolved): void;
  state(s: PubState): void;
  over(winner: 1 | 2): void;
}

export function createNet(client: PlayFrameClient, hooks: NetHooks): Net {
  client.on("message", ({ from, data }) => {
    const m = data as Msg;
    if (!m || typeof m.t !== "string") return;
    switch (m.t) {
      case "hello": hooks.onHello?.(from); break;
      case "claim": hooks.onClaim?.(from); break;
      case "ready": hooks.onReady?.(from); break;
      case "fire": hooks.onFire?.(from, m.kind, m.x, m.y); break;
      case "resolve": hooks.onResolve?.(from, m.kind, m.cells); break;
      case "resolved": hooks.onResolved?.(from, m.r); break;
      case "state": hooks.onState?.(from, m.s); break;
      case "over": hooks.onOver?.(from, m.winner); break;
    }
  });

  return {
    hello: () => client.broadcast({ t: "hello" } satisfies Msg, { reliable: true }),
    claim: () => client.broadcast({ t: "claim" } satisfies Msg, { reliable: true }),
    ready: () => client.broadcast({ t: "ready" } satisfies Msg, { reliable: true }),
    fire: (to, kind, x, y) => client.sendTo(to, { t: "fire", kind, x, y } satisfies Msg, { reliable: true }),
    resolve: (to, kind, cells) => client.sendTo(to, { t: "resolve", kind, cells } satisfies Msg, { reliable: true }),
    resolved: (to, r) => client.sendTo(to, { t: "resolved", r } satisfies Msg, { reliable: true }),
    state: (s) => client.broadcast({ t: "state", s } satisfies Msg, { reliable: true }),
    over: (winner) => client.broadcast({ t: "over", winner } satisfies Msg, { reliable: true }),
  };
}
