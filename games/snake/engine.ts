/**
 * Snake engine — framework-agnostic port of the app's `useSnakeGame.ts`
 * composable (power-ups, flood-fill AI, particles, stacking effects, fog,
 * cached grid). Vue reactivity removed: HUD is drawn on the canvas and the
 * high score is persisted through an injected storage object.
 *
 * Self-contained: owns input + its own rAF loop. `pause()` / `resume()` let
 * the PlayFrame host freeze the game without losing state.
 */

// ==================== TYPES ====================

interface Point {
  x: number;
  y: number;
}

interface PowerUp extends Point {
  type: PowerUpType;
  spawnTime: number;
  duration: number;
}

type PowerUpType =
  | "apple"
  | "golden"
  | "heart"
  | "lightning"
  | "snail"
  | "diamond"
  | "fire"
  | "magnet"
  | "frenzy"
  | "mystery"
  | "scissors"
  | "shield"
  | "skull"
  | "bomb"
  | "reverse"
  | "blind"
  | "grow";

interface PowerUpConfig {
  emoji: string;
  color: string;
  rarity: number;
  points: number;
  effectDuration?: number;
  description: string;
  isDebuff?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface ActivePowerUp {
  type: string;
  emoji: string;
  timeLeft: number;
  stacks?: number;
}

type SnakeGameState = "menu" | "playing" | "paused" | "gameover";

/** Minimal storage contract (compatible with the SDK's createGameStorage). */
export interface SnakeStorage {
  get<T>(key: string, defaultValue?: T): T | undefined;
  set<T>(key: string, value: T): void;
}

export interface SnakeEngineOptions {
  storage?: SnakeStorage;
}

export interface SnakeEngine {
  destroy(): void;
  /** Freeze gameplay (host pause). */
  pause(): void;
  /** Resume after a host pause. */
  resume(): void;
}

// ==================== CONSTANTS ====================

const GRID_SIZE = 20;
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 680;
const GRID_WIDTH = CANVAS_WIDTH / GRID_SIZE;
const GRID_HEIGHT = CANVAS_HEIGHT / GRID_SIZE;
const HIGH_SCORE_KEY = "highscore";

const POWERUP_CONFIG: Record<PowerUpType, PowerUpConfig> = {
  apple: { emoji: "🍎", color: "#ef4444", rarity: 40, points: 10, description: "Points +10" },
  golden: { emoji: "🌟", color: "#fbbf24", rarity: 15, points: 25, effectDuration: 5000, description: "Ghost 5s (Stacks!)" },
  heart: { emoji: "❤️", color: "#ec4899", rarity: 12, points: 5, description: "Life +1" },
  lightning: { emoji: "⚡", color: "#3b82f6", rarity: 18, points: 15, effectDuration: 4000, description: "Speed 4s (Stacks!)" },
  snail: { emoji: "🐌", color: "#84cc16", rarity: 18, points: 20, effectDuration: 5000, description: "Slow down 5s" },
  diamond: { emoji: "💎", color: "#8b5cf6", rarity: 14, points: 30, effectDuration: 8000, description: "x2 points 8s (Stacks!)" },
  fire: { emoji: "🔥", color: "#f97316", rarity: 12, points: 0, description: "Shorten -3" },
  magnet: { emoji: "🧲", color: "#06b6d4", rarity: 14, points: 15, effectDuration: 6000, description: "Magnet 6s (Stacks!)" },
  frenzy: { emoji: "🎉", color: "#f472b6", rarity: 2, points: 50, effectDuration: 6000, description: "Fruit frenzy 6s" },
  mystery: { emoji: "📦", color: "#a855f7", rarity: 10, points: 0, description: "Random effect!" },
  scissors: { emoji: "✂️", color: "#10b981", rarity: 13, points: 20, description: "Cut -5 length" },
  shield: { emoji: "🛡️", color: "#eab308", rarity: 8, points: 15, effectDuration: 10000, description: "Debuff resist 10s" },
  skull: { emoji: "💀", color: "#71717a", rarity: 3, points: -20, description: "-1 life", isDebuff: true },
  bomb: { emoji: "💣", color: "#1f2937", rarity: 4, points: 0, description: "Explosion!", isDebuff: true },
  reverse: { emoji: "🔄", color: "#f472b6", rarity: 5, points: 5, effectDuration: 5000, description: "Reverse 5s", isDebuff: true },
  blind: { emoji: "🌫️", color: "#6b7280", rarity: 4, points: 10, effectDuration: 4000, description: "Fog 4s", isDebuff: true },
  grow: { emoji: "🌱", color: "#22c55e", rarity: 5, points: 5, description: "+5 length", isDebuff: true },
};

// ==================== ENGINE ====================

export function createSnakeEngine(
  canvas: HTMLCanvasElement,
  options: SnakeEngineOptions = {},
): SnakeEngine {
  const storage = options.storage;

  // HUD state (plain values; drawn on canvas)
  let gameState: SnakeGameState = "menu";
  let score = 0;
  let highScore = 0;
  let lives = 3;
  let level = 1;
  let activePowerUps: ActivePowerUp[] = [];

  // Internals
  let ctx: CanvasRenderingContext2D | null = null;
  let gameLoop: number | null = null;
  let snake: Point[] = [];
  let direction: Point = { x: 1, y: 0 };
  let inputQueue: Point[] = [];
  let powerUps: PowerUp[] = [];
  let particles: Particle[] = [];
  let baseSpeed = 120;

  let gridCanvas: HTMLCanvasElement | null = null;
  let gridCtx: CanvasRenderingContext2D | null = null;
  const MAX_PARTICLES = 50;
  let currentSpeed = 120;
  let lastMoveTime = 0;

  // Host pause (independent from the in-game P/Esc pause)
  let hostPaused = false;

  // Effects
  let isGhostMode = false;
  let ghostModeEndTime = 0;
  let ghostModeStacks = 0;
  let isSpeedBoost = false;
  let speedBoostEndTime = 0;
  let speedBoostStacks = 0;
  let isSlowMode = false;
  let slowModeEndTime = 0;
  let isDoublePoints = false;
  let doublePointsEndTime = 0;
  let doublePointsStacks = 0;
  let isMagnetMode = false;
  let magnetModeEndTime = 0;
  let magnetModeStacks = 0;
  let isFrenzyMode = false;
  let frenzyModeEndTime = 0;
  let frenzyUsedThisGame = false;
  let isReverseControls = false;
  let reverseControlsEndTime = 0;
  let isBlindMode = false;
  let blindModeEndTime = 0;
  let isShieldMode = false;
  let shieldModeEndTime = 0;
  let invincibilityEndTime = 0;

  let aiEnabled = false;

  // ==================== AI ====================

  function isAIEnabled(): boolean {
    return typeof window !== "undefined" && (window as { SNAKE_AI?: boolean }).SNAKE_AI === true;
  }

  function buildSnakeBodySet(): Set<string> {
    const bodySet = new Set<string>();
    for (let i = 1; i < snake.length; i++) bodySet.add(`${snake[i].x},${snake[i].y}`);
    return bodySet;
  }

  function posKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  function floodFillCount(startX: number, startY: number, bodySet: Set<string>, maxCount: number): number {
    const visited = new Set<string>();
    const queue: Point[] = [{ x: startX, y: startY }];
    let count = 0;
    let iterations = 0;
    const maxIterations = 200;

    while (queue.length > 0 && count < maxCount && iterations < maxIterations) {
      iterations++;
      const current = queue.shift()!;
      const key = posKey(current.x, current.y);
      if (visited.has(key)) continue;
      if (bodySet.has(key)) continue;
      visited.add(key);
      count++;

      const neighbors = [
        { x: (current.x + 1) % GRID_WIDTH, y: current.y },
        { x: (current.x - 1 + GRID_WIDTH) % GRID_WIDTH, y: current.y },
        { x: current.x, y: (current.y + 1) % GRID_HEIGHT },
        { x: current.x, y: (current.y - 1 + GRID_HEIGHT) % GRID_HEIGHT },
      ];
      for (const n of neighbors) {
        const nKey = posKey(n.x, n.y);
        if (!visited.has(nKey) && !bodySet.has(nKey)) queue.push(n);
      }
    }
    return count;
  }

  function getWrappedDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.min(Math.abs(x1 - x2), GRID_WIDTH - Math.abs(x1 - x2));
    const dy = Math.min(Math.abs(y1 - y2), GRID_HEIGHT - Math.abs(y1 - y2));
    return dx + dy;
  }

  function findBestTarget(head: Point): Point | null {
    if (powerUps.length === 0) return null;
    let bestTarget: PowerUp | null = null;
    let bestScore = -Infinity;
    for (const p of powerUps) {
      const config = POWERUP_CONFIG[p.type];
      const distance = getWrappedDistance(head.x, head.y, p.x, p.y);
      let s = 100 - distance;
      if (p.type === "apple") s += 50;
      if (p.type === "golden") s += 80;
      if (p.type === "heart") s += 70;
      if (p.type === "diamond") s += 40;
      if (p.type === "shield") s += 60;
      if (p.type === "scissors") s += 50;
      if (p.type === "fire") s += 40;
      if (p.type === "frenzy") s += 90;
      if (config.isDebuff) s -= 500;
      if (s > bestScore) {
        bestScore = s;
        bestTarget = p;
      }
    }
    return bestTarget;
  }

  function getAIDirection(): Point {
    const head = snake[0];
    const bodySet = isGhostMode ? new Set<string>() : buildSnakeBodySet();
    const allMoves: Point[] = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];
    const validMoves = allMoves.filter((m) => !(m.x === -direction.x && m.y === -direction.y));
    const target = findBestTarget(head);

    let bestMove = direction;
    let bestScore = -Infinity;

    for (const move of validMoves) {
      const newX = (head.x + move.x + GRID_WIDTH) % GRID_WIDTH;
      const newY = (head.y + move.y + GRID_HEIGHT) % GRID_HEIGHT;
      let s = 0;

      if (!isGhostMode && bodySet.has(posKey(newX, newY))) {
        s -= 100000;
      } else {
        if (!isGhostMode) {
          const tempBody = new Set(bodySet);
          const willEat = powerUps.some((p) => p.x === newX && p.y === newY);
          if (!willEat && snake.length > 1) {
            tempBody.delete(posKey(snake[snake.length - 1].x, snake[snake.length - 1].y));
          }
          const space = floodFillCount(newX, newY, tempBody, snake.length + 5);
          if (space < snake.length) s -= 50000;
          else if (space < snake.length + 3) s -= 5000;
          else s += space * 10;
        }
        if (target) {
          const currentDist = getWrappedDistance(head.x, head.y, target.x, target.y);
          const newDist = getWrappedDistance(newX, newY, target.x, target.y);
          if (newDist < currentDist) s += 1000;
          else if (newDist > currentDist) s -= 100;
        }
        const directPowerup = powerUps.find((p) => p.x === newX && p.y === newY);
        if (directPowerup) {
          s += POWERUP_CONFIG[directPowerup.type].isDebuff ? -5000 : 2000;
        }
        for (const p of powerUps) {
          if (POWERUP_CONFIG[p.type].isDebuff) {
            const dist = getWrappedDistance(newX, newY, p.x, p.y);
            if (dist <= 2) s -= 500 * (3 - dist);
          }
        }
      }
      if (s > bestScore) {
        bestScore = s;
        bestMove = move;
      }
    }
    return bestMove;
  }

  function updateAI(): void {
    if (!isAIEnabled()) {
      if (aiEnabled) {
        aiEnabled = false;
        console.log("🐍 Snake AI disabled");
      }
      return;
    }
    if (!aiEnabled) {
      aiEnabled = true;
      console.log("🐍 Snake AI enabled!");
    }
    const aiDir = getAIDirection();
    if (aiDir.x !== direction.x || aiDir.y !== direction.y) {
      inputQueue.length = 0;
      inputQueue.push(aiDir);
    }
  }

  // ==================== INIT ====================

  function init(): void {
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    ctx = canvas.getContext("2d");

    gridCanvas = document.createElement("canvas");
    gridCanvas.width = CANVAS_WIDTH;
    gridCanvas.height = CANVAS_HEIGHT;
    gridCtx = gridCanvas.getContext("2d");
    if (gridCtx) {
      gridCtx.fillStyle = "#0a0a0a";
      gridCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      gridCtx.strokeStyle = "rgba(63, 63, 70, 0.3)";
      gridCtx.lineWidth = 0.5;
      gridCtx.beginPath();
      for (let x = 0; x <= GRID_WIDTH; x++) {
        gridCtx.moveTo(x * GRID_SIZE, 0);
        gridCtx.lineTo(x * GRID_SIZE, CANVAS_HEIGHT);
      }
      for (let y = 0; y <= GRID_HEIGHT; y++) {
        gridCtx.moveTo(0, y * GRID_SIZE);
        gridCtx.lineTo(CANVAS_WIDTH, y * GRID_SIZE);
      }
      gridCtx.stroke();
    }

    highScore = storage?.get<number>(HIGH_SCORE_KEY, 0) ?? 0;

    document.addEventListener("keydown", handleKeydown);
    reset();
    gameState = "menu";
    render();
  }

  function destroy(): void {
    if (gameLoop) {
      cancelAnimationFrame(gameLoop);
      gameLoop = null;
    }
    document.removeEventListener("keydown", handleKeydown);
  }

  function reset(): void {
    const startX = Math.floor(GRID_WIDTH / 2);
    const startY = Math.floor(GRID_HEIGHT / 2);
    snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    direction = { x: 1, y: 0 };
    inputQueue = [];
    powerUps = [];
    particles = [];

    isGhostMode = false;
    ghostModeStacks = 0;
    isSpeedBoost = false;
    speedBoostStacks = 0;
    isSlowMode = false;
    isDoublePoints = false;
    doublePointsStacks = 0;
    isMagnetMode = false;
    magnetModeStacks = 0;
    isShieldMode = false;

    baseSpeed = Math.max(60, 130 - (level - 1) * 10);
    currentSpeed = baseSpeed;

    spawnPowerUp("apple");
    spawnRandomPowerUp();
  }

  function start(): void {
    score = 0;
    lives = 3;
    level = 1;
    frenzyUsedThisGame = false;
    reset();
    gameState = "playing";
    lastMoveTime = performance.now();
    scheduleLoop();
  }

  function togglePause(): void {
    if (gameState === "playing") {
      gameState = "paused";
    } else if (gameState === "paused") {
      gameState = "playing";
      lastMoveTime = performance.now();
      scheduleLoop();
    }
  }

  function scheduleLoop(): void {
    if (gameLoop) cancelAnimationFrame(gameLoop);
    gameLoop = requestAnimationFrame(runGameLoop);
  }

  // ==================== INPUT ====================

  function handleKeydown(e: KeyboardEvent): void {
    if (gameState === "menu" || gameState === "gameover") {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        start();
      }
      return;
    }

    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      e.preventDefault();
      togglePause();
      return;
    }

    if (gameState !== "playing") return;

    let keyMap: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
      W: { x: 0, y: -1 },
      S: { x: 0, y: 1 },
      A: { x: -1, y: 0 },
      D: { x: 1, y: 0 },
    };

    if (isReverseControls) {
      keyMap = {
        ArrowUp: { x: 0, y: 1 },
        ArrowDown: { x: 0, y: -1 },
        ArrowLeft: { x: 1, y: 0 },
        ArrowRight: { x: -1, y: 0 },
        w: { x: 0, y: 1 },
        s: { x: 0, y: -1 },
        a: { x: 1, y: 0 },
        d: { x: -1, y: 0 },
        W: { x: 0, y: 1 },
        S: { x: 0, y: -1 },
        A: { x: 1, y: 0 },
        D: { x: -1, y: 0 },
      };
    }

    const newDir = keyMap[e.key];
    if (newDir) {
      e.preventDefault();
      const lastDir = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : direction;
      if (newDir.x !== -lastDir.x || newDir.y !== -lastDir.y) {
        if (inputQueue.length < 3) inputQueue.push(newDir);
      }
    }
  }

  // ==================== POWER-UPS ====================

  function spawnPowerUp(type?: PowerUpType): void {
    let attempts = 0;
    let pos: Point;
    do {
      pos = {
        x: Math.floor(Math.random() * GRID_WIDTH),
        y: Math.floor(Math.random() * GRID_HEIGHT),
      };
      attempts++;
    } while (attempts < 100 && (isPositionOccupied(pos) || powerUps.some((p) => p.x === pos.x && p.y === pos.y)));
    if (attempts >= 100) return;
    if (!type) type = chooseRandomPowerUpType();
    powerUps.push({
      ...pos,
      type,
      spawnTime: performance.now(),
      duration: type === "apple" ? 999999 : 10000 + Math.random() * 5000,
    });
  }

  function chooseRandomPowerUpType(): PowerUpType {
    let types = Object.keys(POWERUP_CONFIG) as PowerUpType[];
    if (frenzyUsedThisGame) types = types.filter((t) => t !== "frenzy");
    const debuffMultiplier = 1 + (level - 1) * 0.3;
    let totalRarity = 0;
    const adjustedRarities = types.map((t) => {
      const config = POWERUP_CONFIG[t];
      const adjusted = config.isDebuff ? config.rarity * debuffMultiplier : config.rarity;
      totalRarity += adjusted;
      return adjusted;
    });
    let random = Math.random() * totalRarity;
    for (let i = 0; i < types.length; i++) {
      random -= adjustedRarities[i];
      if (random <= 0) return types[i];
    }
    return "apple";
  }

  function spawnRandomPowerUp(): void {
    if (powerUps.length < 6 + level) spawnPowerUp();
  }

  function isPositionOccupied(pos: Point): boolean {
    return snake.some((segment) => segment.x === pos.x && segment.y === pos.y);
  }

  function handlePowerUp(powerUp: PowerUp, timestamp: number): void {
    const config = POWERUP_CONFIG[powerUp.type];
    let points = config.points;
    if (isDoublePoints) points *= 2;
    score += points;
    createParticles(powerUp.x * GRID_SIZE + GRID_SIZE / 2, powerUp.y * GRID_SIZE + GRID_SIZE / 2, config.color);

    switch (powerUp.type) {
      case "apple":
        break;
      case "golden": {
        isGhostMode = true;
        ghostModeStacks++;
        ghostModeEndTime = timestamp + Math.min(ghostModeStacks, 5) * (config.effectDuration || 5000);
        break;
      }
      case "heart":
        lives = Math.min(lives + 1, 5);
        break;
      case "lightning": {
        isSpeedBoost = true;
        speedBoostStacks++;
        isSlowMode = false;
        speedBoostEndTime = timestamp + Math.min(speedBoostStacks, 5) * (config.effectDuration || 4000);
        break;
      }
      case "snail":
        isSlowMode = true;
        slowModeEndTime = timestamp + (config.effectDuration || 5000);
        isSpeedBoost = false;
        break;
      case "diamond": {
        isDoublePoints = true;
        doublePointsStacks++;
        doublePointsEndTime = timestamp + Math.min(doublePointsStacks, 5) * (config.effectDuration || 8000);
        break;
      }
      case "fire": {
        const removeCount = Math.min(3, snake.length - 3);
        for (let i = 0; i < removeCount; i++) snake.pop();
        break;
      }
      case "magnet": {
        isMagnetMode = true;
        magnetModeStacks++;
        magnetModeEndTime = timestamp + Math.min(magnetModeStacks, 5) * (config.effectDuration || 6000);
        break;
      }
      case "frenzy":
        isFrenzyMode = true;
        frenzyModeEndTime = timestamp + (config.effectDuration || 6000);
        frenzyUsedThisGame = true;
        for (let i = 0; i < 10; i++) spawnPowerUp("apple");
        break;
      case "mystery": {
        const allTypes = Object.keys(POWERUP_CONFIG) as PowerUpType[];
        const mysteryTypes = allTypes.filter((t) => t !== "apple" && t !== "mystery");
        const randomType = mysteryTypes[Math.floor(Math.random() * mysteryTypes.length)];
        const randomConfig = POWERUP_CONFIG[randomType];
        createParticles(powerUp.x * GRID_SIZE + GRID_SIZE / 2, powerUp.y * GRID_SIZE + GRID_SIZE / 2, randomConfig.color);
        handlePowerUp({ ...powerUp, type: randomType }, timestamp);
        return;
      }
      case "scissors": {
        const cutCount = Math.min(5, snake.length - 3);
        for (let i = 0; i < cutCount; i++) snake.pop();
        break;
      }
      case "shield":
        isShieldMode = true;
        shieldModeEndTime = timestamp + (config.effectDuration || 10000);
        break;
      case "skull":
        if (!isShieldMode) {
          lives = Math.max(0, lives - 1);
          if (lives <= 0) {
            handleDeath();
            return;
          }
        }
        break;
      case "bomb": {
        const bombX = powerUp.x;
        const bombY = powerUp.y;
        for (let i = 0; i < 20; i++) {
          createParticles(bombX * GRID_SIZE + GRID_SIZE / 2, bombY * GRID_SIZE + GRID_SIZE / 2, "#f97316");
        }
        powerUps = powerUps.filter((p) => {
          const dist = Math.abs(p.x - bombX) + Math.abs(p.y - bombY);
          if (dist < 6) {
            createParticles(p.x * GRID_SIZE + GRID_SIZE / 2, p.y * GRID_SIZE + GRID_SIZE / 2, "#f97316");
            return false;
          }
          return true;
        });
        break;
      }
      case "reverse":
        if (!isShieldMode) {
          isReverseControls = true;
          reverseControlsEndTime = timestamp + (config.effectDuration || 5000);
        }
        break;
      case "blind":
        if (!isShieldMode) {
          isBlindMode = true;
          blindModeEndTime = timestamp + (config.effectDuration || 4000);
        }
        break;
      case "grow":
        if (!isShieldMode) {
          for (let i = 0; i < 5; i++) snake.push({ ...snake[snake.length - 1] });
        }
        break;
    }

    const newLevel = Math.floor(score / 100) + 1;
    if (newLevel > level) {
      level = newLevel;
      baseSpeed = Math.max(60, 130 - (level - 1) * 10);
    }
    if (score > highScore) {
      highScore = score;
      storage?.set(HIGH_SCORE_KEY, highScore);
    }
    if (powerUp.type === "apple") spawnPowerUp("apple");
  }

  // ==================== LOOP ====================

  function runGameLoop(timestamp: number): void {
    if (gameState !== "playing") {
      render();
      return;
    }

    if (hostPaused) {
      render();
      gameLoop = requestAnimationFrame(runGameLoop);
      return;
    }

    const elapsed = timestamp - lastMoveTime;
    updateSpeed();
    if (elapsed >= currentSpeed) {
      lastMoveTime = timestamp;
      if (isAIEnabled()) updateAI();
      update(timestamp);
    }

    updateEffects(timestamp);
    updateParticles();

    powerUps = powerUps.filter((p) => timestamp - p.spawnTime < p.duration);
    if (!powerUps.some((p) => p.type === "apple")) spawnPowerUp("apple");

    const spawnChance = isFrenzyMode ? 0.25 : 0.03 + 0.01 * level;
    if (Math.random() < spawnChance) {
      if (isFrenzyMode && Math.random() < 0.7) spawnPowerUp("apple");
      else spawnRandomPowerUp();
    }

    render();
    gameLoop = requestAnimationFrame(runGameLoop);
  }

  function updateSpeed(): void {
    if (isSpeedBoost) currentSpeed = baseSpeed * 0.6;
    else if (isSlowMode) currentSpeed = baseSpeed * 1.5;
    else currentSpeed = baseSpeed;
  }

  function updateEffects(timestamp: number): void {
    const effects: ActivePowerUp[] = [];
    if (isGhostMode && timestamp < ghostModeEndTime) {
      effects.push({ type: "ghost", emoji: "🌟", timeLeft: Math.ceil((ghostModeEndTime - timestamp) / 1000), stacks: ghostModeStacks });
    } else {
      isGhostMode = false;
      ghostModeStacks = 0;
    }
    if (isSpeedBoost && timestamp < speedBoostEndTime) {
      effects.push({ type: "speed", emoji: "⚡", timeLeft: Math.ceil((speedBoostEndTime - timestamp) / 1000), stacks: speedBoostStacks });
    } else {
      isSpeedBoost = false;
      speedBoostStacks = 0;
    }
    if (isSlowMode && timestamp < slowModeEndTime) {
      effects.push({ type: "slow", emoji: "🐌", timeLeft: Math.ceil((slowModeEndTime - timestamp) / 1000) });
    } else {
      isSlowMode = false;
    }
    if (isDoublePoints && timestamp < doublePointsEndTime) {
      effects.push({ type: "double", emoji: "💎", timeLeft: Math.ceil((doublePointsEndTime - timestamp) / 1000), stacks: doublePointsStacks });
    } else {
      isDoublePoints = false;
      doublePointsStacks = 0;
    }
    if (isMagnetMode && timestamp < magnetModeEndTime) {
      effects.push({ type: "magnet", emoji: "🧲", timeLeft: Math.ceil((magnetModeEndTime - timestamp) / 1000), stacks: magnetModeStacks });
    } else {
      isMagnetMode = false;
      magnetModeStacks = 0;
    }
    if (isFrenzyMode && timestamp < frenzyModeEndTime) {
      effects.push({ type: "frenzy", emoji: "🎉", timeLeft: Math.ceil((frenzyModeEndTime - timestamp) / 1000) });
    } else {
      isFrenzyMode = false;
    }
    if (isReverseControls && timestamp < reverseControlsEndTime) {
      effects.push({ type: "reverse", emoji: "🔄", timeLeft: Math.ceil((reverseControlsEndTime - timestamp) / 1000) });
    } else {
      isReverseControls = false;
    }
    if (isBlindMode && timestamp < blindModeEndTime) {
      effects.push({ type: "blind", emoji: "🌫️", timeLeft: Math.ceil((blindModeEndTime - timestamp) / 1000) });
    } else {
      isBlindMode = false;
    }
    if (isShieldMode && timestamp < shieldModeEndTime) {
      effects.push({ type: "shield", emoji: "🛡️", timeLeft: Math.ceil((shieldModeEndTime - timestamp) / 1000) });
    } else {
      isShieldMode = false;
    }
    if (timestamp < invincibilityEndTime) {
      effects.push({ type: "invincible", emoji: "⭐", timeLeft: Math.ceil((invincibilityEndTime - timestamp) / 1000) });
    }
    activePowerUps = effects;
  }

  function update(timestamp: number): void {
    if (inputQueue.length > 0) {
      const nextDir = inputQueue.shift()!;
      if (nextDir.x !== -direction.x || nextDir.y !== -direction.y) direction = nextDir;
    }

    const head = snake[0];
    const newHead: Point = { x: head.x + direction.x, y: head.y + direction.y };
    if (newHead.x < 0) newHead.x = GRID_WIDTH - 1;
    if (newHead.x >= GRID_WIDTH) newHead.x = 0;
    if (newHead.y < 0) newHead.y = GRID_HEIGHT - 1;
    if (newHead.y >= GRID_HEIGHT) newHead.y = 0;

    if (isMagnetMode) {
      const magnetRadius = 5;
      powerUps.forEach((p) => {
        const dx = newHead.x - p.x;
        const dy = newHead.y - p.y;
        if (Math.abs(dx) + Math.abs(dy) < magnetRadius * 1.5) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < magnetRadius && dist > 0) {
            p.x += Math.sign(dx);
            p.y += Math.sign(dy);
          }
        }
      });
    }

    const selfCollision = snake.some((segment, index) => index > 0 && segment.x === newHead.x && segment.y === newHead.y);
    const now = performance.now();
    if (selfCollision && !isGhostMode && now > invincibilityEndTime) {
      lives = Math.max(0, lives - 1);
      invincibilityEndTime = now + 1500;
      createParticles(newHead.x * GRID_SIZE + GRID_SIZE / 2, newHead.y * GRID_SIZE + GRID_SIZE / 2, "#ef4444");
      if (lives <= 0) {
        handleDeath();
        return;
      }
    }

    snake.unshift(newHead);
    const collectedIndex = powerUps.findIndex((p) => p.x === newHead.x && p.y === newHead.y);
    if (collectedIndex !== -1) {
      const collected = powerUps[collectedIndex];
      powerUps.splice(collectedIndex, 1);
      handlePowerUp(collected, timestamp);
    } else {
      snake.pop();
    }
  }

  function handleDeath(): void {
    snake.forEach((segment) =>
      createParticles(segment.x * GRID_SIZE + GRID_SIZE / 2, segment.y * GRID_SIZE + GRID_SIZE / 2, "#ef4444"),
    );
    if (lives <= 0) {
      lives = 0;
      gameState = "gameover";
    } else {
      const startX = Math.floor(GRID_WIDTH / 2);
      const startY = Math.floor(GRID_HEIGHT / 2);
      snake = [
        { x: startX, y: startY },
        { x: startX - 1, y: startY },
        { x: startX - 2, y: startY },
      ];
      direction = { x: 1, y: 0 };
      inputQueue = [];
      isGhostMode = false;
      ghostModeStacks = 0;
      isSpeedBoost = false;
      speedBoostStacks = 0;
      isSlowMode = false;
      isMagnetMode = false;
      magnetModeStacks = 0;
      isReverseControls = false;
      isBlindMode = false;
      isShieldMode = false;
    }
  }

  // ==================== PARTICLES ====================

  function createParticles(x: number, y: number, color: string): void {
    if (particles.length > MAX_PARTICLES) return;
    const count = particles.length > MAX_PARTICLES - 8 ? 4 : 8;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * (2 + Math.random() * 2),
        vy: Math.sin(angle) * (2 + Math.random() * 2),
        life: 1,
        maxLife: 1,
        color,
        size: 3 + Math.random() * 3,
      });
    }
  }

  function updateParticles(): void {
    if (particles.length === 0) return;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= 0.03;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ==================== RENDER ====================

  function render(): void {
    if (!ctx) return;

    if (gridCanvas) ctx.drawImage(gridCanvas, 0, 0);
    else {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    const now = performance.now();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    powerUps.forEach((p) => {
      const config = POWERUP_CONFIG[p.type];
      const x = p.x * GRID_SIZE + GRID_SIZE / 2;
      const y = p.y * GRID_SIZE + GRID_SIZE / 2;
      if (config.rarity < 10 || config.isDebuff) {
        const glowColor = config.isDebuff ? "#ef4444" : config.color;
        const gradient = ctx!.createRadialGradient(x, y, 0, x, y, GRID_SIZE);
        gradient.addColorStop(0, glowColor + "40");
        gradient.addColorStop(1, "transparent");
        ctx!.fillStyle = gradient;
        ctx!.fillRect(p.x * GRID_SIZE - 5, p.y * GRID_SIZE - 5, GRID_SIZE + 10, GRID_SIZE + 10);
      }
      const pulse = 1 + Math.sin(now / (config.isDebuff ? 100 : 200)) * 0.1;
      if (config.isDebuff) {
        ctx!.strokeStyle = `rgba(239, 68, 68, ${0.3 + Math.sin(now / 150) * 0.3})`;
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.arc(x, y, GRID_SIZE * 0.6, 0, Math.PI * 2);
        ctx!.stroke();
      }
      ctx!.font = `${14 * pulse}px sans-serif`;
      ctx!.fillText(config.emoji, x, y);
    });

    const isInvincible = now < invincibilityEndTime;
    const invincibleBlink = isInvincible && Math.floor(now / 100) % 2 === 0;
    const ghostAlpha = isGhostMode ? 0.6 + Math.sin(now / 100) * 0.2 : 1;

    snake.forEach((segment, index) => {
      const x = segment.x * GRID_SIZE;
      const y = segment.y * GRID_SIZE;
      const size = GRID_SIZE - 2;
      ctx!.globalAlpha = invincibleBlink ? 0.3 : ghostAlpha;

      if (isShieldMode && index === 0) {
        const shieldPulse = 0.5 + Math.sin(now / 200) * 0.3;
        ctx!.strokeStyle = `rgba(234, 179, 8, ${shieldPulse})`;
        ctx!.lineWidth = 3;
        ctx!.beginPath();
        ctx!.arc(x + size / 2 + 1, y + size / 2 + 1, size * 0.6, 0, Math.PI * 2);
        ctx!.stroke();
      }

      if (index === 0) {
        const gradient = ctx!.createRadialGradient(x + size / 2 + 1, y + size / 2 + 1, 0, x + size / 2 + 1, y + size / 2 + 1, size);
        gradient.addColorStop(0, isGhostMode ? "#fbbf24" : "#22c55e");
        gradient.addColorStop(1, isGhostMode ? "#f59e0b" : "#15803d");
        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.roundRect(x + 1, y + 1, size, size, 6);
        ctx!.fill();

        ctx!.fillStyle = "#fff";
        const eyeOffset = 4;
        const eyeSize = 3;
        if (direction.x === 1) {
          ctx!.fillRect(x + size - eyeOffset - eyeSize + 1, y + 4, eyeSize, eyeSize);
          ctx!.fillRect(x + size - eyeOffset - eyeSize + 1, y + size - 7, eyeSize, eyeSize);
        } else if (direction.x === -1) {
          ctx!.fillRect(x + eyeOffset + 1, y + 4, eyeSize, eyeSize);
          ctx!.fillRect(x + eyeOffset + 1, y + size - 7, eyeSize, eyeSize);
        } else if (direction.y === -1) {
          ctx!.fillRect(x + 4, y + eyeOffset + 1, eyeSize, eyeSize);
          ctx!.fillRect(x + size - 7, y + eyeOffset + 1, eyeSize, eyeSize);
        } else {
          ctx!.fillRect(x + 4, y + size - eyeOffset - eyeSize + 1, eyeSize, eyeSize);
          ctx!.fillRect(x + size - 7, y + size - eyeOffset - eyeSize + 1, eyeSize, eyeSize);
        }
      } else {
        const brightness = 1 - (index / snake.length) * 0.4;
        const r = Math.floor(34 * brightness);
        const g = Math.floor(197 * brightness);
        const b = Math.floor(94 * brightness);
        ctx!.fillStyle = isGhostMode ? `rgba(251, 191, 36, ${brightness})` : `rgb(${r}, ${g}, ${b})`;
        ctx!.beginPath();
        ctx!.roundRect(x + 2, y + 2, size - 2, size - 2, 4);
        ctx!.fill();
      }
    });
    ctx!.globalAlpha = 1;

    if (particles.length > 0) {
      const particlesByColor = new Map<string, Particle[]>();
      particles.forEach((p) => {
        if (!particlesByColor.has(p.color)) particlesByColor.set(p.color, []);
        particlesByColor.get(p.color)!.push(p);
      });
      particlesByColor.forEach((parts, color) => {
        ctx!.fillStyle = color;
        parts.forEach((p) => {
          ctx!.globalAlpha = p.life;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx!.fill();
        });
      });
      ctx!.globalAlpha = 1;
    }

    if (isBlindMode) {
      const head = snake[0];
      const headX = head.x * GRID_SIZE + GRID_SIZE / 2;
      const headY = head.y * GRID_SIZE + GRID_SIZE / 2;
      const fogRadius = GRID_SIZE * 5;
      const gradient = ctx!.createRadialGradient(headX, headY, 0, headX, headY, fogRadius);
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(0.4, "rgba(0, 0, 0, 0.3)");
      gradient.addColorStop(0.7, "rgba(0, 0, 0, 0.7)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.95)");
      ctx!.fillStyle = gradient;
      ctx!.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    drawHud(now);

    if (isAIEnabled()) {
      ctx!.fillStyle = "rgba(139, 92, 246, 0.8)";
      ctx!.font = "bold 14px system-ui, sans-serif";
      ctx!.textAlign = "left";
      ctx!.textBaseline = "top";
      ctx!.fillText("🤖 AI MODE", 10, 30);
    }

    if (hostPaused) {
      drawOverlay("PAUSED", "Waiting for host...");
    } else if (gameState === "menu") {
      drawOverlay("Snake Game 🐍", "Press SPACE or ENTER to start", [
        "Controls: ← ↑ → ↓ or WASD",
        "ESC / P - pause",
      ]);
    } else if (gameState === "paused") {
      drawOverlay("PAUSED", "Press ESC or P to continue");
    } else if (gameState === "gameover") {
      drawOverlay("GAME OVER", `Score: ${score}`, [`High Score: ${highScore}`, "", "Press SPACE for a new game"]);
    }
  }

  function drawHud(now: number): void {
    if (!ctx) return;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.fillStyle = "#fafafa";
    ctx.fillText(`Score ${score}`, 12, 10);
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(`Best ${highScore}   Lvl ${level}   ${"❤️".repeat(Math.max(0, lives))}`, 12, 32);

    // Active effects (right aligned)
    ctx.textAlign = "right";
    ctx.font = "14px system-ui, sans-serif";
    activePowerUps.forEach((eff, i) => {
      const label = eff.stacks && eff.stacks > 1 ? `${eff.emoji}x${eff.stacks} ${eff.timeLeft}s` : `${eff.emoji} ${eff.timeLeft}s`;
      ctx!.fillStyle = "#fafafa";
      ctx!.fillText(label, CANVAS_WIDTH - 12, 10 + i * 20);
    });
    ctx.textAlign = "center";
    void now;
  }

  function drawOverlay(title: string, subtitle: string, extra?: string[]): void {
    if (!ctx) return;
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = "#fafafa";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(subtitle, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    if (extra) {
      ctx.font = "14px system-ui, sans-serif";
      extra.forEach((line, i) => ctx!.fillText(line, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30 + i * 22));
    }
  }

  // ==================== PUBLIC ====================

  init();

  return {
    destroy,
    pause(): void {
      hostPaused = true;
    },
    resume(): void {
      if (!hostPaused) return;
      hostPaused = false;
      lastMoveTime = performance.now();
      if (gameState === "playing") scheduleLoop();
    },
  };
}
