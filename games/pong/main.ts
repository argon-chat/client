/**
 * Pong — PlayFrame multiplayer reference game.
 *
 * In-canvas lobby (Solo / Multiplayer), host-authoritative netcode over the
 * SFU messaging API, and a read-only spectator view. Launch intent decides the
 * role: `new` → host menu, `join` → player 2, `spectate` → watcher. Runs
 * standalone (solo vs AI) when opened outside a PlayFrame host.
 */

import {
  PlayFrameClient,
  createFrameLoop,
  createInputManager,
  configureCanvas,
  isInPlayFrame,
} from "@argon/playframe-sdk";
import { createPongNet, type PongNet, type PongState } from "./net";
import { createStateBuffer, type StateBuffer } from "./interp";
import { createSfx, type Sfx } from "./sfx";

// --- constants ---
const PADDLE_W = 12;
const PADDLE_H = 90;
const BALL = 12;
const PADDLE_SPEED = 560;
const AI_SPEED = 320;
const BALL_SPEED = 420;
const MAX_BALL_SPEED = 1100;
const WIN_SCORE = 7;
const STATE_HZ = 30;
const COUNTDOWN_SECS = 3;

// --- dom ---
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const loading = document.getElementById("loading");

// --- roles / screens ---
type Role = "host" | "player" | "spectator";
type Screen = "menu" | "waiting" | "connecting" | "countdown" | "playing" | "gameover";
let role: Role = "host";
let mode: "solo" | "multiplayer" = "solo";
let screen: Screen = "menu";

let client: PlayFrameClient | null = null;
let net: PongNet | null = null;
let myId = "";
let hostId = ""; // for players: the authoritative host's peer id
let player2Id = ""; // for host: the joined player's peer id
const spectators = new Set<string>(); // for host: peers currently watching
let winner: 1 | 2 = 1;

let w = 0;
let h = 0;

// host-authoritative pixel sim
const sim = { p1Y: 0, p2Y: 0, ballX: 0, ballY: 0, vx: BALL_SPEED, vy: 0, s1: 0, s2: 0 };
// player/spectator render state: snapshots are buffered + interpolated to kill
// jitter (scores read from the buffer's latest raw snapshot).
const buffer: StateBuffer = createStateBuffer();
// player-2 input received by the host
const remoteInput = { up: false, down: false };

// Pre-match countdown (host counts down; clients follow `countdown` messages).
let countdown = 0;
let countdownAccum = 0;

// Client-side prediction for my own paddle (player only): integrated locally
// from my input for instant response, lightly reconciled to the host at rest.
// Stored as a 0..1 fraction of the free vertical travel.
let predP2 = 0.5;

let sfx: Sfx;
let input: ReturnType<typeof createInputManager>;
let stateAccum = 0;

// roster + identities (names/avatars) for a more personal HUD
interface PlayerInfo {
  name: string;
  avatarId: string | null;
  img?: HTMLImageElement;
  requested?: boolean;
}
const players = new Map<string, PlayerInfo>();
let leftId = ""; // activity host peer id
let rightId = ""; // joined player peer id

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

// Avatar bytes come from the host as a data URL (no CDN access from the game).
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
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function resize(): void {
  const size = configureCanvas(
    canvas,
    { width: window.innerWidth, height: window.innerHeight },
    { pixelPerfect: true },
  );
  w = size.width;
  h = size.height;
  sim.p1Y = clamp(sim.p1Y, 0, h - PADDLE_H);
  sim.p2Y = clamp(sim.p2Y, 0, h - PADDLE_H);
}

function centerBall(dir: number): void {
  sim.ballX = w / 2;
  sim.ballY = h / 2;
  sim.vx = BALL_SPEED * dir;
  sim.vy = (Math.random() - 0.5) * BALL_SPEED;
}

function resetMatch(): void {
  sim.s1 = 0;
  sim.s2 = 0;
  sim.p1Y = h / 2 - PADDLE_H / 2;
  sim.p2Y = h / 2 - PADDLE_H / 2;
  centerBall(Math.random() > 0.5 ? 1 : -1);
}

// --- host simulation ---
function updateSim(dt: number): void {
  // left paddle = host keyboard
  if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) sim.p1Y -= PADDLE_SPEED * dt;
  if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) sim.p1Y += PADDLE_SPEED * dt;
  sim.p1Y = clamp(sim.p1Y, 0, h - PADDLE_H);

  // right paddle = AI (solo) or remote player input (multiplayer)
  if (mode === "solo") {
    const target = sim.ballY - PADDLE_H / 2;
    sim.p2Y += clamp(target - sim.p2Y, -AI_SPEED * dt, AI_SPEED * dt);
  } else {
    if (remoteInput.up) sim.p2Y -= PADDLE_SPEED * dt;
    if (remoteInput.down) sim.p2Y += PADDLE_SPEED * dt;
  }
  sim.p2Y = clamp(sim.p2Y, 0, h - PADDLE_H);

  // ball
  sim.ballX += sim.vx * dt;
  sim.ballY += sim.vy * dt;
  if (sim.ballY <= 0 || sim.ballY >= h - BALL) {
    sim.vy *= -1;
    sim.ballY = clamp(sim.ballY, 0, h - BALL);
    emitSfx("wall");
  }
  if (sim.ballX <= 30 + PADDLE_W && sim.ballY + BALL >= sim.p1Y && sim.ballY <= sim.p1Y + PADDLE_H && sim.vx < 0) {
    bounce(sim.p1Y, 1);
  }
  if (sim.ballX + BALL >= w - 30 - PADDLE_W && sim.ballY + BALL >= sim.p2Y && sim.ballY <= sim.p2Y + PADDLE_H && sim.vx > 0) {
    bounce(sim.p2Y, -1);
  }
  if (sim.ballX < 0) {
    sim.s2++;
    onPoint();
  } else if (sim.ballX > w) {
    sim.s1++;
    onPoint();
  }
}

function bounce(paddleY: number, dir: number): void {
  const hit = (sim.ballY - paddleY) / PADDLE_H - 0.5;
  const speed = Math.min(Math.abs(sim.vx) * 1.06, MAX_BALL_SPEED);
  sim.vx = speed * dir;
  sim.vy = hit * speed * 1.4;
  emitSfx("hit");
}

function onPoint(): void {
  if (sim.s1 >= WIN_SCORE || sim.s2 >= WIN_SCORE) {
    winner = sim.s1 > sim.s2 ? 1 : 2;
    screen = "gameover";
    net?.over(winner);
    // Host is player 1 → win jingle when left wins, loss otherwise.
    sfx.play(winner === 1 ? "win" : "lose");
    reportSession();
  } else {
    emitSfx("score");
    centerBall(sim.s1 > sim.s2 ? -1 : 1);
  }
}

/** Host: play a cue locally and broadcast it so every client hears it too. */
function emitSfx(k: "hit" | "wall" | "score"): void {
  sfx.play(k);
  net?.sfx(k);
}

function normalized(): PongState {
  return {
    bx: (sim.ballX + BALL / 2) / w,
    by: (sim.ballY + BALL / 2) / h,
    p1: sim.p1Y / (h - PADDLE_H),
    p2: sim.p2Y / (h - PADDLE_H),
    s1: sim.s1,
    s2: sim.s2,
  };
}

// --- session presence (host only; SDK ignores for non-hosts) ---
function reportSession(): void {
  if (!client || role !== "host") return;
  const playerCount = mode === "multiplayer" && player2Id ? 2 : 1;
  const state = screen === "menu" ? "menu" : screen === "waiting" ? "waiting" : screen === "gameover" ? "gameover" : "playing";
  // Pong always lets people in while active — the game decides on entry whether
  // they become a player (open slot) or a spectator. State stream lets watchers
  // see live play (solo vs bot included).
  const joinable = state !== "gameover";
  const spectatable = state === "playing";
  // Ephemeral ids of who's actually playing (left + right paddle) so the app
  // can flag every player's card as in-game, not only the host's.
  const players = [leftId, mode === "multiplayer" ? rightId : ""].filter(Boolean);
  client.updateSession({ state, mode, joinable, spectatable, playerCount, maxPlayers: 2, players });
}

// --- transitions ---

/**
 * Host: freeze the ball and run a 3-2-1 countdown before play. Each tick is
 * broadcast so players/spectators show the same number; the match goes live
 * when it hits zero (see the host branch in the frame loop).
 */
function beginCountdown(): void {
  countdown = COUNTDOWN_SECS;
  countdownAccum = 0;
  predP2 = 0.5; // recenter the predicted paddle for the new point
  screen = "countdown";
  if (role === "host") {
    net?.countdown(countdown);
    sfx.play("count");
    reportSession();
  }
}

function startSolo(): void {
  mode = "solo";
  leftId = myId;
  rightId = "";
  resetMatch();
  net?.roster(myId, ""); // tell any watchers who's playing (right = bot)
  beginCountdown();
}

function startMultiplayerHost(): void {
  mode = "multiplayer";
  screen = "waiting";
  reportSession(); // joinable presence → others see a Join button
}

function startMatch(): void {
  leftId = myId;
  rightId = player2Id;
  resetMatch();
  net?.roster(myId, player2Id);
  void refreshPlayers();
  beginCountdown();
}

function rematch(): void {
  resetMatch();
  if (role === "host") {
    net?.rematch();
    beginCountdown();
  }
}

/** The authoritative host left: take over this instance and drop to the menu. */
function backToMenuAsHost(): void {
  role = "host";
  mode = "solo";
  hostId = "";
  player2Id = "";
  spectators.clear();
  buffer.clear();
  leftId = myId;
  rightId = "";
  screen = "menu";
  reportSession();
}

/** The opponent left: pull in a waiting spectator, else reopen the lobby. */
function opponentLeft(): void {
  player2Id = "";
  rightId = "";
  remoteInput.up = false;
  remoteInput.down = false;
  mode = "multiplayer";

  const next = spectators.values().next().value as string | undefined;
  if (next) {
    spectators.delete(next);
    player2Id = next;
    net?.approve(next);
    startMatch();
  } else {
    screen = "waiting";
    reportSession();
  }
}

// --- render ---
interface ViewPx {
  p1Y: number;
  p2Y: number;
  ballX: number;
  ballY: number;
  s1: number;
  s2: number;
}

function toViewPx(): ViewPx {
  if (role === "host") {
    return { p1Y: sim.p1Y, p2Y: sim.p2Y, ballX: sim.ballX, ballY: sim.ballY, s1: sim.s1, s2: sim.s2 };
  }

  const freeH = h - PADDLE_H;
  // Smoothed ball + opponent paddle from the interpolation buffer; scores from
  // the latest raw snapshot (discrete values must not lag behind).
  const smooth = buffer.sample(performance.now());
  const latest = buffer.latest();
  if (!smooth || !latest) {
    return { p1Y: freeH / 2, p2Y: freeH / 2, ballX: w / 2, ballY: h / 2, s1: 0, s2: 0 };
  }

  // I'm the right paddle (p2). Render my own paddle from local prediction for
  // zero input lag; spectators have no own paddle, so they use the snapshot.
  const p2 = role === "player" ? predP2 : smooth.p2;

  return {
    p1Y: smooth.p1 * freeH,
    p2Y: p2 * freeH,
    ballX: smooth.bx * w - BALL / 2,
    ballY: smooth.by * h - BALL / 2,
    s1: latest.s1,
    s2: latest.s2,
  };
}

/** Player only: integrate my paddle locally from input, reconcile at rest. */
function updatePrediction(dt: number): void {
  const freeH = Math.max(1, h - PADDLE_H);
  const fracSpeed = PADDLE_SPEED / freeH; // 0..1 units per second
  const up = input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp");
  const down = input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown");

  if (up) predP2 -= fracSpeed * dt;
  if (down) predP2 += fracSpeed * dt;
  predP2 = clamp(predP2, 0, 1);

  // While idle, ease toward the authoritative position to cancel any drift
  // (no reconcile while moving → no rubber-banding against my own input).
  if (!up && !down) {
    const auth = buffer.latest()?.p2;
    if (auth != null) predP2 += (auth - predP2) * Math.min(1, dt * 5);
  }
}

function drawField(v: ViewPx): void {
  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#2a2a33";
  ctx.setLineDash([10, 14]);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#4ade80";
  ctx.fillRect(30, v.p1Y, PADDLE_W, PADDLE_H);
  ctx.fillStyle = "#f87171";
  ctx.fillRect(w - 30 - PADDLE_W, v.p2Y, PADDLE_W, PADDLE_H);
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(v.ballX, v.ballY, BALL, BALL);
  ctx.font = "48px monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(v.s1), w / 4, 64);
  ctx.fillText(String(v.s2), (w * 3) / 4, 64);

  drawPlayerTag(w / 4, leftId, "Player 1");
  drawPlayerTag((w * 3) / 4, rightId, mode === "solo" ? "CPU" : "Player 2");
}

function drawPlayerTag(cx: number, id: string, fallback: string): void {
  const entry = id ? players.get(id) : undefined;
  const name = entry?.name ?? fallback;
  const r = 14;
  const cy = 100;

  if (entry?.img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(entry.img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.charAt(0).toUpperCase(), cx, cy + 1);
    ctx.textBaseline = "alphabetic";
  }

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name, cx, cy + r + 16);
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

function overlay(title: string, lines: string[]): void {
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fafafa";
  ctx.textAlign = "center";
  ctx.font = "bold 32px system-ui, sans-serif";
  ctx.fillText(title, w / 2, h / 2 - 30);
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillStyle = "#a1a1aa";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + 10 + i * 26));
}

function render(): void {
  if (screen === "menu") {
    drawField(toViewPx());
    overlay("PONG", ["Press 1 — Solo (vs AI)", "Press 2 — Multiplayer"]);
    return;
  }
  if (screen === "waiting") {
    drawField(toViewPx());
    overlay("Waiting for opponent…", ["Others can Join from the channel", "Press Esc to cancel"]);
    return;
  }
  if (screen === "connecting") {
    drawField(toViewPx());
    overlay(role === "spectator" ? "Connecting to match…" : "Joining match…", []);
    return;
  }
  if (screen === "countdown") {
    drawField(toViewPx());
    drawCountdown();
    return;
  }
  drawField(toViewPx());
  if (role === "spectator") {
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Spectating", w / 2, h - 20);
  } else {
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("W / S  or  ↑ / ↓ to move", w / 2, h - 20);
  }
  if (screen === "gameover") {
    const youWon = (role === "host" && winner === 1) || (role === "player" && winner === 2);
    const canRematch = role === "host";
    overlay(role === "spectator" ? `Player ${winner} wins` : youWon ? "You win!" : "You lose", [
      canRematch ? "Press Space to rematch" : "Waiting for host…",
    ]);
  }
}

// --- key handling (menus) ---
function onKeydown(e: KeyboardEvent): void {
  if (screen === "menu" && role === "host") {
    if (e.key === "1") startSolo();
    else if (e.key === "2") startMultiplayerHost();
  } else if (screen === "waiting" && e.key === "Escape") {
    // cancel back to menu
    screen = "menu";
    mode = "solo";
    reportSession();
  } else if (screen === "gameover" && role === "host" && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    rematch();
  }
}

// --- boot ---
function startGame(): void {
  if (loading) loading.style.display = "none";
  resize();
  resetMatch();
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", onKeydown);

  // WebAudio needs a user gesture before it can make sound; unlock on the first
  // key/pointer the game sees.
  sfx = createSfx();
  const unlock = () => sfx.unlock();
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("pointerdown", unlock, { once: true });

  input = createInputManager({ preventDefaults: true });
  input.start();

  const loop = createFrameLoop(
    (dt) => {
      if (role === "host" && screen === "countdown") {
        // 3-2-1 → GO: tick once per second, broadcasting each remaining count,
        // then go live. Ball stays frozen until then.
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
          reportSession();
        }
      } else if (role === "host" && screen === "playing") {
        updateSim(dt);
        stateAccum += dt;
        if (net && stateAccum >= 1 / STATE_HZ) {
          stateAccum = 0;
          // Only put state on the wire when someone consumes it: a real
          // opponent (multiplayer) or at least one spectator.
          if (mode === "multiplayer" || spectators.size > 0) net.state(normalized());
        }
      } else if (role === "player" && screen === "playing" && net && hostId) {
        updatePrediction(dt);
        net.input(hostId, input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp"), input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown"));
      }
      render();
    },
    { targetFps: 60, pauseOnHidden: true },
  );
  loop.start();

  if (isInPlayFrame()) {
    void connectToHost(loop);
  } else {
    // Standalone dev: solo menu
    role = "host";
    screen = "menu";
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
      if (peerId === player2Id) opponentLeft();
      else spectators.delete(peerId);
    } else if (peerId === hostId) {
      backToMenuAsHost();
    }
  });

  net = createPongNet(c, {
    onInput: (from, up, down) => {
      if (role === "host" && from === player2Id) {
        remoteInput.up = up;
        remoteInput.down = down;
      }
    },
    // host: someone joined the activity → the GAME decides their role.
    // Open opponent slot → make them a player; otherwise → spectator.
    onReqJoin: (from) => {
      if (role !== "host") return;
      if (!player2Id) {
        player2Id = from;
        spectators.delete(from);
        mode = "multiplayer";
        net?.approve(from);
        startMatch();
      } else {
        spectators.add(from);
        net?.roster(leftId, rightId);
        net?.deny(from); // "no open slot" → you're a spectator
      }
    },
    // joiner: the host made me a player
    onApprove: () => {
      role = "player";
      rightId = myId;
      mode = "multiplayer";
      screen = "playing";
      client?.notifyRole("player");
    },
    // joiner: no open slot → watch instead (host already streams to me)
    onDeny: () => {
      role = "spectator";
      client?.notifyRole("spectator");
    },
    onRoster: (_from, p1, p2) => {
      leftId = p1;
      rightId = p2;
      void refreshPlayers();
    },
    // player/spectator: pre-match countdown tick from the host
    onCountdown: (_from, secs) => {
      if (role === "host") return;
      countdown = secs;
      predP2 = 0.5;
      if (screen !== "countdown") {
        buffer.clear();
        screen = "countdown";
      }
      sfx.play("count");
    },
    // player/spectator: receive authoritative state
    onStart: (from) => {
      hostId = hostId || from;
      if (!leftId) leftId = from;
      if (role !== "host") {
        predP2 = 0.5;
        screen = "playing";
        sfx.play("go");
      }
    },
    onState: (from, s) => {
      hostId = hostId || from;
      if (!leftId) leftId = from;
      buffer.push(s); // interpolation buffer smooths 30 Hz → 60 fps
      if (role !== "host" && screen !== "gameover" && screen !== "countdown") {
        screen = "playing";
      }
    },
    onOver: (_from, won) => {
      if (role === "host") return;
      winner = won;
      screen = "gameover";
      // I'm player 2 when I'm a player; spectators hear the winner's jingle.
      if (role === "player") sfx.play(won === 2 ? "win" : "lose");
      else sfx.play("win");
    },
    onRematch: () => {
      if (role === "host") return;
      buffer.clear();
      predP2 = 0.5;
      countdown = COUNTDOWN_SECS;
      screen = "countdown";
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
      screen = "menu";
      reportSession();
    } else {
      // Unified join: ask the host's game to let us in. The game decides whether
      // we become a player (open slot) or a spectator (slot full).
      role = "spectator";
      screen = "connecting";
      net.reqJoin();
    }
    c.log("info", `Pong connected as ${role}`);
  } catch (e) {
    console.warn("[pong] connect failed, running standalone:", e);
    role = "host";
    screen = "menu";
  }
}

startGame();
