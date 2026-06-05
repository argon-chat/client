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
const PADDLE_H_MIN = 52; // shrink floor
const PADDLE_H_MAX = 150; // grow ceiling
const BALL = 12;
const R = BALL / 2;
const WALL_X = 30; // paddle inset from each side
const PADDLE_SPEED = 560;
const AI_SPEED = 340;
const BALL_SPEED = 420;
const MIN_BALL_SPEED = 300;
const MAX_BALL_SPEED = 1150;
const SPEED_PUP_MULT = 1.25;
const SLOW_PUP_MULT = 0.7;
const SIZE_PUP_SECS = 9; // grow/shrink duration
const MAX_BALLS = 50;
const POWERUP_MAX = 3; // concurrent on field
const POWERUP_EVERY = 6; // seconds between spawns
const POWERUP_R = 16;
const POWERUP_DRIFT = 0.06; // fraction-of-field per second for drifting power-ups
const STACK_START = 10;
const COUNTDOWN_SECS = 3;
const STATE_HZ = 30;
const BOT = "@bot";

const WIN_MODES: WinMode[] = ["7", "12", "30", "stack"];
const POWER_KINDS: PowerKind[] = ["multi", "speed", "slow", "life", "grow", "shrink"];

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
  vx: number; // px/sec drift (0 for static power-ups)
  vy: number;
  k: PowerKind;
}
const sim = {
  p1Y: 0,
  p2Y: 0,
  s1: 0,
  s2: 0,
  life1: 0,
  life2: 0,
  h1: PADDLE_H, // current left paddle height (grow/shrink)
  h2: PADDLE_H, // current right paddle height
  hUntil1: 0, // sim-clock time the size effect on each side expires
  hUntil2: 0,
  clock: 0, // seconds elapsed in the current match (drives size-effect expiry)
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
  ph1: 0, // left paddle height fraction (0 → default PADDLE_H)
  ph2: 0, // right paddle height fraction
  pus: [] as { id: number; x: number; y: number; k: PowerKind }[],
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
  sim.p1Y = clamp(sim.p1Y, 0, h - sim.h1);
  sim.p2Y = clamp(sim.p2Y, 0, h - sim.h2);
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
  sim.h1 = sim.h2 = PADDLE_H;
  sim.hUntil1 = sim.hUntil2 = 0;
  sim.clock = 0;
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
  return best ? best.y - sim.h2 / 2 : sim.p2Y;
}

function emitSfx(k: "hit" | "wall" | "score" | "power" | "life"): void {
  const now = performance.now();
  if (now - (sfxCooldown[k] ?? 0) < 60) return; // throttle (multiball spams collisions)
  sfxCooldown[k] = now;
  sfx.play(k);
  net?.sfx(k);
}

function bounce(b: SimBall, paddleY: number, paddleH: number, dir: 1 | -1, nudgeX: number): void {
  const rel = (b.y - paddleY) / paddleH - 0.5; // -0.5..0.5
  const speed = Math.min(Math.abs(b.vx) * 1.06, MAX_BALL_SPEED);
  b.vx = speed * dir;
  b.vy = rel * speed * 1.4;
  b.x = nudgeX;
  emitSfx("hit");
}

/** Resize a paddle, keeping it centred; `secs > 0` makes the effect temporary. */
function setPaddleH(side: 1 | 2, targetH: number, secs: number): void {
  if (side === 1) {
    const c = sim.p1Y + sim.h1 / 2;
    sim.h1 = targetH;
    sim.hUntil1 = secs > 0 ? sim.clock + secs : 0;
    sim.p1Y = clamp(c - sim.h1 / 2, 0, h - sim.h1);
  } else {
    const c = sim.p2Y + sim.h2 / 2;
    sim.h2 = targetH;
    sim.hUntil2 = secs > 0 ? sim.clock + secs : 0;
    sim.p2Y = clamp(c - sim.h2 / 2, 0, h - sim.h2);
  }
}

/** Scale every ball's speed (keeping direction), clamped to the speed band. */
function scaleBallSpeeds(mult: number): void {
  for (const ball of sim.balls) {
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp < 1) continue;
    const target = clamp(sp * mult, MIN_BALL_SPEED, MAX_BALL_SPEED);
    const f = target / sp;
    ball.vx *= f;
    ball.vy *= f;
  }
}

/** A ball owned by a player overlapped a power-up → apply its effect. */
function collectPower(b: SimBall, pu: SimPower, spawnQueue: SimBall[]): void {
  const side = b.o; // 1 or 2 (guaranteed by caller)
  switch (pu.k) {
    case "life":
      if (side === 1) sim.life1++;
      else sim.life2++;
      sfx.play("life");
      net?.sfx("life");
      break;

    case "speed":
      scaleBallSpeeds(SPEED_PUP_MULT);
      emitSfx("power");
      break;

    case "slow":
      scaleBallSpeeds(SLOW_PUP_MULT);
      emitSfx("power");
      break;

    case "grow":
      setPaddleH(side, PADDLE_H_MAX, SIZE_PUP_SECS); // bigger own paddle
      sfx.play("life");
      net?.sfx("life");
      break;

    case "shrink":
      setPaddleH(side === 1 ? 2 : 1, PADDLE_H_MIN, SIZE_PUP_SECS); // smaller opponent
      sfx.play("power");
      net?.sfx("power");
      break;

    case "multi": {
      // each existing ball spawns 2 clones (×3), capped at MAX_BALLS
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
      break;
    }
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
  // expire temporary grow/shrink effects
  sim.clock += dt;
  if (sim.hUntil1 && sim.clock >= sim.hUntil1) setPaddleH(1, PADDLE_H, 0);
  if (sim.hUntil2 && sim.clock >= sim.hUntil2) setPaddleH(2, PADDLE_H, 0);

  // drift the moving power-ups (bounce off top/bottom)
  for (const pu of sim.powerups) {
    if (!pu.vx && !pu.vy) continue;
    pu.x += pu.vx * dt;
    pu.y += pu.vy * dt;
    if (pu.y < POWERUP_R) { pu.y = POWERUP_R; pu.vy = Math.abs(pu.vy); }
    else if (pu.y > h - POWERUP_R) { pu.y = h - POWERUP_R; pu.vy = -Math.abs(pu.vy); }
    // keep them in the central band horizontally
    if (pu.x < w * 0.22) { pu.x = w * 0.22; pu.vx = Math.abs(pu.vx); }
    else if (pu.x > w * 0.78) { pu.x = w * 0.78; pu.vx = -Math.abs(pu.vx); }
  }

  // left paddle = host keyboard
  if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) sim.p1Y -= PADDLE_SPEED * dt;
  if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) sim.p1Y += PADDLE_SPEED * dt;
  sim.p1Y = clamp(sim.p1Y, 0, h - sim.h1);

  // right paddle = AI (bot) or remote player input
  if (rightIsHuman()) {
    if (remoteInput.up) sim.p2Y -= PADDLE_SPEED * dt;
    if (remoteInput.down) sim.p2Y += PADDLE_SPEED * dt;
  } else {
    const target = aiTargetY();
    sim.p2Y += clamp(target - sim.p2Y, -AI_SPEED * dt, AI_SPEED * dt);
  }
  sim.p2Y = clamp(sim.p2Y, 0, h - sim.h2);

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
    if (b.vx < 0 && b.x - R <= leftFace && b.x >= WALL_X && b.y >= sim.p1Y - R && b.y <= sim.p1Y + sim.h1 + R) {
      bounce(b, sim.p1Y, sim.h1, 1, leftFace + R);
      b.o = 1;
    } else if (
      b.vx > 0 && b.x + R >= rightFace && b.x <= w - WALL_X && b.y >= sim.p2Y - R && b.y <= sim.p2Y + sim.h2 + R
    ) {
      bounce(b, sim.p2Y, sim.h2, -1, rightFace - R);
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
      const k = POWER_KINDS[(Math.random() * POWER_KINDS.length) | 0];
      // ~45% of power-ups drift around to make them harder to grab
      const moving = Math.random() < 0.45;
      const ang = Math.random() * Math.PI * 2;
      const sp = POWERUP_DRIFT * h;
      sim.powerups.push({
        id: ++powerSeq,
        x: w * (0.3 + Math.random() * 0.4),
        y: h * (0.2 + Math.random() * 0.6),
        vx: moving ? Math.cos(ang) * sp : 0,
        vy: moving ? Math.sin(ang) * sp : 0,
        k,
      });
    }
  }
}

function normalized(): PongState {
  return {
    balls: sim.balls.map((b) => ({ id: b.id, x: b.x / w, y: b.y / h, vx: b.vx / w, vy: b.vy / h, o: b.o })),
    p1: sim.p1Y / (h - sim.h1 || 1),
    p2: sim.p2Y / (h - sim.h2 || 1),
    s1: sim.s1,
    s2: sim.s2,
    l1: sim.life1,
    l2: sim.life2,
    pus: sim.powerups.map((p) => ({ id: p.id, x: p.x / w, y: p.y / h, k: p.k })),
    ph: sim.phase === "stack" ? 1 : 0,
    ph1: sim.h1 / h,
    ph2: sim.h2 / h,
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
  h1: number; // left paddle height (px)
  h2: number; // right paddle height (px)
  balls: { id: number; x: number; y: number; o: 0 | 1 | 2 }[]; // pixel centers
  powerups: { id: number; x: number; y: number; k: PowerKind }[];
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
    h1: sim.h1,
    h2: sim.h2,
    balls: sim.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, o: b.o })),
    powerups: sim.powerups.map((p) => ({ id: p.id, x: p.x, y: p.y, k: p.k })),
    s1: sim.s1,
    s2: sim.s2,
    l1: sim.life1,
    l2: sim.life2,
    stack: sim.phase === "stack",
  };
}

function clientView(now: number, dt: number): RenderView {
  const h1 = cli.ph1 > 0 ? cli.ph1 * h : PADDLE_H;
  const h2 = cli.ph2 > 0 ? cli.ph2 * h : PADDLE_H;
  const pad = paddleBuf.sample(now);
  const p1 = pad?.p1 ?? 0.5;
  const p2 = role === "player" ? predP2 : pad?.p2 ?? 0.5;
  const rb = ballField.step(now, dt);
  return {
    p1Y: p1 * (h - h1),
    p2Y: p2 * (h - h2),
    h1,
    h2,
    balls: rb.map((b) => ({ id: b.id, x: b.x * w, y: b.y * h, o: b.o })),
    powerups: cli.pus.map((p) => ({ id: p.id, x: p.x * w, y: p.y * h, k: p.k })),
    s1: cli.s1,
    s2: cli.s2,
    l1: cli.l1,
    l2: cli.l2,
    stack: cli.stack,
  };
}

// --- palette ---
const COL = {
  p1: "#34d399",
  p2: "#fb7185",
  ball: "#ffffff",
  text: "#f4f4f5",
  sub: "#a1a1aa",
  card: "#15151f",
};
const POWER_COLOR: Record<PowerKind, string> = {
  multi: "#22d3ee",
  speed: "#f59e0b",
  slow: "#818cf8",
  life: "#4ade80",
  grow: "#a3e635",
  shrink: "#f472b6",
};
const POWER_ICON: Record<PowerKind, string> = {
  multi: "✦",
  speed: "»",
  slow: "«",
  life: "✚",
  grow: "▲",
  shrink: "▼",
};
const POWER_LABEL: Record<PowerKind, string> = {
  multi: "Multiball",
  speed: "Speed up",
  slow: "Slow down",
  life: "Extra life",
  grow: "Grow",
  shrink: "Shrink foe",
};
const ownColor = (o: 0 | 1 | 2): string => (o === 1 ? COL.p1 : o === 2 ? COL.p2 : "#e5e7eb");

// --- client-only juice state (render layer; never touches the sim/net) ---
const TRAIL_LEN = 10;
const trails = new Map<number, { x: number; y: number }[]>();
let p1Glow = 0;
let p2Glow = 0;
let shake = 0;
let anim = 0;
let prevS1 = 0;
let prevS2 = 0;
let scoreSeeded = false;
let cdShown = -99;
let cdT = 0;

// Clickable regions for the current lobby frame (mouse support). Rebuilt every
// time the lobby is drawn; the pointer handler hit-tests against it.
const lobbyHits: { x: number; y: number; w: number; h: number; act: () => void }[] = [];

// effects: particles + goal-edge flashes
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 1 → 0
  max: number; // seconds
  color: string;
  size: number;
}
const particles: Particle[] = [];
let flashL = 0; // left goal flash 0..1
let flashR = 0; // right goal flash 0..1
const prevO = new Map<number, 0 | 1 | 2>(); // ball id → last owner (paddle-hit spark)
let prevPus: { id: number; x: number; y: number; k: PowerKind }[] = []; // last frame's power-ups

function spawnBurst(x: number, y: number, color: string, n: number, speed: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.25 + Math.random() * 0.75);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 1,
      max: 0.45 + Math.random() * 0.4,
      color,
      size: 2 + Math.random() * 3,
    });
  }
  if (particles.length > 420) particles.splice(0, particles.length - 420);
}

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt / p.max;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 280 * dt; // light gravity
    p.vx *= 1 - dt * 1.3;
  }
  flashL = Math.max(0, flashL - dt * 2.4);
  flashR = Math.max(0, flashR - dt * 2.4);
}

function drawParticles(): void {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    const s = p.size * (0.4 + p.life * 0.6);
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

function drawGoalFlashes(): void {
  if (flashL > 0.01) {
    const g = ctx.createLinearGradient(0, 0, w * 0.18, 0);
    g.addColorStop(0, `rgba(52,211,153,${flashL * 0.55})`);
    g.addColorStop(1, "rgba(52,211,153,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w * 0.18, h);
  }
  if (flashR > 0.01) {
    const g = ctx.createLinearGradient(w, 0, w * 0.82, 0);
    g.addColorStop(0, `rgba(251,113,133,${flashR * 0.55})`);
    g.addColorStop(1, "rgba(251,113,133,0)");
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.82, 0, w * 0.18, h);
  }
}

function roundRect(x: number, y: number, ww: number, hh: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, ww, hh, r);
}

function drawBackground(): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#11111b");
  g.addColorStop(1, "#08080d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawCenterLine(): void {
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 16]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 78);
  ctx.lineTo(w / 2, h - 16);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

function winLabel(): string {
  return cfg.win === "stack" ? "Stack · tug from 10" : `First to ${cfg.win}`;
}

// ---- juice updates ----
function updateJuice(v: RenderView, dt: number): void {
  anim += dt;
  const lf = WALL_X + PADDLE_W;
  const rf = w - WALL_X - PADDLE_W;
  let g1 = 0;
  let g2 = 0;
  for (const b of v.balls) {
    const d1 = b.x - lf;
    if (d1 >= -R && d1 < 150 && b.y > v.p1Y - 24 && b.y < v.p1Y + v.h1 + 24) g1 = Math.max(g1, 1 - d1 / 150);
    const d2 = rf - b.x;
    if (d2 >= -R && d2 < 150 && b.y > v.p2Y - 24 && b.y < v.p2Y + v.h2 + 24) g2 = Math.max(g2, 1 - d2 / 150);
  }
  const k = 1 - Math.exp(-dt * 16);
  p1Glow += (g1 - p1Glow) * k;
  p2Glow += (g2 - p2Glow) * k;

  // paddle-hit sparks: a ball's owner flips the moment it bounces off a paddle
  const seenO = new Set<number>();
  for (const b of v.balls) {
    seenO.add(b.id);
    const was = prevO.get(b.id);
    if (was !== undefined && was !== b.o && b.o !== 0) {
      const face = b.o === 1 ? lf : rf;
      spawnBurst(face, b.y, b.o === 1 ? COL.p1 : COL.p2, 8, 220);
    }
    prevO.set(b.id, b.o);
  }
  for (const id of prevO.keys()) if (!seenO.has(id)) prevO.delete(id);

  // power-up collected: present last frame, gone now → sparkle at its spot
  for (const pp of prevPus) {
    if (!v.powerups.some((p) => p.id === pp.id)) spawnBurst(pp.x, pp.y, POWER_COLOR[pp.k], 14, 260);
  }
  prevPus = v.powerups.map((p) => ({ id: p.id, x: p.x, y: p.y, k: p.k }));

  // score: shake + a goal-edge flash + a burst on the side the ball left through
  if (!scoreSeeded) {
    prevS1 = v.s1;
    prevS2 = v.s2;
    scoreSeeded = true;
  }
  if (v.s1 !== prevS1 || v.s2 !== prevS2) {
    shake = Math.min(18, shake + 12);
    if (v.s1 > prevS1) {
      flashR = 1;
      spawnBurst(w - 6, h * (0.2 + Math.random() * 0.6), COL.p2, 26, 360);
    }
    if (v.s2 > prevS2) {
      flashL = 1;
      spawnBurst(6, h * (0.2 + Math.random() * 0.6), COL.p1, 26, 360);
    }
    prevS1 = v.s1;
    prevS2 = v.s2;
  }
  shake *= Math.exp(-dt * 9);

  updateParticles(dt);
}

// ---- field elements ----
function drawPowerups(v: RenderView): void {
  for (const p of v.powerups) {
    const col = POWER_COLOR[p.k];
    const pulse = 0.5 + 0.5 * Math.sin(anim * 3.5 + p.id * 1.7);
    const r = POWERUP_R + pulse * 1.5;

    // rotating dashed halo
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(anim * 1.2 + p.id);
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.5 + pulse * 0.3;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // glowing token (rounded square)
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = col;
    ctx.shadowBlur = 12 + pulse * 14;
    const grad = ctx.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, col);
    grad.addColorStop(1, "rgba(255,255,255,0.85)");
    ctx.fillStyle = grad;
    roundRect(-r, -r, r * 2, r * 2, 6);
    ctx.fill();
    ctx.restore();

    // icon (upright)
    ctx.fillStyle = "#0a0a10";
    ctx.font = "900 17px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(POWER_ICON[p.k], p.x, p.y + 1);
    ctx.textBaseline = "alphabetic";
  }
}

function drawBalls(v: RenderView): void {
  const seen = new Set<number>();
  const glow = v.balls.length <= 6; // skip per-ball blur during multiball (perf)
  for (const b of v.balls) {
    seen.add(b.id);
    let tr = trails.get(b.id);
    if (!tr) {
      tr = [];
      trails.set(b.id, tr);
    }
    tr.push({ x: b.x, y: b.y });
    if (tr.length > TRAIL_LEN) tr.shift();

    const c = ownColor(b.o);
    for (let i = 0; i < tr.length - 1; i++) {
      const a = i / tr.length;
      ctx.globalAlpha = a * 0.45;
      ctx.fillStyle = c;
      const s = BALL * (0.35 + a * 0.65);
      ctx.fillRect(tr[i].x - s / 2, tr[i].y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    if (glow) {
      ctx.shadowColor = c;
      ctx.shadowBlur = 16;
    }
    ctx.fillStyle = COL.ball;
    ctx.fillRect(b.x - R, b.y - R, BALL, BALL);
    ctx.shadowBlur = 0;
  }
  for (const id of trails.keys()) if (!seen.has(id)) trails.delete(id);
}

function drawPaddle(x: number, y: number, ph: number, color: string, glow: number): void {
  ctx.save();
  if (glow > 0.02) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 + glow * 24;
  }
  ctx.fillStyle = color;
  roundRect(x, y, PADDLE_W, ph, PADDLE_W / 2);
  ctx.fill();
  ctx.restore();
}

function drawPaddles(v: RenderView): void {
  drawPaddle(WALL_X, v.p1Y, v.h1, COL.p1, p1Glow);
  drawPaddle(w - WALL_X - PADDLE_W, v.p2Y, v.h2, COL.p2, p2Glow);
}

// ---- HUD ----
function drawLives(cx: number, y: number, n: number, color: string): void {
  if (n <= 0) return;
  const count = Math.min(n, 5);
  const gap = 9;
  let x = cx - ((count - 1) * gap) / 2;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    x += gap;
  }
}

function drawPlayerChip(x: number, y: number, id: string, fallback: string, color: string, align: "left" | "right"): void {
  const entry = id ? players.get(id) : undefined;
  const name = entry?.name ?? fallback;
  const r = 13;
  const dir = align === "left" ? 1 : -1;
  const ax = x + dir * r;

  if (entry?.img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(entry.img, ax - r, y - r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ax, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  } else {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(ax, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((name || "?").charAt(0).toUpperCase(), ax, y + 1);
    ctx.textBaseline = "alphabetic";
  }

  ctx.fillStyle = COL.sub;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = align === "left" ? "left" : "right";
  ctx.fillText(name, x + dir * (r * 2 + 8), y + 4);
}

function drawHud(v: RenderView): void {
  const cx = w / 2;
  const top = 30;

  // big scores flanking the centre
  ctx.font = "700 46px ui-monospace, 'SF Mono', monospace";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.fillStyle = COL.p1;
  ctx.fillText(String(v.s1), cx - 26, top + 38);
  ctx.textAlign = "left";
  ctx.fillStyle = COL.p2;
  ctx.fillText(String(v.s2), cx + 26, top + 38);

  // mode caption between the scores
  ctx.fillStyle = COL.sub;
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText((v.stack ? "STACK" : winLabel()).toUpperCase(), cx, top + 6);

  // extra-life pips
  drawLives(cx - 58, top + 52, v.l1, COL.p1);
  drawLives(cx + 58, top + 52, v.l2, COL.p2);

  // player chips in the top corners
  drawPlayerChip(24, top, leftId, "Player 1", COL.p1, "left");
  drawPlayerChip(w - 24, top, rightId === BOT || !rightId ? "" : rightId, rightId === BOT ? "CPU" : "Open", COL.p2, "right");
}

// ---- lobby / overlays ----
function drawChip(x: number, y: number, ww: number, hh: number, label: string, sel: boolean, accent: string): void {
  roundRect(x, y, ww, hh, hh / 2);
  if (sel) {
    ctx.fillStyle = accent;
    ctx.fill();
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.stroke();
  }
  ctx.fillStyle = sel ? "#0a0a10" : COL.sub;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + ww / 2, y + hh / 2 + 1);
  ctx.textBaseline = "alphabetic";
}

function drawButton(x: number, y: number, ww: number, hh: number, label: string, accent: string): void {
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.fillStyle = accent;
  roundRect(x, y, ww, hh, hh / 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#0a0a10";
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + ww / 2, y + hh / 2 + 1);
  ctx.textBaseline = "alphabetic";
}

function drawLobby(): void {
  drawBackground();
  drawCenterLine();
  ctx.fillStyle = "rgba(7,7,12,0.62)";
  ctx.fillRect(0, 0, w, h);

  lobbyHits.length = 0;
  const host = role === "host";
  const cx = w / 2;
  const cw = Math.min(460, w - 48);
  const chh = 362;
  const cyTop = h / 2 - chh / 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 44;
  ctx.fillStyle = COL.card;
  roundRect(cx - cw / 2, cyTop, cw, chh, 20);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  roundRect(cx - cw / 2, cyTop, cw, chh, 20);
  ctx.stroke();

  let y = cyTop + 42;
  ctx.fillStyle = COL.text;
  ctx.font = "800 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PONG", cx, y);
  ctx.fillStyle = COL.sub;
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.fillText(host ? "LOBBY" : "WATCHING", cx, y + 15);

  // win-mode chips (host: clickable)
  y += 44;
  const labels = ["7", "12", "30", "STACK"];
  const modes: WinMode[] = ["7", "12", "30", "stack"];
  const cwd = [50, 50, 50, 76];
  const gap = 8;
  const totalW = cwd.reduce((a, b) => a + b, 0) + gap * (labels.length - 1);
  let x = cx - totalW / 2;
  for (let i = 0; i < labels.length; i++) {
    drawChip(x, y, cwd[i], 34, labels[i], cfg.win === modes[i], COL.p1);
    if (host) {
      const m = modes[i];
      lobbyHits.push({ x, y, w: cwd[i], h: 34, act: () => cycleWin(m) });
    }
    x += cwd[i] + gap;
  }

  // power-up toggle (host: clickable)
  y += 46;
  const puW = 168;
  const puX = cx - puW / 2;
  drawChip(puX, y, puW, 34, `Power-ups  ${cfg.powerups ? "ON" : "OFF"}`, cfg.powerups, POWER_COLOR.multi);
  if (host) lobbyHits.push({ x: puX, y, w: puW, h: 34, act: togglePowerups });

  // power-up legend
  y += 42;
  if (cfg.powerups) {
    const kinds: PowerKind[] = ["multi", "speed", "slow", "life", "grow", "shrink"];
    const iw = 30;
    const ig = 6;
    const tw = kinds.length * iw + (kinds.length - 1) * ig;
    let lx = cx - tw / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const kk of kinds) {
      ctx.fillStyle = POWER_COLOR[kk];
      ctx.font = "900 16px system-ui, sans-serif";
      ctx.fillText(POWER_ICON[kk], lx + iw / 2, y);
      lx += iw + ig;
    }
    ctx.textBaseline = "alphabetic";
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Power-ups disabled", cx, y);
  }

  // opponent line
  y += 34;
  ctx.fillStyle = COL.sub;
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  const oppLine = host
    ? `Opponent: ${rightIsHuman() ? players.get(rightId)?.name ?? "Player 2" : "CPU (solo)"}`
    : rightIsHuman()
      ? "Both slots taken — you're watching"
      : "Right slot open";
  ctx.fillText(oppLine, cx, y);

  // action button
  y += 18;
  const bw = 184;
  const bx = cx - bw / 2;
  const bh = 40;
  if (host) {
    drawButton(bx, y, bw, bh, "Start match", COL.p1);
    lobbyHits.push({ x: bx, y, w: bw, h: bh, act: startMatch });
  } else if (!rightIsHuman()) {
    drawButton(bx, y, bw, bh, "Play", COL.p1);
    lobbyHits.push({ x: bx, y, w: bw, h: bh, act: () => net?.claim() });
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for the host…", cx, y + 24);
  }
}

function drawCountdown(dt: number): void {
  ctx.fillStyle = "rgba(7,7,12,0.5)";
  ctx.fillRect(0, 0, w, h);

  if (countdown !== cdShown) {
    cdShown = countdown;
    cdT = 0;
  }
  cdT += dt;
  const pop = Math.max(0, 1 - cdT * 4.5); // ~0.22s pop on each tick
  const scale = 1 + pop * 0.45;
  const label = countdown > 0 ? String(countdown) : "GO!";

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  ctx.shadowColor = countdown > 0 ? "rgba(255,255,255,0.25)" : COL.p1;
  ctx.shadowBlur = 30;
  ctx.fillStyle = countdown > 0 ? COL.text : COL.p1;
  ctx.font = "800 128px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

function drawGameover(): void {
  ctx.fillStyle = "rgba(7,7,12,0.72)";
  ctx.fillRect(0, 0, w, h);
  const youWon = (role === "host" && winner === 1) || (role === "player" && winner === 2);
  const accent = winner === 1 ? COL.p1 : COL.p2;
  const title = role === "watcher" ? `Player ${winner} wins` : youWon ? "You win!" : "You lose";

  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24;
  ctx.fillStyle = accent;
  ctx.font = "800 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, w / 2, h / 2 - 10);
  ctx.restore();

  ctx.fillStyle = COL.sub;
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(role === "host" ? "Space — rematch     Esc — lobby" : "Waiting for host…", w / 2, h / 2 + 30);
}

function drawFooterHint(): void {
  ctx.textAlign = "center";
  if (role === "watcher") {
    ctx.fillStyle = COL.sub;
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(rightIsHuman() ? "Watching" : "Watching — press J to play", w / 2, h - 18);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("W / S   or   ↑ / ↓", w / 2, h - 18);
  }
}

function render(now: number, dt: number): void {
  if (screen === "lobby") {
    trails.clear();
    particles.length = 0;
    prevO.clear();
    prevPus = [];
    flashL = flashR = 0;
    scoreSeeded = false;
    drawLobby();
    return;
  }
  if (screen === "connecting") {
    drawBackground();
    drawCenterLine();
    ctx.fillStyle = COL.text;
    ctx.font = "700 24px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Connecting…", w / 2, h / 2);
    return;
  }

  const v = role === "host" ? hostView() : clientView(now, dt);
  updateJuice(v, dt);

  ctx.save();
  if (shake > 0.25) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawBackground();
  drawGoalFlashes();
  drawCenterLine();
  drawPowerups(v);
  drawBalls(v);
  drawPaddles(v);
  drawParticles();
  ctx.restore();

  drawHud(v);

  if (screen === "countdown") {
    drawCountdown(dt);
    return;
  }

  drawFooterHint();

  if (screen === "gameover") drawGameover();
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

function togglePowerups(): void {
  if (role !== "host") return;
  cfg = { ...cfg, powerups: !cfg.powerups };
  broadcastLobby();
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
        togglePowerups();
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

/** Map a pointer event to game (canvas drawing-space) coordinates. */
function gameCoords(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (w / Math.max(1, rect.width)),
    y: (e.clientY - rect.top) * (h / Math.max(1, rect.height)),
  };
}

function onPointerDown(e: PointerEvent): void {
  sfx?.unlock();
  const { x, y } = gameCoords(e);
  if (screen === "lobby") {
    for (const hit of lobbyHits) {
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
        hit.act();
        return;
      }
    }
  } else if (screen === "gameover" && role === "host") {
    rematch();
  }
}

/** Player only: integrate my paddle locally from input for zero-lag response. */
function updatePrediction(dt: number): void {
  const h2 = cli.ph2 > 0 ? cli.ph2 * h : PADDLE_H;
  const fracSpeed = PADDLE_SPEED / Math.max(1, h - h2);
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
  window.addEventListener("pointerdown", onPointerDown);

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
      cli.ph1 = s.ph1 ?? 0;
      cli.ph2 = s.ph2 ?? 0;
      cli.pus = s.pus.map((p) => ({ id: p.id, x: p.x, y: p.y, k: p.k }));
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
