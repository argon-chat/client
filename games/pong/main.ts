/**
 * Pong — PlayFrame multiplayer reference game.
 *
 * Host-authoritative netcode over the SFU messaging API with:
 *  - an explicit lobby where the host configures the match (win mode, power-ups)
 *    and starts it,
 *  - host-configurable win modes (first-to 7/12/30, or "stack" tug-of-war),
 *  - random power-ups (multiball / speed / extra-life) that only count for the
 *    player whose paddle last touched the ball,
 *  - watching: anyone can connect and watch the live match without interrupting
 *    it, and claim an open slot seamlessly at the next point.
 *
 * "Watching" is a game concept only — the PlayFrame platform has no spectator
 * role. Runs standalone (host vs bot) when opened outside a PlayFrame host.
 */

import {
  PlayFrameClient,
  createFrameLoop,
  createInputManager,
  configureCanvas,
  isInPlayFrame,
} from "@argon/playframe-sdk";
import {
  createPongNet,
  DEFAULT_CONFIG,
  type PongNet,
  type PongState,
  type MatchConfig,
  type WinMode,
  type PowerKind,
  type Phase,
} from "./net";
import { createPaddleBuffer, createBallField } from "./interp";
import { createSfx, type Sfx } from "./sfx";

// --- constants ---
const PADDLE_W = 12;
const PADDLE_H = 90;
const BALL = 12;
const R = BALL / 2;
const WALL_X = 30; // paddle inset from each side
const PADDLE_SPEED = 560;
const AI_SPEED = 340;
const BALL_SPEED = 420;
const MAX_BALL_SPEED = 1150;
const SPEED_PUP_MULT = 1.25;
const MAX_BALLS = 50;
const POWERUP_MAX = 3; // concurrent on field
const POWERUP_EVERY = 7; // seconds between spawns
const POWERUP_R = 15;
const STACK_START = 10;
const COUNTDOWN_SECS = 3;
const STATE_HZ = 30;
const BOT = "@bot";

const WIN_MODES: WinMode[] = ["7", "12", "30", "stack"];
const POWER_KINDS: PowerKind[] = ["multi", "speed", "life"];

// --- dom ---
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const loading = document.getElementById("loading");

// --- roles / screens ---
type Role = "host" | "player" | "watcher";
type Screen = Phase | "connecting";
let role: Role = "host";
let screen: Screen = "lobby";
let cfg: MatchConfig = { ...DEFAULT_CONFIG };

let client: PlayFrameClient | null = null;
let net: PongNet | null = null;
let myId = "";
let hostId = ""; // non-host: authoritative host peer id
let leftId = ""; // host (left paddle) peer id
let rightId = ""; // right paddle: BOT, a player id, or "" (open)
const watchers = new Set<string>(); // host: connected non-playing peers
let pendingClaim = ""; // host: watcher waiting to take the right slot at next point
let winner: 1 | 2 = 1;

let w = 0;
let h = 0;

// --- host-authoritative sim (pixel space) ---
interface SimBall {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  o: 0 | 1 | 2;
}
interface SimPower {
  id: number;
  x: number;
  y: number;
  k: PowerKind;
}
const sim = {
  p1Y: 0,
  p2Y: 0,
  s1: 0,
  s2: 0,
  life1: 0,
  life2: 0,
  balls: [] as SimBall[],
  powerups: [] as SimPower[],
  phase: "normal" as "normal" | "stack",
};
const remoteInput = { up: false, down: false };
let ballSeq = 0;
let powerSeq = 0;
let powerupAccum = 0;
let serveDir = 1; // direction of the next serve when the field empties

// --- client render state ---
const paddleBuf = createPaddleBuffer();
const ballField = createBallField();
const cli = {
  s1: 0,
  s2: 0,
  l1: 0,
  l2: 0,
  pus: [] as { x: number; y: number; k: PowerKind }[],
  stack: false,
};
let predP2 = 0.5; // player: own-paddle prediction (0..1 of free travel)
let lastUp = false;
let lastDown = false;

let sfx: Sfx;
let input: ReturnType<typeof createInputManager>;
let stateAccum = 0;
const sfxCooldown: Record<string, number> = {};

// --- roster (names/avatars) ---
interface PlayerInfo {
  name: string;
  avatarId: string | null;
  img?: HTMLImageElement;
  requested?: boolean;
}
const players = new Map<string, PlayerInfo>();

async function refreshPlayers(): Promise<void> {
  if (!client) return;
  try {
    const { participants } = await client.getParticipants();
    for (const p of participants) {
      const prev = players.get(p.ephemeralId);
      players.set(p.ephemeralId, {
        name: p.displayName,
        avatarId: p.avatarId ?? null,
        img: prev?.img,
        requested: prev?.requested,
      });
      void loadAvatar(p.ephemeralId);
    }
  } catch {
    /* not connected yet */
  }
}

async function loadAvatar(id: string): Promise<void> {
  const info = players.get(id);
  if (!client || !info || !info.avatarId || info.img || info.requested) return;
  info.requested = true;
  const dataUrl = await client.getAvatar(info.avatarId);
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    const cur = players.get(id);
    if (cur) cur.img = img;
  };
  img.src = dataUrl;
}

// --- helpers ---
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
const clamp01 = (v: number) => clamp(v, 0, 1);
const freeH = () => h - PADDLE_H;
const winN = () => (cfg.win === "stack" ? 0 : Number(cfg.win));
const rightIsHuman = () => !!rightId && rightId !== BOT;

function resize(): void {
  const size = configureCanvas(
    canvas,
    { width: window.innerWidth, height: window.innerHeight },
    { pixelPerfect: true },
  );
  w = size.width;
  h = size.height;
  sim.p1Y = clamp(sim.p1Y, 0, freeH());
  sim.p2Y = clamp(sim.p2Y, 0, freeH());
}

// ===========================================================================
// Host simulation
// ===========================================================================

function makeBall(x: number, y: number, vx: number, vy: number, o: 0 | 1 | 2): SimBall {
  return { id: ++ballSeq, x, y, vx, vy, o };
}

function spawnServe(dir: number): void {
  sim.balls = [makeBall(w / 2, h / 2, BALL_SPEED * dir, (Math.random() - 0.5) * BALL_SPEED, 0)];
}

function resetMatch(): void {
  sim.phase = cfg.win === "stack" ? "stack" : "normal";
  sim.s1 = sim.s2 = cfg.win === "stack" ? STACK_START : 0;
  sim.life1 = sim.life2 = 0;
  sim.p1Y = sim.p2Y = h / 2 - PADDLE_H / 2;
  sim.powerups = [];
  powerupAccum = 0;
  remoteInput.up = remoteInput.down = false;
  serveDir = Math.random() > 0.5 ? 1 : -1;
  spawnServe(serveDir);
}

function aiTargetY(): number {
  let best: SimBall | null = null;
  let bestX = -Infinity;
  for (const b of sim.balls) {
    if (b.vx > 0 && b.x > bestX) {
      bestX = b.x;
      best = b;
    }
  }
  if (!best) best = sim.balls[0] ?? null;
  return best ? best.y - PADDLE_H / 2 : sim.p2Y;
}

function emitSfx(k: "hit" | "wall" | "score" | "power" | "life"): void {
  const now = performance.now();
  if (now - (sfxCooldown[k] ?? 0) < 60) return; // throttle (multiball spams collisions)
  sfxCooldown[k] = now;
  sfx.play(k);
  net?.sfx(k);
}

function bounce(b: SimBall, paddleY: number, dir: 1 | -1, nudgeX: number): void {
  const rel = (b.y - paddleY) / PADDLE_H - 0.5; // -0.5..0.5
  const speed = Math.min(Math.abs(b.vx) * 1.06, MAX_BALL_SPEED);
  b.vx = speed * dir;
  b.vy = rel * speed * 1.4;
  b.x = nudgeX;
  emitSfx("hit");
}

/** A ball owned by a player overlapped a power-up → apply its effect. */
function collectPower(b: SimBall, pu: SimPower, spawnQueue: SimBall[]): void {
  const side = b.o; // 1 or 2 (guaranteed by caller)
  if (pu.k === "life") {
    if (side === 1) sim.life1++;
    else sim.life2++;
    sfx.play("life");
    net?.sfx("life");
  } else if (pu.k === "speed") {
    for (const ball of sim.balls) {
      ball.vx = clamp(ball.vx * SPEED_PUP_MULT, -MAX_BALL_SPEED, MAX_BALL_SPEED);
      ball.vy = clamp(ball.vy * SPEED_PUP_MULT, -MAX_BALL_SPEED, MAX_BALL_SPEED);
    }
    emitSfx("power");
  } else {
    // multiball: each existing ball spawns 2 clones (×3), capped at MAX_BALLS
    const base = [...sim.balls];
    for (const ball of base) {
      for (let i = 0; i < 2; i++) {
        if (sim.balls.length + spawnQueue.length >= MAX_BALLS) break;
        const ang = (Math.random() - 0.5) * 0.9;
        const cos = Math.cos(ang);
        const sn = Math.sin(ang);
        spawnQueue.push(
          makeBall(ball.x, ball.y, ball.vx * cos - ball.vy * sn, ball.vx * sn + ball.vy * cos, ball.o),
        );
      }
    }
    sfx.play("multi");
    net?.sfx("power");
  }
}

function scorePoint(side: 1 | 2): void {
  if (sim.phase === "stack") {
    if (side === 1) {
      sim.s1++;
      sim.s2 = Math.max(0, sim.s2 - 1);
    } else {
      sim.s2++;
      sim.s1 = Math.max(0, sim.s1 - 1);
    }
    if (sim.s2 <= 0) return endMatch(1);
    if (sim.s1 <= 0) return endMatch(2);
  } else {
    if (side === 1) sim.s1++;
    else sim.s2++;
    const n = winN();
    if (sim.s1 >= n) return endMatch(1);
    if (sim.s2 >= n) return endMatch(2);
  }
  // serve toward the side that conceded
  serveDir = side === 1 ? 1 : -1;
  emitSfx("score");
}

function updateSim(dt: number): void {
  // left paddle = host keyboard
  if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) sim.p1Y -= PADDLE_SPEED * dt;
  if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) sim.p1Y += PADDLE_SPEED * dt;
  sim.p1Y = clamp(sim.p1Y, 0, freeH());

  // right paddle = AI (bot) or remote player input
  if (rightIsHuman()) {
    if (remoteInput.up) sim.p2Y -= PADDLE_SPEED * dt;
    if (remoteInput.down) sim.p2Y += PADDLE_SPEED * dt;
  } else {
    const target = aiTargetY();
    sim.p2Y += clamp(target - sim.p2Y, -AI_SPEED * dt, AI_SPEED * dt);
  }
  sim.p2Y = clamp(sim.p2Y, 0, freeH());

  const leftFace = WALL_X + PADDLE_W;
  const rightFace = w - WALL_X - PADDLE_W;
  const survivors: SimBall[] = [];
  const spawnQueue: SimBall[] = [];
  let pointScored = false;

  for (const b of sim.balls) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // walls
    if (b.y <= R) {
      b.y = R;
      b.vy = Math.abs(b.vy);
      emitSfx("wall");
    } else if (b.y >= h - R) {
      b.y = h - R;
      b.vy = -Math.abs(b.vy);
      emitSfx("wall");
    }

    // paddles
    if (b.vx < 0 && b.x - R <= leftFace && b.x >= WALL_X && b.y >= sim.p1Y - R && b.y <= sim.p1Y + PADDLE_H + R) {
      bounce(b, sim.p1Y, 1, leftFace + R);
      b.o = 1;
    } else if (
      b.vx > 0 && b.x + R >= rightFace && b.x <= w - WALL_X && b.y >= sim.p2Y - R && b.y <= sim.p2Y + PADDLE_H + R
    ) {
      bounce(b, sim.p2Y, -1, rightFace - R);
      b.o = 2;
    }

    // power-ups (only the ball's owning player collects)
    if (b.o !== 0 && sim.powerups.length) {
      for (let i = sim.powerups.length - 1; i >= 0; i--) {
        const pu = sim.powerups[i];
        const dx = b.x - pu.x;
        const dy = b.y - pu.y;
        if (dx * dx + dy * dy <= (R + POWERUP_R) * (R + POWERUP_R)) {
          sim.powerups.splice(i, 1);
          collectPower(b, pu, spawnQueue);
        }
      }
    }

    // scoring (with extra-life shield)
    if (b.x < -BALL) {
      if (sim.life1 > 0) {
        sim.life1--;
        b.x = R + 1;
        b.vx = Math.abs(b.vx);
        b.o = 0;
        survivors.push(b);
      } else {
        scorePoint(2);
        pointScored = true;
      }
    } else if (b.x > w + BALL) {
      if (sim.life2 > 0) {
        sim.life2--;
        b.x = w - R - 1;
        b.vx = -Math.abs(b.vx);
        b.o = 0;
        survivors.push(b);
      } else {
        scorePoint(1);
        pointScored = true;
      }
    } else {
      survivors.push(b);
    }
  }

  sim.balls = survivors.concat(spawnQueue).slice(0, MAX_BALLS);
  if (screen !== "playing") return; // endMatch may have fired mid-loop

  if (sim.balls.length === 0) spawnServe(serveDir);

  // a watcher claimed the slot → swap them in seamlessly at the point boundary
  if (pointScored && pendingClaim) applyClaim();

  // power-up spawns
  if (cfg.powerups && sim.balls.length > 0) {
    powerupAccum += dt;
    if (powerupAccum >= POWERUP_EVERY && sim.powerups.length < POWERUP_MAX) {
      powerupAccum = 0;
      sim.powerups.push({
        id: ++powerSeq,
        x: w * (0.3 + Math.random() * 0.4),
        y: h * (0.2 + Math.random() * 0.6),
        k: POWER_KINDS[(Math.random() * POWER_KINDS.length) | 0],
      });
    }
  }
}

function normalized(): PongState {
  return {
    balls: sim.balls.map((b) => ({ id: b.id, x: b.x / w, y: b.y / h, vx: b.vx / w, vy: b.vy / h, o: b.o })),
    p1: sim.p1Y / freeH(),
    p2: sim.p2Y / freeH(),
    s1: sim.s1,
    s2: sim.s2,
    l1: sim.life1,
    l2: sim.life2,
    pus: sim.powerups.map((p) => ({ id: p.id, x: p.x / w, y: p.y / h, k: p.k })),
    ph: sim.phase === "stack" ? 1 : 0,
  };
}

// ===========================================================================
// Host: lobby / roster / session presence
// ===========================================================================

function broadcastLobby(): void {
  if (role !== "host") return;
  net?.lobby(cfg, leftId, rightId, screen as Phase);
}

function reportSession(): void {
  if (!client || role !== "host") return;
  const state =
    screen === "lobby" ? "waiting" : screen === "gameover" ? "gameover" : "playing";
  const players2 = [leftId, rightIsHuman() ? rightId : ""].filter(Boolean);
  client.updateSession({
    state,
    mode: rightIsHuman() ? "multiplayer" : "solo",
    joinable: true, // anyone can always connect to watch / sit in the lobby
    playerCount: players2.length,
    maxPlayers: 2,
    players: players2,
  });
}

function enterLobby(): void {
  screen = "lobby";
  sim.powerups = [];
  broadcastLobby();
  reportSession();
}

function startMatch(): void {
  if (!rightIsHuman()) rightId = BOT; // solo vs bot if nobody claimed the slot
  resetMatch();
  beginCountdown();
}

function beginCountdown(): void {
  countdown = COUNTDOWN_SECS;
  countdownAccum = 0;
  predP2 = 0.5;
  screen = "countdown";
  if (role === "host") {
    net?.countdown(countdown);
    sfx.play("count");
    broadcastLobby();
    reportSession();
  }
}

function endMatch(side: 1 | 2): void {
  winner = side;
  screen = "gameover";
  net?.over(side);
  sfx.play(side === 1 ? "win" : "lose"); // host is player 1
  broadcastLobby();
  reportSession();
}

function rematch(): void {
  resetMatch();
  beginCountdown();
}

/** Seamlessly move the pending watcher into the right slot (no restart). */
function applyClaim(): void {
  if (!pendingClaim) return;
  rightId = pendingClaim;
  watchers.delete(pendingClaim);
  pendingClaim = "";
  remoteInput.up = remoteInput.down = false;
  void refreshPlayers();
  broadcastLobby();
  reportSession();
}

// countdown state (shared host + client)
let countdown = 0;
let countdownAccum = 0;

// ===========================================================================
// Host: take over after the authoritative host disappears
// ===========================================================================

function backToLobbyAsHost(): void {
  role = "host";
  hostId = "";
  leftId = myId;
  rightId = "";
  watchers.clear();
  pendingClaim = "";
  ballField.clear();
  paddleBuf.clear();
  enterLobby();
}

// ===========================================================================
// Rendering
// ===========================================================================

interface RenderView {
  p1Y: number;
  p2Y: number;
  balls: { x: number; y: number }[]; // pixel centers
  powerups: { x: number; y: number; k: PowerKind }[];
  s1: number;
  s2: number;
  l1: number;
  l2: number;
  stack: boolean;
}

function hostView(): RenderView {
  return {
    p1Y: sim.p1Y,
    p2Y: sim.p2Y,
    balls: sim.balls.map((b) => ({ x: b.x, y: b.y })),
    powerups: sim.powerups.map((p) => ({ x: p.x, y: p.y, k: p.k })),
    s1: sim.s1,
    s2: sim.s2,
    l1: sim.life1,
    l2: sim.life2,
    stack: sim.phase === "stack",
  };
}

function clientView(now: number, dt: number): RenderView {
  const fh = freeH();
  const pad = paddleBuf.sample(now);
  const p1 = pad?.p1 ?? 0.5;
  const p2 = role === "player" ? predP2 : pad?.p2 ?? 0.5;
  const rb = ballField.step(now, dt);
  return {
    p1Y: p1 * fh,
    p2Y: p2 * fh,
    balls: rb.map((b) => ({ x: b.x * w, y: b.y * h })),
    powerups: cli.pus.map((p) => ({ x: p.x * w, y: p.y * h, k: p.k })),
    s1: cli.s1,
    s2: cli.s2,
    l1: cli.l1,
    l2: cli.l2,
    stack: cli.stack,
  };
}

const POWER_COLOR: Record<PowerKind, string> = { multi: "#22d3ee", speed: "#f59e0b", life: "#4ade80" };
const POWER_LETTER: Record<PowerKind, string> = { multi: "M", speed: "S", life: "+" };

function drawField(v: RenderView): void {
  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#2a2a33";
  ctx.setLineDash([10, 14]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // power-ups
  for (const p of v.powerups) {
    ctx.fillStyle = POWER_COLOR[p.k];
    ctx.beginPath();
    ctx.arc(p.x, p.y, POWERUP_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0b0f";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(POWER_LETTER[p.k], p.x, p.y + 1);
    ctx.textBaseline = "alphabetic";
  }

  // paddles
  ctx.fillStyle = "#4ade80";
  ctx.fillRect(WALL_X, v.p1Y, PADDLE_W, PADDLE_H);
  ctx.fillStyle = "#f87171";
  ctx.fillRect(w - WALL_X - PADDLE_W, v.p2Y, PADDLE_W, PADDLE_H);

  // balls
  ctx.fillStyle = "#fafafa";
  for (const b of v.balls) ctx.fillRect(b.x - R, b.y - R, BALL, BALL);

  // scores
  ctx.fillStyle = "#fafafa";
  ctx.font = "48px monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(v.s1), w / 4, 64);
  ctx.fillText(String(v.s2), (w * 3) / 4, 64);

  // extra-life pips
  drawLives(w / 4, v.l1);
  drawLives((w * 3) / 4, v.l2);

  if (v.stack) {
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("STACK", w / 2, 28);
  }

  drawPlayerTag(w / 4, leftId, "Player 1");
  drawPlayerTag((w * 3) / 4, rightId === BOT || !rightId ? "" : rightId, rightId === BOT ? "CPU" : "Open");
}

function drawLives(cx: number, n: number): void {
  if (n <= 0) return;
  ctx.fillStyle = "#4ade80";
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("+".repeat(Math.min(n, 5)), cx, 86);
}

function drawPlayerTag(cx: number, id: string, fallback: string): void {
  const entry = id ? players.get(id) : undefined;
  const name = entry?.name ?? fallback;
  const r = 14;
  const cy = 116;

  if (entry?.img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(entry.img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((name || "?").charAt(0).toUpperCase(), cx, cy + 1);
    ctx.textBaseline = "alphabetic";
  }

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name, cx, cy + r + 16);
}

function overlay(title: string, lines: string[]): void {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fafafa";
  ctx.textAlign = "center";
  ctx.font = "bold 32px system-ui, sans-serif";
  ctx.fillText(title, w / 2, h / 2 - 40);
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillStyle = "#a1a1aa";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + i * 26));
}

function winLabel(): string {
  return cfg.win === "stack" ? "Stack (tug from 10)" : `First to ${cfg.win}`;
}

function drawLobby(): void {
  drawField(emptyView());
  const hostLines = [
    `Win: ${winLabel()}    Power-ups: ${cfg.powerups ? "ON" : "OFF"}`,
    rightIsHuman() ? `Opponent: ${players.get(rightId)?.name ?? "Player 2"}` : "Opponent: CPU (solo)",
    "",
    "1/2/3/4 — win 7 / 12 / 30 / stack    P — power-ups",
    "Enter — start match",
  ];
  const watcherLines = [
    `Win: ${winLabel()}    Power-ups: ${cfg.powerups ? "ON" : "OFF"}`,
    rightIsHuman() ? "Both slots taken — you're watching" : "Right slot open",
    "",
    !rightIsHuman() ? "J — take the right slot" : "Waiting for the host…",
  ];
  overlay("PONG — Lobby", role === "host" ? hostLines : watcherLines);
}

function emptyView(): RenderView {
  const fh = freeH();
  return {
    p1Y: fh / 2,
    p2Y: fh / 2,
    balls: [],
    powerups: [],
    s1: cfg.win === "stack" ? STACK_START : 0,
    s2: cfg.win === "stack" ? STACK_START : 0,
    l1: 0,
    l2: 0,
    stack: cfg.win === "stack",
  };
}

function drawCountdown(): void {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fafafa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 120px system-ui, sans-serif";
  ctx.fillText(countdown > 0 ? String(countdown) : "GO!", w / 2, h / 2);
  ctx.textBaseline = "alphabetic";
}

function render(now: number, dt: number): void {
  if (screen === "lobby") {
    drawLobby();
    return;
  }
  if (screen === "connecting") {
    drawField(emptyView());
    overlay("Connecting…", []);
    return;
  }

  const v = role === "host" ? hostView() : clientView(now, dt);
  drawField(v);

  if (screen === "countdown") {
    drawCountdown();
    return;
  }

  // footer hint
  if (role === "watcher") {
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(rightIsHuman() ? "Watching" : "Watching — press J to play", w / 2, h - 20);
  } else {
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("W / S  or  ↑ / ↓ to move", w / 2, h - 20);
  }

  if (screen === "gameover") {
    const youWon = (role === "host" && winner === 1) || (role === "player" && winner === 2);
    overlay(role === "watcher" ? `Player ${winner} wins` : youWon ? "You win!" : "You lose", [
      role === "host" ? "Space — rematch    Esc — lobby" : "Waiting for host…",
    ]);
  }
}

// ===========================================================================
// Input (menus / lobby / claim)
// ===========================================================================

function cycleWin(mode: WinMode): void {
  if (role !== "host") return;
  cfg = { ...cfg, win: mode };
  broadcastLobby();
  reportSession();
}

function onKeydown(e: KeyboardEvent): void {
  sfx?.unlock();

  if (screen === "lobby") {
    if (role === "host") {
      if (e.key === "1") cycleWin("7");
      else if (e.key === "2") cycleWin("12");
      else if (e.key === "3") cycleWin("30");
      else if (e.key === "4") cycleWin("stack");
      else if (e.key.toLowerCase() === "p") {
        cfg = { ...cfg, powerups: !cfg.powerups };
        broadcastLobby();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        startMatch();
      }
    } else if (e.key.toLowerCase() === "j" && !rightIsHuman()) {
      net?.claim();
    }
    return;
  }

  // watchers can request the open slot mid-match (seamless at next point)
  if (role === "watcher" && e.key.toLowerCase() === "j" && !rightIsHuman()) {
    net?.claim();
    return;
  }

  if (screen === "gameover" && role === "host") {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      rematch();
    } else if (e.key === "Escape") {
      enterLobby();
    }
  }
}

/** Player only: integrate my paddle locally from input for zero-lag response. */
function updatePrediction(dt: number): void {
  const fracSpeed = PADDLE_SPEED / Math.max(1, freeH());
  if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) predP2 -= fracSpeed * dt;
  if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) predP2 += fracSpeed * dt;
  predP2 = clamp01(predP2);
}

/** Player only: send paddle input to the host only when it changes (reliable). */
function sendInput(): void {
  const up = input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp");
  const down = input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown");
  if (up === lastUp && down === lastDown) return;
  lastUp = up;
  lastDown = down;
  if (net && hostId) net.input(hostId, up, down);
}

// ===========================================================================
// Boot
// ===========================================================================

function startGame(): void {
  if (loading) loading.style.display = "none";
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeydown);

  sfx = createSfx();
  const unlock = () => sfx.unlock();
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("pointerdown", unlock, { once: true });

  input = createInputManager({ preventDefaults: true });
  input.start();

  const loop = createFrameLoop(
    (dt) => {
      const now = performance.now();
      if (role === "host" && screen === "countdown") {
        countdownAccum += dt;
        while (countdownAccum >= 1 && countdown > 0) {
          countdownAccum -= 1;
          countdown -= 1;
          if (countdown > 0) {
            net?.countdown(countdown);
            sfx.play("count");
          }
        }
        if (countdown <= 0) {
          screen = "playing";
          sfx.play("go");
          net?.start();
          broadcastLobby();
          reportSession();
        }
      } else if (role === "host" && screen === "playing") {
        updateSim(dt);
        stateAccum += dt;
        if (net && stateAccum >= 1 / STATE_HZ) {
          stateAccum = 0;
          if (rightIsHuman() || watchers.size > 0) net.state(normalized());
        }
      } else if (role === "player" && screen === "playing") {
        updatePrediction(dt);
        sendInput();
      }
      render(now, dt);
    },
    { targetFps: 60, pauseOnHidden: true },
  );
  loop.start();

  if (isInPlayFrame()) {
    void connectToHost(loop);
  } else {
    role = "host";
    leftId = myId;
    screen = "lobby";
  }
}

async function connectToHost(loop: ReturnType<typeof createFrameLoop>): Promise<void> {
  const c = new PlayFrameClient({
    game: { id: "pong", version: "1.0.0", title: "Pong" },
    permissions: ["keyboard", "audio", "networking"],
    layout: { mode: "responsive" },
  });
  client = c;

  c.on("terminate", () => {
    loop.stop();
    input.stop();
    sfx.dispose();
  });

  c.on("peerLeft", ({ peerId }) => {
    if (role === "host") {
      if (peerId === rightId) {
        // the human opponent left → fall back to the bot, keep playing
        rightId = BOT;
        remoteInput.up = remoteInput.down = false;
        broadcastLobby();
        reportSession();
      }
      watchers.delete(peerId);
      if (peerId === pendingClaim) pendingClaim = "";
    } else if (peerId === hostId) {
      backToLobbyAsHost();
    }
  });

  net = createPongNet(c, {
    // ---- host side ----
    onHello: (from) => {
      if (role !== "host" || from === myId) return;
      watchers.add(from);
      void refreshPlayers();
      broadcastLobby(); // bring the newcomer's lobby/roster up to date — no restart
    },
    onClaim: (from) => {
      if (role !== "host" || rightIsHuman()) return;
      if (screen === "lobby") {
        rightId = from;
        watchers.delete(from);
        void refreshPlayers();
        broadcastLobby();
        reportSession();
      } else {
        pendingClaim = from; // seamless swap at the next point (see updateSim)
      }
    },
    onInput: (from, up, down) => {
      if (role === "host" && from === rightId) {
        remoteInput.up = up;
        remoteInput.down = down;
      }
    },
    // ---- client side ----
    onLobby: (from, cfg2, left, right, phase) => {
      if (role === "host") return;
      hostId = hostId || from;
      cfg = cfg2;
      leftId = left;
      rightId = right;
      const wasPlayer = role === "player";
      role = right === myId ? "player" : "watcher";
      if (role === "player" && !wasPlayer) {
        predP2 = 0.5;
        lastUp = lastDown = false;
        client?.notifyRole("player");
      }
      // mirror the host's phase (unless we're mid-countdown locally)
      if (phase === "lobby") screen = "lobby";
      else if (phase === "gameover") screen = "gameover";
      else if (screen === "connecting" || screen === "lobby") screen = phase;
      void refreshPlayers();
    },
    onCountdown: (_from, secs) => {
      if (role === "host") return;
      countdown = secs;
      predP2 = 0.5;
      if (screen !== "countdown") {
        ballField.clear();
        paddleBuf.clear();
        screen = "countdown";
      }
      sfx.play("count");
    },
    onStart: (from) => {
      hostId = hostId || from;
      if (role !== "host") {
        predP2 = 0.5;
        screen = "playing";
        sfx.play("go");
      }
    },
    onState: (from, s) => {
      hostId = hostId || from;
      if (role === "host") return;
      cli.s1 = s.s1;
      cli.s2 = s.s2;
      cli.l1 = s.l1;
      cli.l2 = s.l2;
      cli.pus = s.pus.map((p) => ({ x: p.x, y: p.y, k: p.k }));
      cli.stack = s.ph === 1;
      paddleBuf.push(s.p1, s.p2);
      ballField.update(s.balls);
      if (screen === "connecting" || screen === "lobby") screen = "playing"; // a match is live → watch it
    },
    onOver: (_from, won) => {
      if (role === "host") return;
      winner = won;
      screen = "gameover";
      if (role === "player") sfx.play(won === 2 ? "win" : "lose");
      else sfx.play("win");
    },
    onSfx: (_from, k) => sfx.play(k),
  });

  try {
    const ctx0 = await c.connect();
    myId = ctx0.user?.ephemeralId ?? "";
    const launch = c.getLaunch();
    const intent = launch?.intent ?? "new";

    await refreshPlayers();

    if (intent === "new") {
      role = "host";
      leftId = myId;
      rightId = "";
      screen = "lobby";
      broadcastLobby();
      reportSession();
    } else {
      // Connect as a watcher; the host's lobby/state decides what we see and the
      // game lets us claim an open slot. Never interrupts the running match.
      role = "watcher";
      screen = "connecting";
      net.hello();
    }
    c.log("info", `Pong connected as ${role}`);
  } catch (e) {
    console.warn("[pong] connect failed, running standalone:", e);
    role = "host";
    leftId = myId;
    screen = "lobby";
  }
}

startGame();
