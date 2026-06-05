/**
 * Sea Battle — PlayFrame multiplayer strategy mini-game.
 *
 * Turn-based, split-authority netcode + a host-run economy (see net.ts). Each player
 * secretly holds their own board and resolves shots fired at it; the host (player 1)
 * is the public-state aggregator, turn authority and the bank.
 *
 * Gameplay:
 *  - Host picks the battlefield size (12 / 20 / 30); the fleet scales with it.
 *  - Deploy your fleet (click to place, R / right-click to rotate; Randomize / Clear).
 *  - Earn credits each turn; spend them on actions:
 *      Fire (free) · Airstrike 3×3 · Radar 5×5 scan · Repair a hit · drop a Mine.
 *    A normal hit lets you fire again; everything else ends your turn. Mines you place
 *    on your own water spring on the enemy and waste their shot. Sink all enemy ships.
 */

import { PlayFrameClient, createFrameLoop, configureCanvas, isInPlayFrame } from "@argon/playframe-sdk";
import { createNet, type Net, type PubState, type Phase, type Kind, type Resolved } from "./net";
import { createSfx, type Sfx } from "./sfx";

// --- economy ---
const COST: Record<Kind, number> = { shot: 0, airstrike: 6, radar: 4, repair: 5, mine: 3 };
const START_RES = 5;
const INCOME = 3; // credits at the start of your turn
const HIT_BONUS = 1;
const SINK_BONUS = 5;
const MINE_BONUS = 4;

const BOT = "@bot";
const BOT_DELAY = 0.7;
const SIZES = [12, 20, 30];

function fleetFor(n: number): number[] {
  if (n <= 12) return [5, 4, 3, 3, 2];
  if (n <= 20) return [6, 5, 4, 4, 3, 3, 3, 2, 2];
  return [7, 6, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2];
}

// --- board (runtime; host chooses, clients adopt from state) ---
let N = 20;
let CELLS = N * N;
let FLEET = fleetFor(N);
let TOTAL = FLEET.reduce((a, b) => a + b, 0);

const COL = {
  text: "#e6f1f5", sub: "#7d97a6",
  p1: "#38bdf8", p2: "#fb7185",
  water0: "#061a26", water1: "#0a2738",
  grid: "rgba(130,205,235,0.12)", frame: "rgba(130,205,235,0.22)",
  shipMine: "#3b82f6", shipTop: "#60a5fa",
  hit: "#fb923c", sunk: "#e11d48", detect: "#fbbf24", mine: "#f43f5e",
  panel: "rgba(8,26,38,0.74)", accent: "#22d3ee", credit: "#facc15",
};

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const loading = document.getElementById("loading");
let w = 0, h = 0, anim = 0;

// --- roles ---
type Role = "host" | "player" | "watcher";
type Screen = Phase | "connecting";
let role: Role = "host";
let myNo: 0 | 1 | 2 = 1;
let screen: Screen = "lobby";

let client: PlayFrameClient | null = null;
let net: Net | null = null;
let myId = "", myName = "You", hostId = "";

// --- local board ---
let myShips: number[] = new Array(CELLS).fill(0);
let myReady = false;
const myMines = new Set<number>(); // this player's own mines (secret/local)

// --- ability arming ---
let armed: Kind = "shot";

// --- host-authoritative model ---
const host = {
  g1: new Array(CELLS).fill(0) as number[],
  g2: new Array(CELLS).fill(0) as number[],
  sunk1: [] as number[], sunk2: [] as number[],
  res1: START_RES, res2: START_RES,
  turn: 1 as 1 | 2,
  p2Id: "", p2Name: "Player 2",
  p1Ships: [] as number[], botShips: null as number[] | null,
  mines1: new Set<number>(),
  hostReady: false, oppReady: false, pendingFire: false,
  winner: 0 as 0 | 1 | 2,
};
const botQueue: number[] = [];
let botTimer = 0;

// --- public snapshot ---
function blankPub(): PubState {
  return {
    phase: "lobby", n: N, fleet: FLEET.slice(), turn: 1, p1Name: "Player 1",
    p2Id: "", p2Name: "Player 2", g1: "0".repeat(CELLS), g2: "0".repeat(CELLS),
    sunk1: [], sunk2: [], res1: START_RES, res2: START_RES, winner: 0,
  };
}
let pub: PubState = blankPub();

// --- placement ---
const placed: number[][] = [];
let placeHoriz = true;
let hover = -1;

// --- roster / sfx / fx ---
const players = new Map<string, string>();
let sfx: Sfx;
let prevWinnerSnd: 0 | 1 | 2 = 0;
let prevTurnSnd = 0;
let prevG1 = "", prevG2 = "";

// ===========================================================================
// Helpers
// ===========================================================================

const ix = (x: number, y: number) => y * N + x;
const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
const strCell = (g: string, i: number) => g.charCodeAt(i) - 48;
const curTurn = (): 1 | 2 => (role === "host" ? host.turn : pub.turn);
const curWinner = (): 0 | 1 | 2 => (role === "host" ? host.winner : pub.winner);
const resOf = (p: 1 | 2): number => (p === 1 ? pub.res1 : pub.res2);

function setBoard(n: number, fleet?: number[]): void {
  N = n; CELLS = n * n;
  FLEET = fleet ? fleet.slice() : fleetFor(n);
  TOTAL = FLEET.reduce((a, b) => a + b, 0);
  myShips = new Array(CELLS).fill(0);
  placed.length = 0;
  myMines.clear();
  if (role === "host") {
    host.g1 = new Array(CELLS).fill(0);
    host.g2 = new Array(CELLS).fill(0);
    host.mines1.clear();
  }
  prevG1 = ""; prevG2 = "";
}

function expand(kind: Kind, x: number, y: number): number[] {
  const r = kind === "radar" ? 2 : kind === "airstrike" ? 1 : 0;
  const out: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (inB(x + dx, y + dy)) out.push(ix(x + dx, y + dy));
  }
  return out;
}

function resolveArea(ships: number[], isHit: (c: number) => boolean, mines: Set<number>, cells: number[], kind: Kind): Resolved {
  const r: Resolved = { board: 1, kind, hit: [], miss: [], sunk: [], detect: [], mine: [] };
  if (kind === "radar") {
    for (const c of cells) if (ships[c] && !isHit(c)) r.detect.push(c);
    return r;
  }
  const nowHit = new Set<number>();
  const touched = new Set<number>();
  for (const c of cells) {
    if (mines.has(c)) { r.mine.push(c); continue; }
    if (ships[c]) { r.hit.push(c); nowHit.add(c); touched.add(ships[c]); }
    else r.miss.push(c);
  }
  for (const id of touched) {
    const group: number[] = [];
    let all = true;
    for (let i = 0; i < CELLS; i++) if (ships[i] === id) {
      group.push(i);
      if (!nowHit.has(i) && !isHit(i)) all = false;
    }
    if (all) r.sunk.push(group);
  }
  return r;
}

function cellsFor(len: number, x: number, y: number, horiz: boolean): number[] | null {
  const out: number[] = [];
  for (let k = 0; k < len; k++) {
    const cx = horiz ? x + k : x;
    const cy = horiz ? y : y + k;
    if (!inB(cx, cy)) return null;
    out.push(ix(cx, cy));
  }
  return out;
}

function randomBoard(): number[] {
  const g = new Array(CELLS).fill(0);
  for (let s = 0; s < FLEET.length; s++) {
    const len = FLEET[s];
    for (let tries = 0; tries < 800; tries++) {
      const horiz = Math.random() < 0.5;
      const x = (Math.random() * (horiz ? N - len + 1 : N)) | 0;
      const y = (Math.random() * (horiz ? N : N - len + 1)) | 0;
      const cells = cellsFor(len, x, y, horiz);
      if (cells && cells.every((c) => g[c] === 0)) { for (const c of cells) g[c] = s + 1; break; }
    }
  }
  return g;
}

// ===========================================================================
// Host aggregation + economy
// ===========================================================================

function buildPub(): PubState {
  return {
    phase: (screen === "connecting" ? "lobby" : screen) as Phase,
    n: N, fleet: FLEET.slice(), turn: host.turn,
    p1Name: myName, p2Id: host.p2Id, p2Name: host.p2Name,
    g1: host.g1.join(""), g2: host.g2.join(""),
    sunk1: host.sunk1.slice(), sunk2: host.sunk2.slice(),
    res1: host.res1, res2: host.res2, winner: host.winner,
  };
}
function broadcast(): void { pub = buildPub(); net?.state(pub); }

const hRes = (p: 1 | 2) => (p === 1 ? host.res1 : host.res2);
const setHRes = (p: 1 | 2, v: number) => { if (p === 1) host.res1 = v; else host.res2 = v; };

function passTurn(nt: 1 | 2): void {
  if (host.winner) return;
  if (nt !== host.turn) setHRes(nt, hRes(nt) + INCOME);
  host.turn = nt;
}

function resetHostBoards(keepOpponent: boolean): void {
  host.g1.fill(0); host.g2.fill(0);
  host.sunk1 = []; host.sunk2 = [];
  host.res1 = host.res2 = START_RES;
  host.turn = 1; host.winner = 0;
  host.hostReady = false; host.pendingFire = false;
  host.mines1.clear();
  botQueue.length = 0;
  if (!keepOpponent) {
    host.p2Id = ""; host.p2Name = "Player 2"; host.botShips = null; host.oppReady = false;
  } else {
    host.oppReady = host.p2Id === BOT;
    if (host.p2Id === BOT) host.botShips = randomBoard();
  }
}

function applyAction(board: 1 | 2, actor: 1 | 2, kind: Kind, r: Resolved): void {
  const g = board === 1 ? host.g1 : host.g2;
  for (const c of r.hit) if (g[c] < 2) g[c] = 2;
  for (const c of r.miss) if (g[c] === 0) g[c] = 1;
  for (const grp of r.sunk) { for (const c of grp) g[c] = 3; (board === 1 ? host.sunk1 : host.sunk2).push(grp.length); }
  for (const c of r.detect) if (g[c] === 0) g[c] = 4;
  for (const c of r.mine) g[c] = 5;

  setHRes(actor, hRes(actor) + r.hit.length * HIT_BONUS + r.sunk.length * SINK_BONUS);

  const dead = g.reduce((n, v) => n + (v === 2 || v === 3 ? 1 : 0), 0) >= TOTAL;
  if (dead) {
    host.winner = actor; screen = "gameover"; host.turn = actor;
  } else if (r.mine.length) {
    setHRes(board, hRes(board) + MINE_BONUS); // mine owner gets paid, shooter's turn ends
    passTurn(board);
  } else {
    passTurn(kind === "shot" && r.hit.length > 0 ? actor : actor === 1 ? 2 : 1);
  }
  broadcast();
  if (host.winner) net?.over(host.winner);
}

function applyOwn(actor: 1 | 2, kind: Kind, x: number, y: number): void {
  const g = actor === 1 ? host.g1 : host.g2;
  const i = ix(x, y);
  if (kind === "repair") { if (g[i] === 2) g[i] = 0; }
  else if (kind === "mine" && actor === 1) host.mines1.add(i); // P2 mines are kept on P2
  passTurn(actor === 1 ? 2 : 1);
  broadcast();
}

/** Single host-side authority for every action by either player. */
function hostAct(actor: 1 | 2, kind: Kind, x: number, y: number): void {
  if (host.winner || screen !== "battle" || host.turn !== actor || host.pendingFire) return;
  const cost = COST[kind];
  if (hRes(actor) < cost) return;
  setHRes(actor, hRes(actor) - cost);

  if (kind === "repair" || kind === "mine") { applyOwn(actor, kind, x, y); return; }

  const targetBoard = actor === 1 ? 2 : 1;
  const tg = targetBoard === 1 ? host.g1 : host.g2;
  const fireable = kind === "radar" ? (c: number) => tg[c] === 0 : (c: number) => tg[c] === 0 || tg[c] === 4;
  const cells = expand(kind, x, y).filter(fireable);
  if (!cells.length) { setHRes(actor, hRes(actor) + cost); return; } // refund a dud

  if (targetBoard === 1) {
    const r = resolveArea(host.p1Ships, (c) => tg[c] === 2 || tg[c] === 3, host.mines1, cells, kind);
    applyAction(1, actor, kind, r);
  } else if (host.botShips) {
    const r = resolveArea(host.botShips, (c) => tg[c] === 2 || tg[c] === 3, EMPTY, cells, kind);
    applyAction(2, actor, kind, r);
  } else if (host.p2Id) {
    host.pendingFire = true;
    net?.resolve(host.p2Id, kind, cells);
  }
}
const EMPTY = new Set<number>();

function startIfReady(): void {
  if (screen === "battle" || screen === "gameover") return;
  if (host.hostReady && host.oppReady) {
    screen = "battle"; host.turn = 1;
    host.res1 = host.res2 = START_RES;
    broadcast();
  }
}

function botStep(dt: number): void {
  if (host.winner || screen !== "battle" || host.p2Id !== BOT || host.turn !== 2) { botTimer = 0; return; }
  botTimer += dt;
  if (botTimer < BOT_DELAY) return;
  botTimer = 0;
  let target = -1;
  while (botQueue.length) { const c = botQueue.pop()!; if (host.g1[c] === 0) { target = c; break; } }
  if (target < 0) {
    const free: number[] = [];
    for (let c = 0; c < CELLS; c++) { const x = c % N, y = (c / N) | 0; if (host.g1[c] === 0 && (x + y) % 2 === 0) free.push(c); }
    if (!free.length) for (let c = 0; c < CELLS; c++) if (host.g1[c] === 0) free.push(c);
    if (!free.length) return;
    target = free[(Math.random() * free.length) | 0];
  }
  const tx = target % N, ty = (target / N) | 0;
  const r = resolveArea(host.p1Ships, (c) => host.g1[c] === 2 || host.g1[c] === 3, host.mines1, [target], "shot");
  if (r.hit.length && !r.sunk.length) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inB(tx + dx, ty + dy) && host.g1[ix(tx + dx, ty + dy)] === 0) botQueue.push(ix(tx + dx, ty + dy));
  } else if (r.sunk.length) botQueue.length = 0;
  applyAction(1, 2, "shot", r);
}

// ===========================================================================
// Placement
// ===========================================================================

function placedSet(): Set<number> {
  const s = new Set<number>();
  for (const cells of placed) for (const c of cells) s.add(c);
  return s;
}
const placeValid = (cells: number[] | null, taken: Set<number>) => !!cells && cells.every((c) => !taken.has(c));
function tryPlace(x: number, y: number): void {
  if (placed.length >= FLEET.length) return;
  const cells = cellsFor(FLEET[placed.length], x, y, placeHoriz);
  if (placeValid(cells, placedSet())) { placed.push(cells!); sfx.play("place"); }
}
function randomizePlacement(): void {
  placed.length = 0;
  const g = randomBoard();
  for (let s = 1; s <= FLEET.length; s++) {
    const cells: number[] = [];
    for (let c = 0; c < CELLS; c++) if (g[c] === s) cells.push(c);
    placed.push(cells);
  }
  sfx.play("place");
}
function clearPlacement(): void { placed.length = 0; sfx.play("click"); }
function buildMyShips(): number[] {
  const g = new Array(CELLS).fill(0);
  placed.forEach((cells, i) => { for (const c of cells) g[c] = i + 1; });
  return g;
}
function confirmReady(): void {
  if (placed.length < FLEET.length || myReady) return;
  myShips = buildMyShips();
  myReady = true;
  sfx.play("turn");
  if (role === "host") { host.p1Ships = myShips; host.hostReady = true; startIfReady(); }
  else net?.ready();
}
function playVsCpu(): void {
  if (role !== "host" || host.p2Id) return;
  host.p2Id = BOT; host.p2Name = "CPU"; host.botShips = randomBoard(); host.oppReady = true;
  sfx.play("click"); broadcast(); startIfReady();
}

// ===========================================================================
// Firing / own-board actions
// ===========================================================================

const ownGrid = () => (myNo === 2 ? pub.g2 : pub.g1);
const enemyGrid = () => (myNo === 2 ? pub.g1 : pub.g2);

function fireEnemy(x: number, y: number): void {
  if (screen !== "battle" || curWinner() || myNo === 0 || curTurn() !== myNo) return;
  if (myNo === 1 && host.pendingFire) return;
  const center = strCell(enemyGrid(), ix(x, y));
  if (center !== 0 && center !== 4) return; // can target unknown OR radar-detected (bug fix)

  let kind: Kind = "shot";
  if (armed === "airstrike" || armed === "radar") {
    if (resOf(myNo) < COST[armed]) return;
    kind = armed;
  }
  armed = "shot";
  sfx.play(kind === "radar" ? "click" : "fire");
  if (myNo === 1) hostAct(1, kind, x, y);
  else net?.fire(hostId, kind, x, y);
}

function ownAction(x: number, y: number): void {
  if (screen !== "battle" || curWinner() || myNo === 0 || curTurn() !== myNo) return;
  const kind = armed;
  if (kind !== "repair" && kind !== "mine") return;
  if (resOf(myNo) < COST[kind]) return;
  const i = ix(x, y);
  const og = ownGrid();
  if (kind === "repair") {
    if (strCell(og, i) !== 2) return; // only a damaged ship cell
  } else {
    const mineSet = myNo === 1 ? host.mines1 : myMines;
    if (strCell(og, i) !== 0 || myShips[i] !== 0 || mineSet.has(i)) return; // own empty water only
    if (myNo === 2) myMines.add(i);
  }
  armed = "shot";
  sfx.play("place");
  if (myNo === 1) hostAct(1, kind, x, y);
  else net?.fire(hostId, kind, x, y);
}

// ===========================================================================
// Effects
// ===========================================================================

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; }
const particles: Particle[] = [];
function burst(x: number, y: number, color: string, n: number, speed: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, max: 0.4 + Math.random() * 0.45, color, size: 2 + Math.random() * 3 });
  }
  if (particles.length > 480) particles.splice(0, particles.length - 480);
}
function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt / p.max;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; p.vx *= 1 - dt * 1.2;
  }
}
function drawParticles(): void {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    const s = p.size * (0.4 + p.life * 0.6);
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}
function geoForBoard(b: 1 | 2): Geo | null {
  if (myNo === 0) return b === 1 ? geoOwn : geoEnemy;
  return b === myNo ? geoOwn : geoEnemy;
}
function diffFx(): void {
  const sig = { mine: false, sunk: false, hit: false, detect: false, miss: false };
  const scan = (b: 1 | 2, prev: string, cur: string) => {
    if (prev.length !== cur.length) return;
    const geo = geoForBoard(b);
    for (let i = 0; i < cur.length; i++) {
      if (prev.charCodeAt(i) === cur.charCodeAt(i)) continue;
      const v = strCell(cur, i);
      if (geo) {
        const cx = geo.x + (i % N) * geo.cell + geo.cell / 2;
        const cy = geo.y + ((i / N) | 0) * geo.cell + geo.cell / 2;
        if (v === 5) burst(cx, cy, COL.mine, 28, 280);
        else if (v === 3) burst(cx, cy, COL.sunk, 22, 240);
        else if (v === 2) burst(cx, cy, COL.hit, 14, 200);
        else if (v === 4) burst(cx, cy, COL.detect, 6, 90);
        else if (v === 1) burst(cx, cy, "#9fc4d8", 6, 100);
      }
      if (v === 5) sig.mine = true;
      else if (v === 3) sig.sunk = true;
      else if (v === 2) sig.hit = true;
      else if (v === 4) sig.detect = true;
      else if (v === 1) sig.miss = true;
    }
  };
  scan(1, prevG1, pub.g1);
  scan(2, prevG2, pub.g2);
  prevG1 = pub.g1; prevG2 = pub.g2;
  if (sig.mine) sfx.play("sunk");
  else if (sig.sunk) sfx.play("sunk");
  else if (sig.hit) sfx.play("hit");
  else if (sig.miss) sfx.play("miss");
  else if (sig.detect) sfx.play("click");
}

// ===========================================================================
// Rendering
// ===========================================================================

interface Geo { x: number; y: number; cell: number; }
let geoOwn: Geo | null = null;
let geoEnemy: Geo | null = null;
const clickables: { x: number; y: number; w: number; h: number; act: () => void }[] = [];

function resize(): void {
  const size = configureCanvas(canvas, { width: window.innerWidth, height: window.innerHeight }, { pixelPerfect: true });
  w = size.width; h = size.height;
}
function roundRect(x: number, y: number, ww: number, hh: number, r: number): void { ctx.beginPath(); ctx.roundRect(x, y, ww, hh, r); }

function drawWater(): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, COL.water1); g.addColorStop(1, COL.water0);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.045; ctx.strokeStyle = "#8fd6ff"; ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const yy = ((anim * 18 + i * 130) % (h + 130)) - 65;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 24) { const oy = Math.sin(x * 0.018 + anim * 1.4 + i) * 6; if (x === 0) ctx.moveTo(x, yy + oy); else ctx.lineTo(x, yy + oy); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function shipRectFor(cells: number[]) {
  let a = N, b = N, c = 0, d = 0;
  for (const e of cells) { const x = e % N, y = (e / N) | 0; a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return { x: a, y: b, w: c - a + 1, h: d - b + 1 };
}
function drawHull(geo: Geo, cells: number[]): void {
  const r = shipRectFor(cells), cell = geo.cell;
  const x = geo.x + r.x * cell + 2, y = geo.y + r.y * cell + 2, ww = r.w * cell - 4, hh = r.h * cell - 4;
  ctx.fillStyle = COL.shipMine;
  roundRect(x, y, ww, hh, Math.min(ww, hh) * 0.3); ctx.fill();
  ctx.fillStyle = COL.shipTop; ctx.globalAlpha = 0.5;
  if (ww >= hh) roundRect(x + 2, y + 2, ww - 4, Math.max(2, hh * 0.3), hh * 0.2);
  else roundRect(x + 2, y + 2, Math.max(2, ww * 0.3), hh - 4, ww * 0.2);
  ctx.fill(); ctx.globalAlpha = 1;
}

function drawBoard(geo: Geo, grid: string, ships: number[] | null, ownMines: Set<number> | null, live: boolean, label: string, accent: string): void {
  const { x: ox, y: oy, cell } = geo;
  const size = cell * N;
  ctx.save();
  if (live) { ctx.shadowColor = accent; ctx.shadowBlur = 20; }
  ctx.fillStyle = "rgba(6,22,33,0.85)";
  roundRect(ox - 5, oy - 5, size + 10, size + 10, 10); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = live ? accent : COL.frame; ctx.lineWidth = live ? 2 : 1;
  roundRect(ox - 5, oy - 5, size + 10, size + 10, 10); ctx.stroke(); ctx.lineWidth = 1;

  if (live && ctx.createConicGradient) {
    ctx.save(); roundRect(ox, oy, size, size, 4); ctx.clip();
    const cx = ox + size / 2, cy = oy + size / 2;
    const grad = ctx.createConicGradient(anim * 1.6, cx, cy);
    grad.addColorStop(0, "rgba(34,211,238,0.16)"); grad.addColorStop(0.08, "rgba(34,211,238,0)"); grad.addColorStop(1, "rgba(34,211,238,0)");
    ctx.fillStyle = grad; ctx.fillRect(ox, oy, size, size); ctx.restore();
  }

  if (ships) for (let s = 1; s <= FLEET.length; s++) {
    const cells: number[] = [];
    for (let c = 0; c < CELLS; c++) if (ships[c] === s) cells.push(c);
    if (cells.length) drawHull(geo, cells);
  }

  ctx.strokeStyle = COL.grid; ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + size);
    ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + size, oy + i * cell);
  }
  ctx.stroke();

  // sparse coordinate ticks
  ctx.fillStyle = "rgba(160,200,220,0.38)";
  ctx.font = `${Math.max(8, cell * 0.42) | 0}px ui-monospace, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const step = N > 24 ? 5 : N > 14 ? 2 : 1;
  for (let i = 0; i < N; i += step) {
    ctx.fillText(String(i + 1), ox + i * cell + cell / 2, oy - 11);
    ctx.fillText(String(i + 1), ox - 12, oy + i * cell + cell / 2);
  }
  ctx.textBaseline = "alphabetic";

  // own un-sprung mines (only the owner sees them)
  if (ownMines) for (const c of ownMines) {
    if (strCell(grid, c) === 5) continue;
    const mx = ox + (c % N) * cell + cell / 2, my = oy + ((c / N) | 0) * cell + cell / 2;
    ctx.fillStyle = COL.mine; ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(mx, my - cell * 0.22); ctx.lineTo(mx + cell * 0.22, my); ctx.lineTo(mx, my + cell * 0.22); ctx.lineTo(mx - cell * 0.22, my);
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }

  for (let c = 0; c < CELLS; c++) {
    const v = strCell(grid, c);
    if (!v) continue;
    const mx = ox + (c % N) * cell + cell / 2, my = oy + ((c / N) | 0) * cell + cell / 2;
    if (v === 1) { ctx.fillStyle = "#6f93a6"; ctx.beginPath(); ctx.arc(mx, my, cell * 0.12, 0, Math.PI * 2); ctx.fill(); }
    else if (v === 2) { ctx.save(); ctx.shadowColor = COL.hit; ctx.shadowBlur = 8; ctx.fillStyle = COL.hit; ctx.beginPath(); ctx.arc(mx, my, cell * 0.24, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    else if (v === 3) {
      ctx.fillStyle = COL.sunk; roundRect(ox + (c % N) * cell + 2, oy + ((c / N) | 0) * cell + 2, cell - 4, cell - 4, 3); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = Math.max(1.5, cell * 0.08);
      ctx.beginPath(); ctx.moveTo(mx - cell * 0.18, my - cell * 0.18); ctx.lineTo(mx + cell * 0.18, my + cell * 0.18); ctx.moveTo(mx + cell * 0.18, my - cell * 0.18); ctx.lineTo(mx - cell * 0.18, my + cell * 0.18); ctx.stroke(); ctx.lineWidth = 1;
    } else if (v === 4) {
      const pulse = 0.5 + 0.5 * Math.sin(anim * 5 + c);
      ctx.strokeStyle = COL.detect; ctx.globalAlpha = 0.5 + pulse * 0.4; ctx.lineWidth = Math.max(1.5, cell * 0.08);
      ctx.beginPath(); ctx.arc(mx, my, cell * 0.28, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1;
    } else if (v === 5) {
      ctx.save(); ctx.shadowColor = COL.mine; ctx.shadowBlur = 10; ctx.fillStyle = COL.mine;
      ctx.beginPath(); ctx.arc(mx, my, cell * 0.26, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }

  ctx.fillStyle = accent; ctx.font = "700 12px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(label, ox + size / 2, oy + size + 22);
}

function drawShipPips(cx: number, y: number, sunkCount: number, color: string, align: "left" | "right"): void {
  const dir = align === "left" ? 1 : -1;
  let x = cx;
  const n = Math.min(FLEET.length, 14);
  for (let i = 0; i < n; i++) {
    const dead = i < sunkCount;
    ctx.fillStyle = dead ? "rgba(255,255,255,0.16)" : color;
    const ww = 4 + FLEET[i] * 1.6;
    roundRect(align === "left" ? x : x - ww, y, ww, 6, 3); ctx.fill();
    x += dir * (ww + 4);
  }
}

function drawPanel(side: 1 | 2, name: string, sunkCount: number, res: number, active: boolean): void {
  const color = side === 1 ? COL.p1 : COL.p2;
  const left = side === 1;
  const pw = 210, ph = 56, px = left ? 16 : w - 16 - pw, py = 12;
  ctx.save();
  if (active) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
  ctx.fillStyle = COL.panel; roundRect(px, py, pw, ph, 12); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = active ? color : "rgba(255,255,255,0.06)"; roundRect(px, py, pw, ph, 12); ctx.stroke();
  ctx.fillStyle = color; roundRect(left ? px : px + pw - 5, py + 8, 5, ph - 16, 3); ctx.fill();
  ctx.fillStyle = COL.text; ctx.font = "700 14px system-ui, sans-serif"; ctx.textAlign = left ? "left" : "right"; ctx.textBaseline = "alphabetic";
  ctx.fillText(name.slice(0, 14), left ? px + 14 : px + pw - 14, py + 21);
  // credits
  ctx.fillStyle = COL.credit; ctx.font = "700 12px system-ui, sans-serif";
  ctx.textAlign = left ? "left" : "right";
  ctx.fillText(`◆ ${res}`, left ? px + 14 : px + pw - 14, py + 49);
  drawShipPips(left ? px + 60 : px + pw - 60, left ? py + 42 : py + 42, sunkCount, color, left ? "left" : "right");
}

function statusLine(): string {
  if (screen === "gameover") { const win = curWinner(); if (myNo === 0) return `${win === 1 ? pub.p1Name : pub.p2Name} wins`; return win === myNo ? "Victory!" : "Defeated"; }
  const t = curTurn();
  if (myNo === 0) return `${t === 1 ? pub.p1Name : pub.p2Name}'s turn`;
  return t === myNo ? "Your turn" : "Enemy turn";
}

function drawButton(x: number, y: number, ww: number, hh: number, label: string, accent: string, enabled: boolean, act: () => void, armedOn = false): void {
  roundRect(x, y, ww, hh, hh / 2);
  if (armedOn) { ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 18; ctx.fillStyle = accent; ctx.fill(); ctx.restore(); ctx.fillStyle = "#06121c"; }
  else if (enabled) { ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fill(); ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = accent; }
  else { ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fill(); ctx.fillStyle = "rgba(255,255,255,0.25)"; }
  if (enabled) clickables.push({ x, y, w: ww, h: hh, act });
  ctx.font = "700 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, x + ww / 2, y + hh / 2 + 1); ctx.textBaseline = "alphabetic";
}

const SHOP: { kind: Kind; label: string; col: string }[] = [
  { kind: "shot", label: "Fire", col: COL.accent },
  { kind: "airstrike", label: "Airstrike", col: "#f59e0b" },
  { kind: "radar", label: "Radar", col: COL.detect },
  { kind: "repair", label: "Repair", col: "#4ade80" },
  { kind: "mine", label: "Mine", col: COL.mine },
];

function drawShop(): void {
  if (myNo === 0 || screen !== "battle" || curWinner() || curTurn() !== myNo) return;
  const bw = 116, bh = 38, gap = 8;
  const total = SHOP.length * bw + (SHOP.length - 1) * gap;
  let x = w / 2 - total / 2;
  const y = h - 52;
  const res = resOf(myNo);
  for (const a of SHOP) {
    const cost = COST[a.kind];
    const label = cost ? `${a.label} ◆${cost}` : a.label;
    const enabled = res >= cost;
    drawButton(x, y, bw, bh, label, a.col, enabled, () => {
      armed = a.kind === "shot" ? "shot" : armed === a.kind ? "shot" : a.kind;
      sfx.play("click");
    }, armed === a.kind);
    x += bw + gap;
  }
  ctx.fillStyle = COL.sub; ctx.font = "11px system-ui, sans-serif"; ctx.textAlign = "center";
  const hint =
    armed === "airstrike" ? "Airstrike armed — click the enemy grid (3×3)" :
    armed === "radar" ? "Radar armed — click the enemy grid to scan (5×5)" :
    armed === "repair" ? "Repair armed — click one of YOUR damaged cells" :
    armed === "mine" ? "Mine armed — click YOUR empty water to lay it" :
    "Fire at the enemy grid, or buy an action";
  ctx.fillText(hint, w / 2, y - 10);
}

function layoutBattle(): void {
  const top = 90, bottom = 96, gap = 40;
  const availW = (w - gap - 80) / 2;
  const cell = Math.max(8, Math.floor(Math.min(availW / N, (h - top - bottom) / N)));
  const size = cell * N;
  const ox = Math.floor((w - (size * 2 + gap)) / 2), oy = top;
  geoOwn = { x: ox, y: oy, cell };
  geoEnemy = { x: ox + size + gap, y: oy, cell };
}

function drawBattle(): void {
  clickables.length = 0;
  layoutBattle();
  const ownStr = myNo === 0 ? pub.g1 : ownGrid();
  const enemyStr = myNo === 0 ? pub.g2 : enemyGrid();
  const ownShips = myNo === 0 ? null : myShips;
  const ownMines = myNo === 0 ? null : myNo === 1 ? host.mines1 : myMines;
  const myTurn = myNo !== 0 && curTurn() === myNo && !curWinner();

  drawBoard(geoOwn!, ownStr, ownShips, ownMines, false, myNo === 0 ? pub.p1Name : "YOUR FLEET", COL.p1);
  drawBoard(geoEnemy!, enemyStr, null, null, myTurn && armed !== "repair" && armed !== "mine", myNo === 0 ? pub.p2Name : "ENEMY WATERS", COL.p2);

  drawPanel(1, pub.p1Name, pub.sunk1.length, pub.res1, curTurn() === 1 && !curWinner());
  drawPanel(2, pub.p2Id ? (pub.p2Id === BOT ? "CPU" : pub.p2Name) : "—", pub.sunk2.length, pub.res2, curTurn() === 2 && !curWinner());

  ctx.fillStyle = myTurn ? COL.accent : COL.sub; ctx.font = "800 17px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(statusLine(), w / 2, 38);
  drawShop();
}

function drawGameover(): void {
  drawBattle();
  ctx.fillStyle = "rgba(4,14,22,0.74)"; ctx.fillRect(0, 0, w, h);
  const win = curWinner(), youWon = win === myNo && myNo !== 0, accent = win === 1 ? COL.p1 : COL.p2;
  ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 26; ctx.fillStyle = accent;
  ctx.font = "800 44px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(myNo === 0 ? `${win === 1 ? pub.p1Name : pub.p2Name} wins` : youWon ? "Victory!" : "Defeated", w / 2, h / 2 - 16);
  ctx.restore(); ctx.textBaseline = "alphabetic";
  clickables.length = 0;
  if (role === "host") drawButton(w / 2 - 90, h / 2 + 16, 180, 42, "Rematch", COL.accent, true, rematch);
  else { ctx.fillStyle = COL.sub; ctx.font = "14px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Waiting for the host…", w / 2, h / 2 + 36); }
}

function drawGhost(geo: Geo): void {
  if (placed.length >= FLEET.length || hover < 0) return;
  const cells = cellsFor(FLEET[placed.length], hover % N, (hover / N) | 0, placeHoriz);
  ctx.fillStyle = placeValid(cells, placedSet()) ? "rgba(56,189,248,0.5)" : "rgba(248,113,113,0.5)";
  for (const c of cells ?? [hover]) ctx.fillRect(geo.x + (c % N) * geo.cell + 1, geo.y + ((c / N) | 0) * geo.cell + 1, geo.cell - 2, geo.cell - 2);
}
function drawTray(x: number, y: number): void {
  ctx.fillStyle = COL.text; ctx.font = "700 12px system-ui, sans-serif"; ctx.textAlign = "left";
  ctx.fillText(`FLEET (${placed.length}/${FLEET.length})`, x, y - 10);
  const rows = Math.min(FLEET.length, 12);
  for (let i = 0; i < rows; i++) {
    const ry = y + i * 22;
    const done = i < placed.length, current = i === placed.length;
    ctx.fillStyle = done ? "rgba(56,189,248,0.85)" : current ? COL.accent : "rgba(255,255,255,0.18)";
    roundRect(x, ry, FLEET[i] * 13, 12, 4); ctx.fill();
    ctx.fillStyle = done ? COL.sub : current ? COL.text : COL.sub; ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(done ? "✓" : current ? "◀" : `${FLEET[i]}`, x + FLEET[i] * 13 + 8, ry + 10);
  }
}
function drawPlacement(): void {
  clickables.length = 0;
  ctx.fillStyle = COL.text; ctx.font = "800 22px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`Deploy your fleet · ${N}×${N}`, w / 2, 36);

  const top = 58, bottom = 120, trayW = 120;
  const cell = Math.max(8, Math.floor(Math.min((w - trayW - 90) / N, (h - top - bottom) / N)));
  const size = cell * N;
  const ox = Math.floor((w - size - trayW) / 2) + 10, oy = top + 8;
  geoOwn = { x: ox, y: oy, cell }; geoEnemy = null;

  drawBoard(geoOwn, "0".repeat(CELLS), buildMyShips(), null, false, "YOUR WATERS", COL.p1);
  drawGhost(geoOwn);
  drawTray(ox + size + 36, oy + 14);

  ctx.fillStyle = COL.sub; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`R / right-click rotates (${placeHoriz ? "horizontal" : "vertical"})`, w / 2, oy + size + 22);
  const oppTxt = role === "host" ? (host.p2Id === BOT ? "Opponent: CPU" : host.p2Id ? `Opponent: ${host.p2Name}` : "Waiting for a player…") : "Opponent: host";
  ctx.fillText(myReady && host.p2Id ? "Ready — waiting for opponent…" : oppTxt, w / 2, oy + size + 42);

  const by = oy + size + 56, bw = 118, bh = 36, gap = 10;
  const allPlaced = placed.length >= FLEET.length;
  let count = 3; if (role === "host" && !host.p2Id) count = 4;
  let bx = w / 2 - (count * bw + (count - 1) * gap) / 2;
  drawButton(bx, by, bw, bh, "Randomize", COL.accent, !myReady, randomizePlacement); bx += bw + gap;
  drawButton(bx, by, bw, bh, "Clear", COL.sub, !myReady, clearPlacement); bx += bw + gap;
  drawButton(bx, by, bw, bh, myReady ? "Ready ✓" : "Ready", COL.p1, allPlaced && !myReady, confirmReady); bx += bw + gap;
  if (role === "host" && !host.p2Id) drawButton(bx, by, bw, bh, "Play vs CPU", "#a3e635", true, playVsCpu);
}

function drawLobby(): void {
  clickables.length = 0;
  ctx.fillStyle = COL.text; ctx.font = "800 30px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("Sea Battle", w / 2, h / 2 - 110);
  if (role !== "host") {
    ctx.fillStyle = COL.sub; ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("Host is choosing the battlefield…", w / 2, h / 2);
    return;
  }
  ctx.fillStyle = COL.sub; ctx.font = "700 12px system-ui, sans-serif";
  ctx.fillText("BATTLEFIELD SIZE", w / 2, h / 2 - 60);
  const bw = 110, bh = 56, gap = 16;
  let x = w / 2 - (SIZES.length * bw + (SIZES.length - 1) * gap) / 2;
  for (const s of SIZES) {
    drawButton(x, h / 2 - 44, bw, bh, `${s}×${s}`, COL.accent, true, () => { setBoard(s); sfx.play("click"); broadcast(); }, N === s);
    x += bw + gap;
  }
  ctx.fillStyle = COL.sub; ctx.font = "13px system-ui, sans-serif";
  ctx.fillText(`Fleet: ${FLEET.length} ships · ${TOTAL} cells`, w / 2, h / 2 + 40);
  drawButton(w / 2 - 100, h / 2 + 64, 200, 44, "Deploy fleet", COL.p1, true, () => { screen = "placement"; broadcast(); });
}

function render(dt: number): void {
  anim += dt;
  drawWater();
  if (screen === "connecting") { ctx.fillStyle = COL.text; ctx.font = "700 22px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Connecting…", w / 2, h / 2); return; }
  if (screen === "lobby") { drawLobby(); return; }
  if (screen === "placement") {
    if (myNo === 0) { ctx.fillStyle = COL.text; ctx.font = "700 22px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("Players are deploying…", w / 2, h / 2); return; }
    drawPlacement(); return;
  }
  if (screen === "gameover") drawGameover(); else drawBattle();
  updateParticles(dt); diffFx(); drawParticles();

  const win = curWinner();
  if (win && win !== prevWinnerSnd) { prevWinnerSnd = win; if (myNo === 0) sfx.play("win"); else sfx.play(win === myNo ? "win" : "lose"); }
  else if (!win) prevWinnerSnd = 0;
  const t = curTurn();
  if (screen === "battle" && t !== prevTurnSnd) { if (prevTurnSnd !== 0 && myNo !== 0 && t === myNo) sfx.play("turn"); prevTurnSnd = t; }
}

// ===========================================================================
// Input
// ===========================================================================

function gameCoords(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (w / Math.max(1, rect.width)), y: (e.clientY - rect.top) * (h / Math.max(1, rect.height)) };
}
function cellAt(geo: Geo | null, gx: number, gy: number): number {
  if (!geo) return -1;
  const cx = Math.floor((gx - geo.x) / geo.cell), cy = Math.floor((gy - geo.y) / geo.cell);
  return inB(cx, cy) ? ix(cx, cy) : -1;
}
function onPointerDown(e: PointerEvent): void {
  sfx?.unlock();
  const { x, y } = gameCoords(e);
  for (const c of clickables) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) { c.act(); return; }
  if (screen === "placement" && myNo !== 0 && !myReady) {
    const c = cellAt(geoOwn, x, y);
    if (c >= 0) { if (e.button === 2) { placeHoriz = !placeHoriz; return; } tryPlace(c % N, (c / N) | 0); }
  } else if (screen === "battle") {
    if (armed === "repair" || armed === "mine") { const c = cellAt(geoOwn, x, y); if (c >= 0) ownAction(c % N, (c / N) | 0); }
    else { const c = cellAt(geoEnemy, x, y); if (c >= 0) fireEnemy(c % N, (c / N) | 0); }
  }
}
function onPointerMove(e: PointerEvent): void {
  if (screen !== "placement" || myNo === 0 || myReady) { hover = -1; return; }
  const { x, y } = gameCoords(e);
  hover = cellAt(geoOwn, x, y);
}
function onKeydown(e: KeyboardEvent): void {
  sfx?.unlock();
  const k = e.key.toLowerCase();
  if (screen === "placement" && myNo !== 0) {
    if (k === "r") placeHoriz = !placeHoriz;
    else if (k === "enter") confirmReady();
    else if (k === "backspace") { placed.pop(); sfx.play("click"); }
  } else if (screen === "battle" && myNo !== 0) {
    if (k === "escape") armed = "shot";
    else if (k === "a") armed = armed === "airstrike" ? "shot" : "airstrike";
    else if (k === "v") armed = armed === "radar" ? "shot" : "radar";
    else if (k === "e") armed = armed === "repair" ? "shot" : "repair";
    else if (k === "m") armed = armed === "mine" ? "shot" : "mine";
  } else if (screen === "gameover" && role === "host" && (k === "enter" || k === " ")) rematch();
}
function rematch(): void {
  if (role !== "host") return;
  resetHostBoards(true);
  placed.length = 0; myReady = false; myMines.clear();
  screen = "placement"; prevWinnerSnd = 0; prevTurnSnd = 0; particles.length = 0; prevG1 = ""; prevG2 = ""; armed = "shot";
  broadcast();
}

// ===========================================================================
// Networking
// ===========================================================================

async function refreshPlayers(): Promise<void> {
  if (!client) return;
  try {
    const { participants } = await client.getParticipants();
    for (const p of participants) players.set(p.ephemeralId, p.displayName);
    if (host.p2Id && host.p2Id !== BOT) host.p2Name = players.get(host.p2Id) ?? "Player 2";
  } catch { /* not connected yet */ }
}

function applyState(from: string, s: PubState): void {
  hostId = hostId || from;
  const prevPhase = pub.phase;
  pub = s;
  if (s.n !== N) setBoard(s.n, s.fleet);
  if (role !== "host") {
    if (s.p2Id === myId) { if (myNo !== 2) { myNo = 2; role = "player"; } }
    else { myNo = 0; role = "watcher"; }
    if (s.phase === "battle") screen = "battle";
    else if (s.phase === "gameover") screen = "gameover";
    else if (s.phase === "placement") {
      if (prevPhase === "gameover" || prevPhase === "battle") { placed.length = 0; myReady = false; myMines.clear(); armed = "shot"; prevG1 = ""; prevG2 = ""; }
      screen = "placement";
    } else screen = "lobby";
  }
}

async function connectToHost(loop: ReturnType<typeof createFrameLoop>): Promise<void> {
  const c = new PlayFrameClient({
    game: { id: "battleship", version: "1.0.0", title: "Sea Battle" },
    permissions: ["keyboard", "audio", "networking"],
    layout: { mode: "responsive" },
  });
  client = c;
  c.on("terminate", () => { loop.stop(); sfx.dispose(); });
  c.on("peerLeft", ({ peerId }) => {
    if (role === "host") {
      if (peerId === host.p2Id) {
        host.p2Id = BOT; host.p2Name = "CPU"; host.botShips = randomBoard(); host.oppReady = true; host.pendingFire = false;
        broadcast(); startIfReady();
      }
    } else if (peerId === hostId) {
      role = "host"; myNo = 1; hostId = "";
      resetHostBoards(false); placed.length = 0; myReady = false; myMines.clear(); screen = "lobby"; broadcast();
    }
  });

  net = createNet(c, {
    onHello: () => { if (role === "host") void refreshPlayers(); },
    onClaim: (from) => {
      if (role !== "host" || host.p2Id) return;
      if (screen === "lobby" || screen === "placement") {
        host.p2Id = from; host.oppReady = false;
        void refreshPlayers().then(broadcast);
        broadcast();
      }
    },
    onReady: (from) => { if (role === "host" && from === host.p2Id) { host.oppReady = true; startIfReady(); } },
    onFire: (from, kind, x, y) => { if (role === "host" && from === host.p2Id) hostAct(2, kind, x, y); },
    onResolve: (from, kind, cells) => {
      if (from !== hostId || myNo !== 2) return;
      const r = resolveArea(myShips, (cc) => strCell(pub.g2, cc) === 2 || strCell(pub.g2, cc) === 3, myMines, cells, kind);
      r.board = 2; r.kind = kind;
      net?.resolved(hostId, r);
    },
    onResolved: (from, r) => { if (role === "host" && from === host.p2Id) { host.pendingFire = false; applyAction(2, 1, r.kind, r); } },
    onState: applyState,
    onOver: (_from, winner) => { if (role !== "host") { pub = { ...pub, winner }; screen = "gameover"; } },
  });

  try {
    const ctx0 = await c.connect();
    myId = ctx0.user?.ephemeralId ?? "";
    myName = ctx0.user?.displayName ?? "You";
    const intent = c.getLaunch()?.intent ?? "new";
    await refreshPlayers();
    if (intent === "new") { role = "host"; myNo = 1; hostId = myId; resetHostBoards(false); screen = "lobby"; broadcast(); }
    else { role = "watcher"; myNo = 0; screen = "connecting"; net.hello(); net.claim(); }
    c.log("info", `Sea Battle connected as ${role}`);
  } catch (e) {
    console.warn("[battleship] connect failed, standalone:", e);
    role = "host"; myNo = 1; screen = "lobby";
  }
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
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  sfx = createSfx();
  const unlock = () => sfx.unlock();
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("pointerdown", unlock, { once: true });
  const loop = createFrameLoop((dt) => { if (role === "host") botStep(dt); render(dt); }, { targetFps: 60, pauseOnHidden: true });
  loop.start();
  if (isInPlayFrame()) void connectToHost(loop);
  else { role = "host"; myNo = 1; screen = "lobby"; }
}

startGame();
