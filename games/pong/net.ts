/**
 * Pong networking over the PlayFrame SFU messaging API.
 *
 * Host-authoritative: the host simulates and broadcasts normalized state to all
 * (players + spectators); player 2 sends paddle input to the host. All traffic
 * rides the LiveKit data channel via the SDK (`send`/`broadcast`/`on('message')`).
 */

import type { PlayFrameClient } from "@argon/playframe-sdk";

/** Normalized snapshot (0..1) so each client renders at its own canvas size. */
export interface PongState {
  bx: number; // ball center x fraction
  by: number; // ball center y fraction
  p1: number; // left paddle top fraction (0..1 of free height)
  p2: number; // right paddle top fraction
  s1: number; // left score
  s2: number; // right score
}

type NetMsg =
  | { t: "join" }
  | { t: "spectate" }
  | { t: "req-join" }
  | { t: "approve-join" }
  | { t: "deny-join" }
  | { t: "start" }
  | { t: "state"; s: PongState }
  | { t: "input"; up: boolean; down: boolean }
  | { t: "over"; winner: 1 | 2 }
  | { t: "rematch" }
  | { t: "roster"; p1: string; p2: string };

export interface PongNetHooks {
  onJoin?: (from: string) => void;
  onSpectate?: (from: string) => void;
  onReqJoin?: (from: string) => void;
  onApprove?: (from: string) => void;
  onDeny?: (from: string) => void;
  onStart?: (from: string) => void;
  onState?: (from: string, s: PongState) => void;
  onInput?: (from: string, up: boolean, down: boolean) => void;
  onOver?: (from: string, winner: 1 | 2) => void;
  onRematch?: (from: string) => void;
  onRoster?: (from: string, p1: string, p2: string) => void;
}

export interface PongNet {
  /** player → host: announce join (reliable broadcast) */
  join(): void;
  /** spectator → host: announce watching (reliable broadcast) */
  spectate(): void;
  /** spectator → host: request to become a player (reliable broadcast) */
  reqJoin(): void;
  /** host → spectator: approved to play (reliable, directed) */
  approve(to: string): void;
  /** host → spectator: request denied, slot full (reliable, directed) */
  deny(to: string): void;
  /** host → all: match started (reliable) */
  start(): void;
  /** host → all: authoritative state (lossy broadcast) */
  state(s: PongState): void;
  /** player → host: paddle input (lossy, directed) */
  input(to: string, up: boolean, down: boolean): void;
  /** host → all: game over (reliable) */
  over(winner: 1 | 2): void;
  /** host → all: rematch (reliable) */
  rematch(): void;
  /** host → all: who is left (p1) / right (p2) by peer id (reliable) */
  roster(p1: string, p2: string): void;
}

export function createPongNet(client: PlayFrameClient, hooks: PongNetHooks): PongNet {
  client.on("message", ({ from, data }) => {
    const m = data as NetMsg;
    if (!m || typeof m.t !== "string") return;
    switch (m.t) {
      case "join":
        hooks.onJoin?.(from);
        break;
      case "spectate":
        hooks.onSpectate?.(from);
        break;
      case "req-join":
        hooks.onReqJoin?.(from);
        break;
      case "approve-join":
        hooks.onApprove?.(from);
        break;
      case "deny-join":
        hooks.onDeny?.(from);
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
      case "rematch":
        hooks.onRematch?.(from);
        break;
      case "roster":
        hooks.onRoster?.(from, m.p1, m.p2);
        break;
    }
  });

  return {
    join: () => client.broadcast({ t: "join" } satisfies NetMsg, { reliable: true }),
    spectate: () => client.broadcast({ t: "spectate" } satisfies NetMsg, { reliable: true }),
    reqJoin: () => client.broadcast({ t: "req-join" } satisfies NetMsg, { reliable: true }),
    approve: (to) => client.sendTo(to, { t: "approve-join" } satisfies NetMsg, { reliable: true }),
    deny: (to) => client.sendTo(to, { t: "deny-join" } satisfies NetMsg, { reliable: true }),
    start: () => client.broadcast({ t: "start" } satisfies NetMsg, { reliable: true }),
    state: (s) => client.broadcast({ t: "state", s } satisfies NetMsg, { reliable: false }),
    input: (to, up, down) =>
      client.sendTo(to, { t: "input", up, down } satisfies NetMsg, { reliable: false }),
    over: (winner) => client.broadcast({ t: "over", winner } satisfies NetMsg, { reliable: true }),
    rematch: () => client.broadcast({ t: "rematch" } satisfies NetMsg, { reliable: true }),
    roster: (p1, p2) => client.broadcast({ t: "roster", p1, p2 } satisfies NetMsg, { reliable: true }),
  };
}
