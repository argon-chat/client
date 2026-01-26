import { ref, type Ref } from 'vue';

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
  | 'apple'      // 🍎 Normal apple - points + length
  | 'golden'     // 🌟 Golden apple - ghost mode (pass through self)
  | 'heart'      // ❤️ Heart - extra life
  | 'lightning'  // ⚡ Lightning - speed boost
  | 'snail'      // 🐌 Snail - slow down
  | 'diamond'    // 💎 Diamond - double points
  | 'fire'       // 🔥 Fire - shrinks snake
  | 'magnet'     // 🧲 Magnet - attracts nearby items
  | 'frenzy'     // 🎉 Frenzy - spawns tons of apples
  | 'mystery'    // 📦 Mystery box - random buff or debuff
  // Debuffs
  | 'skull'      // 💀 Skull - lose a life
  | 'bomb'       // 💣 Bomb - explodes, clears nearby powerups
  | 'reverse'    // 🔄 Reverse - reverses controls
  | 'blind'      // 🌫️ Blind - fog of war
  | 'grow';      // 🌱 Grow - forces growth (harder to control)

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
}

export type SnakeGameState = 'menu' | 'playing' | 'paused' | 'gameover';

// ==================== CONSTANTS ====================

const GRID_SIZE = 20;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 480;
const GRID_WIDTH = CANVAS_WIDTH / GRID_SIZE;
const GRID_HEIGHT = CANVAS_HEIGHT / GRID_SIZE;

const POWERUP_CONFIG: Record<PowerUpType, PowerUpConfig> = {
  // Buffs (higher rarity = more common)
  apple: { emoji: '🍎', color: '#ef4444', rarity: 40, points: 10, description: 'Points +10' },
  golden: { emoji: '🌟', color: '#fbbf24', rarity: 15, points: 25, effectDuration: 5000, description: 'Ghost 5s' },
  heart: { emoji: '❤️', color: '#ec4899', rarity: 12, points: 5, description: 'Life +1' },
  lightning: { emoji: '⚡', color: '#3b82f6', rarity: 18, points: 15, effectDuration: 4000, description: 'Speed boost 4s' },
  snail: { emoji: '🐌', color: '#84cc16', rarity: 18, points: 20, effectDuration: 5000, description: 'Slow down 5s' },
  diamond: { emoji: '💎', color: '#8b5cf6', rarity: 14, points: 30, effectDuration: 8000, description: 'x2 points 8s' },
  fire: { emoji: '🔥', color: '#f97316', rarity: 12, points: 0, description: 'Shorten -3' },
  magnet: { emoji: '🧲', color: '#06b6d4', rarity: 14, points: 15, effectDuration: 6000, description: 'Magnet 6s' },
  frenzy: { emoji: '🎉', color: '#f472b6', rarity: 2, points: 50, effectDuration: 6000, description: 'Fruit frenzy 6s' },
  mystery: { emoji: '📦', color: '#a855f7', rarity: 10, points: 0, description: 'Random effect!' },
  // Debuffs (lower rarity = less common)
  skull: { emoji: '💀', color: '#71717a', rarity: 3, points: -20, description: '-1 life', isDebuff: true },
  bomb: { emoji: '💣', color: '#1f2937', rarity: 4, points: 0, description: 'Explosion!', isDebuff: true },
  reverse: { emoji: '🔄', color: '#f472b6', rarity: 5, points: 5, effectDuration: 5000, description: 'Reverse 5s', isDebuff: true },
  blind: { emoji: '🌫️', color: '#6b7280', rarity: 4, points: 10, effectDuration: 4000, description: 'Fog 4s', isDebuff: true },
  grow: { emoji: '🌱', color: '#22c55e', rarity: 5, points: 5, description: '+5 length', isDebuff: true },
};

// ==================== COMPOSABLE ====================

export function useSnakeGame(canvasRef: Ref<HTMLCanvasElement | null>) {
  // Reactive state
  const gameState = ref<SnakeGameState>('menu');
  const score = ref(0);
  const highScore = ref(0);
  const lives = ref(3);
  const level = ref(1);
  const activePowerUps = ref<ActivePowerUp[]>([]);

  // Game internals
  let ctx: CanvasRenderingContext2D | null = null;
  let gameLoop: number | null = null;
  let snake: Point[] = [];
  let direction: Point = { x: 1, y: 0 };
  let inputQueue: Point[] = []; // Queue for buffered inputs
  let powerUps: PowerUp[] = [];
  let particles: Particle[] = [];
  let baseSpeed = 120;
  let currentSpeed = 120;
  let lastMoveTime = 0;

  // Active effects
  let isGhostMode = false;
  let ghostModeEndTime = 0;
  let isSpeedBoost = false;
  let speedBoostEndTime = 0;
  let isSlowMode = false;
  let slowModeEndTime = 0;
  let isDoublePoints = false;
  let doublePointsEndTime = 0;
  let isMagnetMode = false;
  let magnetModeEndTime = 0;
  let isFrenzyMode = false;
  let frenzyModeEndTime = 0;
  let frenzyUsedThisGame = false;
  let isReverseControls = false;
  let reverseControlsEndTime = 0;
  let isBlindMode = false;
  let blindModeEndTime = 0;
  let invincibilityEndTime = 0;

  // ==================== INITIALIZATION ====================

  function init() {
    const canvas = canvasRef.value;
    if (!canvas) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    ctx = canvas.getContext('2d');

    // Load high score
    const saved = localStorage.getItem('argon-snake-highscore');
    if (saved) highScore.value = parseInt(saved);

    document.addEventListener('keydown', handleKeydown);

    reset();
    gameState.value = 'menu';
    render();
  }

  function cleanup() {
    if (gameLoop) {
      cancelAnimationFrame(gameLoop);
      gameLoop = null;
    }
    document.removeEventListener('keydown', handleKeydown);
  }

  function reset() {
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

    // Reset effects
    isGhostMode = false;
    isSpeedBoost = false;
    isSlowMode = false;
    isDoublePoints = false;
    isMagnetMode = false;

    baseSpeed = Math.max(60, 130 - (level.value - 1) * 10);
    currentSpeed = baseSpeed;

    spawnPowerUp('apple');
    spawnRandomPowerUp();
  }

  function start() {
    score.value = 0;
    lives.value = 3;
    level.value = 1;
    frenzyUsedThisGame = false;
    reset();
    gameState.value = 'playing';
    lastMoveTime = performance.now();
    runGameLoop(performance.now());
  }

  function togglePause() {
    if (gameState.value === 'playing') {
      gameState.value = 'paused';
    } else if (gameState.value === 'paused') {
      gameState.value = 'playing';
      lastMoveTime = performance.now();
      runGameLoop(performance.now());
    }
  }

  // ==================== INPUT HANDLING ====================

  function handleKeydown(e: KeyboardEvent) {
    if (gameState.value === 'menu') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        start();
      }
      return;
    }

    if (gameState.value === 'gameover') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        start();
      }
      return;
    }

    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      togglePause();
      return;
    }

    if (gameState.value !== 'playing') return;

    let keyMap: Record<string, Point> = {
      'ArrowUp': { x: 0, y: -1 },
      'ArrowDown': { x: 0, y: 1 },
      'ArrowLeft': { x: -1, y: 0 },
      'ArrowRight': { x: 1, y: 0 },
      'w': { x: 0, y: -1 },
      's': { x: 0, y: 1 },
      'a': { x: -1, y: 0 },
      'd': { x: 1, y: 0 },
      'W': { x: 0, y: -1 },
      'S': { x: 0, y: 1 },
      'A': { x: -1, y: 0 },
      'D': { x: 1, y: 0 },
    };

    if (isReverseControls) {
      keyMap = {
        'ArrowUp': { x: 0, y: 1 },
        'ArrowDown': { x: 0, y: -1 },
        'ArrowLeft': { x: 1, y: 0 },
        'ArrowRight': { x: -1, y: 0 },
        'w': { x: 0, y: 1 },
        's': { x: 0, y: -1 },
        'a': { x: 1, y: 0 },
        'd': { x: -1, y: 0 },
        'W': { x: 0, y: 1 },
        'S': { x: 0, y: -1 },
        'A': { x: 1, y: 0 },
        'D': { x: -1, y: 0 },
      };
    }

    const newDir = keyMap[e.key];
    if (newDir) {
      e.preventDefault();
      
      // Get the last direction (either from queue or current direction)
      const lastDir = inputQueue.length > 0 ? inputQueue[inputQueue.length - 1] : direction;
      
      // Only add to queue if it's not a 180-degree turn from the last queued direction
      if (newDir.x !== -lastDir.x || newDir.y !== -lastDir.y) {
        // Limit queue size to 3 to prevent input overflow
        if (inputQueue.length < 3) {
          inputQueue.push(newDir);
        }
      }
    }

    // Debug hotkeys (Numpad 7, 8, 9)
    /*if (e.key === '7' || e.code === 'Numpad7') {
      e.preventDefault();
      spawnPowerUp('magnet');
    }
    if (e.key === '8' || e.code === 'Numpad8') {
      e.preventDefault();
      spawnPowerUp('golden');
    }
    if (e.key === '9' || e.code === 'Numpad9') {
      e.preventDefault();
      spawnPowerUp('lightning');
    }*/
  }

  // ==================== POWER-UPS ====================

  function spawnPowerUp(type?: PowerUpType) {   
    let attempts = 0;
    let pos: Point;

    do {
      pos = {
        x: Math.floor(Math.random() * GRID_WIDTH),
        y: Math.floor(Math.random() * GRID_HEIGHT),
      };
      attempts++;
    } while (
      attempts < 100 &&
      (isPositionOccupied(pos) || powerUps.some(p => p.x === pos.x && p.y === pos.y))
    );

    if (attempts >= 100) return;

    if (!type) {
      type = chooseRandomPowerUpType();
    }

    powerUps.push({
      ...pos,
      type,
      spawnTime: performance.now(),
      duration: type === 'apple' ? 999999 : 10000 + Math.random() * 5000,
    });
  }

  function chooseRandomPowerUpType(): PowerUpType {
    let types = Object.keys(POWERUP_CONFIG) as PowerUpType[];

    if (frenzyUsedThisGame) {
      types = types.filter(t => t !== 'frenzy');
    }

    const debuffMultiplier = 1 + (level.value - 1) * 0.3;

    let totalRarity = 0;
    const adjustedRarities: number[] = types.map(t => {
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

    return 'apple';
  }

  function spawnRandomPowerUp() {
    if (powerUps.length < 6 + level.value) {
      spawnPowerUp();
    }
  }

  function isPositionOccupied(pos: Point): boolean {
    return snake.some(segment => segment.x === pos.x && segment.y === pos.y);
  }

  function handlePowerUp(powerUp: PowerUp, timestamp: number) {
    const config = POWERUP_CONFIG[powerUp.type];
    let points = config.points;

    if (isDoublePoints) {
      points *= 2;
    }

    score.value += points;
    createParticles(powerUp.x * GRID_SIZE + GRID_SIZE / 2, powerUp.y * GRID_SIZE + GRID_SIZE / 2, config.color);

    switch (powerUp.type) {
      case 'apple':
        break;

      case 'golden':
        isGhostMode = true;
        ghostModeEndTime = timestamp + (config.effectDuration || 5000);
        break;

      case 'heart':
        lives.value = Math.min(lives.value + 1, 5);
        break;

      case 'lightning':
        isSpeedBoost = true;
        speedBoostEndTime = timestamp + (config.effectDuration || 4000);
        isSlowMode = false;
        break;

      case 'snail':
        isSlowMode = true;
        slowModeEndTime = timestamp + (config.effectDuration || 5000);
        isSpeedBoost = false;
        break;

      case 'diamond':
        isDoublePoints = true;
        doublePointsEndTime = timestamp + (config.effectDuration || 8000);
        break;

      case 'fire':
        const removeCount = Math.min(3, snake.length - 3);
        for (let i = 0; i < removeCount; i++) {
          snake.pop();
        }
        break;

      case 'magnet':
        isMagnetMode = true;
        magnetModeEndTime = timestamp + (config.effectDuration || 6000);
        break;

      case 'frenzy':
        isFrenzyMode = true;
        frenzyModeEndTime = timestamp + (config.effectDuration || 6000);
        frenzyUsedThisGame = true;
        for (let i = 0; i < 10; i++) {
          spawnPowerUp('apple');
        }
        break;

      case 'mystery':
        const allTypes = Object.keys(POWERUP_CONFIG) as PowerUpType[];
        const mysteryTypes = allTypes.filter(t => t !== 'apple' && t !== 'mystery');
        const randomType = mysteryTypes[Math.floor(Math.random() * mysteryTypes.length)];
        const randomConfig = POWERUP_CONFIG[randomType];
        createParticles(powerUp.x * GRID_SIZE + GRID_SIZE / 2, powerUp.y * GRID_SIZE + GRID_SIZE / 2, randomConfig.color);
        const fakePowerUp: PowerUp = { ...powerUp, type: randomType };
        handlePowerUp(fakePowerUp, timestamp);
        return;

      case 'skull':
        lives.value = Math.max(0, lives.value - 1);
        if (lives.value <= 0) {
          handleDeath();
          return;
        }
        break;

      case 'bomb':
        const bombX = powerUp.x;
        const bombY = powerUp.y;
        for (let i = 0; i < 20; i++) {
          createParticles(bombX * GRID_SIZE + GRID_SIZE / 2, bombY * GRID_SIZE + GRID_SIZE / 2, '#f97316');
        }
        powerUps = powerUps.filter(p => {
          const dist = Math.abs(p.x - bombX) + Math.abs(p.y - bombY);
          if (dist < 4) {
            createParticles(p.x * GRID_SIZE + GRID_SIZE / 2, p.y * GRID_SIZE + GRID_SIZE / 2, '#f97316');
            return false;
          }
          return true;
        });
        break;

      case 'reverse':
        isReverseControls = true;
        reverseControlsEndTime = timestamp + (config.effectDuration || 5000);
        break;

      case 'blind':
        isBlindMode = true;
        blindModeEndTime = timestamp + (config.effectDuration || 4000);
        break;

      case 'grow':
        for (let i = 0; i < 5; i++) {
          const tail = snake[snake.length - 1];
          snake.push({ ...tail });
        }
        break;
    }

    const newLevel = Math.floor(score.value / 100) + 1;
    if (newLevel > level.value) {
      level.value = newLevel;
      baseSpeed = Math.max(60, 130 - (level.value - 1) * 10);
    }

    if (score.value > highScore.value) {
      highScore.value = score.value;
      localStorage.setItem('argon-snake-highscore', String(highScore.value));
    }

    if (powerUp.type === 'apple') {
      spawnPowerUp('apple');
    }
  }

  // ==================== GAME LOGIC ====================

  function runGameLoop(timestamp: number) {
    if (gameState.value !== 'playing') {
      render();
      return;
    }

    const elapsed = timestamp - lastMoveTime;
    updateSpeed();

    if (elapsed >= currentSpeed) {
      lastMoveTime = timestamp;
      update(timestamp);
    }

    updateEffects(timestamp);
    updateParticles();

    powerUps = powerUps.filter(p => timestamp - p.spawnTime < p.duration);

    if (!powerUps.some(p => p.type === 'apple')) {
      spawnPowerUp('apple');
    }

    const spawnChance = isFrenzyMode ? 0.25 : 0.03 + 0.01 * level.value;
    if (Math.random() < spawnChance) {
      if (isFrenzyMode && Math.random() < 0.7) {
        spawnPowerUp('apple');
      } else {
        spawnRandomPowerUp();
      }
    }

    render();
    gameLoop = requestAnimationFrame(runGameLoop);
  }

  function updateSpeed() {
    if (isSpeedBoost) {
      currentSpeed = baseSpeed * 0.6;
    } else if (isSlowMode) {
      currentSpeed = baseSpeed * 1.5;
    } else {
      currentSpeed = baseSpeed;
    }
  }

  function updateEffects(timestamp: number) {
    const activeEffects: ActivePowerUp[] = [];

    if (isGhostMode && timestamp < ghostModeEndTime) {
      activeEffects.push({ type: 'ghost', emoji: '🌟', timeLeft: Math.ceil((ghostModeEndTime - timestamp) / 1000) });
    } else {
      isGhostMode = false;
    }

    if (isSpeedBoost && timestamp < speedBoostEndTime) {
      activeEffects.push({ type: 'speed', emoji: '⚡', timeLeft: Math.ceil((speedBoostEndTime - timestamp) / 1000) });
    } else {
      isSpeedBoost = false;
    }

    if (isSlowMode && timestamp < slowModeEndTime) {
      activeEffects.push({ type: 'slow', emoji: '🐌', timeLeft: Math.ceil((slowModeEndTime - timestamp) / 1000) });
    } else {
      isSlowMode = false;
    }

    if (isDoublePoints && timestamp < doublePointsEndTime) {
      activeEffects.push({ type: 'double', emoji: '💎', timeLeft: Math.ceil((doublePointsEndTime - timestamp) / 1000) });
    } else {
      isDoublePoints = false;
    }

    if (isMagnetMode && timestamp < magnetModeEndTime) {
      activeEffects.push({ type: 'magnet', emoji: '🧲', timeLeft: Math.ceil((magnetModeEndTime - timestamp) / 1000) });
    } else {
      isMagnetMode = false;
    }

    if (isFrenzyMode && timestamp < frenzyModeEndTime) {
      activeEffects.push({ type: 'frenzy', emoji: '🎉', timeLeft: Math.ceil((frenzyModeEndTime - timestamp) / 1000) });
    } else {
      isFrenzyMode = false;
    }

    if (isReverseControls && timestamp < reverseControlsEndTime) {
      activeEffects.push({ type: 'reverse', emoji: '🔄', timeLeft: Math.ceil((reverseControlsEndTime - timestamp) / 1000) });
    } else {
      isReverseControls = false;
    }

    if (isBlindMode && timestamp < blindModeEndTime) {
      activeEffects.push({ type: 'blind', emoji: '🌫️', timeLeft: Math.ceil((blindModeEndTime - timestamp) / 1000) });
    } else {
      isBlindMode = false;
    }

    if (timestamp < invincibilityEndTime) {
      activeEffects.push({ type: 'invincible', emoji: '🛡️', timeLeft: Math.ceil((invincibilityEndTime - timestamp) / 1000) });
    }

    activePowerUps.value = activeEffects;
  }

  function update(timestamp: number) {
    // Process input queue
    if (inputQueue.length > 0) {
      const nextDir = inputQueue.shift()!;
      // Double-check it's still valid (not 180-degree turn)
      if (nextDir.x !== -direction.x || nextDir.y !== -direction.y) {
        direction = nextDir;
      }
    }

    const head = snake[0];
    let newHead: Point = {
      x: head.x + direction.x,
      y: head.y + direction.y,
    };

    if (newHead.x < 0) newHead.x = GRID_WIDTH - 1;
    if (newHead.x >= GRID_WIDTH) newHead.x = 0;
    if (newHead.y < 0) newHead.y = GRID_HEIGHT - 1;
    if (newHead.y >= GRID_HEIGHT) newHead.y = 0;

    if (isMagnetMode) {
      powerUps.forEach(p => {
        const dx = newHead.x - p.x;
        const dy = newHead.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 5 && dist > 0) {
          p.x += Math.sign(dx);
          p.y += Math.sign(dy);
        }
      });
    }

    const selfCollision = snake.some((segment, index) =>
      index > 0 && segment.x === newHead.x && segment.y === newHead.y
    );

    const now = performance.now();
    if (selfCollision && !isGhostMode && now > invincibilityEndTime) {
      lives.value = Math.max(0, lives.value - 1);
      invincibilityEndTime = now + 1500;
      createParticles(newHead.x * GRID_SIZE + GRID_SIZE / 2, newHead.y * GRID_SIZE + GRID_SIZE / 2, '#ef4444');

      if (lives.value <= 0) {
        handleDeath();
        return;
      }
    }

    snake.unshift(newHead);

    const collectedIndex = powerUps.findIndex(p => p.x === newHead.x && p.y === newHead.y);

    if (collectedIndex !== -1) {
      const collected = powerUps[collectedIndex];
      powerUps.splice(collectedIndex, 1);
      handlePowerUp(collected, timestamp);
    } else {
      snake.pop();
    }
  }

  function handleDeath() {
    snake.forEach(segment => {
      createParticles(
        segment.x * GRID_SIZE + GRID_SIZE / 2,
        segment.y * GRID_SIZE + GRID_SIZE / 2,
        '#ef4444'
      );
    });

    if (lives.value <= 0) {
      lives.value = 0;
      gameState.value = 'gameover';
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
      isSpeedBoost = false;
      isSlowMode = false;
      isMagnetMode = false;
      isReverseControls = false;
      isBlindMode = false;
    }
  }

  // ==================== PARTICLES ====================

  function createParticles(x: number, y: number, color: string) {
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
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

  function updateParticles() {
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= 0.03;
    });
    particles = particles.filter(p => p.life > 0);
  }

  // ==================== RENDERING ====================

  function render() {
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    ctx.strokeStyle = 'rgba(63, 63, 70, 0.3)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_WIDTH; x++) {
      ctx.beginPath();
      ctx.moveTo(x * GRID_SIZE, 0);
      ctx.lineTo(x * GRID_SIZE, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * GRID_SIZE);
      ctx.lineTo(CANVAS_WIDTH, y * GRID_SIZE);
      ctx.stroke();
    }

    // Draw power-ups
    powerUps.forEach(p => {
      const config = POWERUP_CONFIG[p.type];
      const x = p.x * GRID_SIZE + GRID_SIZE / 2;
      const y = p.y * GRID_SIZE + GRID_SIZE / 2;

      const glowColor = config.isDebuff ? '#ef4444' : config.color;
      const gradient = ctx!.createRadialGradient(x, y, 0, x, y, GRID_SIZE);
      gradient.addColorStop(0, glowColor + '40');
      gradient.addColorStop(1, 'transparent');
      ctx!.fillStyle = gradient;
      ctx!.fillRect(p.x * GRID_SIZE - 5, p.y * GRID_SIZE - 5, GRID_SIZE + 10, GRID_SIZE + 10);

      const pulseSpeed = config.isDebuff ? 100 : 200;
      const pulse = 1 + Math.sin(performance.now() / pulseSpeed) * 0.1;

      if (config.isDebuff) {
        ctx!.strokeStyle = `rgba(239, 68, 68, ${0.3 + Math.sin(performance.now() / 150) * 0.3})`;
        ctx!.lineWidth = 2;
        ctx!.beginPath();
        ctx!.arc(x, y, GRID_SIZE * 0.6, 0, Math.PI * 2);
        ctx!.stroke();
      }

      ctx!.font = `${14 * pulse}px sans-serif`;
      ctx!.textAlign = 'center';
      ctx!.textBaseline = 'middle';
      ctx!.fillText(config.emoji, x, y);
    });

    // Draw snake
    const isInvincible = performance.now() < invincibilityEndTime;
    snake.forEach((segment, index) => {
      const x = segment.x * GRID_SIZE;
      const y = segment.y * GRID_SIZE;
      const size = GRID_SIZE - 2;

      if (isInvincible && Math.floor(performance.now() / 100) % 2 === 0) {
        ctx!.globalAlpha = 0.3;
      }

      if (isGhostMode) {
        ctx!.globalAlpha = 0.6 + Math.sin(performance.now() / 100) * 0.2;
      }

      if (index === 0) {
        const gradient = ctx!.createRadialGradient(
          x + size / 2 + 1, y + size / 2 + 1, 0,
          x + size / 2 + 1, y + size / 2 + 1, size
        );
        gradient.addColorStop(0, isGhostMode ? '#fbbf24' : '#22c55e');
        gradient.addColorStop(1, isGhostMode ? '#f59e0b' : '#15803d');

        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.roundRect(x + 1, y + 1, size, size, 6);
        ctx!.fill();

        // Eyes
        ctx!.fillStyle = '#fff';
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

        ctx!.fillStyle = isGhostMode
          ? `rgba(251, 191, 36, ${brightness})`
          : `rgb(${r}, ${g}, ${b})`;
        ctx!.beginPath();
        ctx!.roundRect(x + 2, y + 2, size - 2, size - 2, 4);
        ctx!.fill();
      }

      ctx!.globalAlpha = 1;
    });

    // Draw particles
    particles.forEach(p => {
      ctx!.globalAlpha = p.life;
      ctx!.fillStyle = p.color;
      ctx!.beginPath();
      ctx!.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx!.fill();
    });
    ctx!.globalAlpha = 1;

    // Draw blind mode fog
    if (isBlindMode) {
      const head = snake[0];
      const headX = head.x * GRID_SIZE + GRID_SIZE / 2;
      const headY = head.y * GRID_SIZE + GRID_SIZE / 2;

      const fogRadius = GRID_SIZE * 5;
      const gradient = ctx!.createRadialGradient(headX, headY, 0, headX, headY, fogRadius);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.3)');
      gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.7)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.95)');
      ctx!.fillStyle = gradient;
      ctx!.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Draw overlays
    if (gameState.value === 'menu') {
      drawOverlay('Snake Game 🐍', 'Press SPACE or ENTER to start', [
        'Controls: ← ↑ → ↓ or WASD',
        'ESC / P - pause',
      ]);
    } else if (gameState.value === 'paused') {
      drawOverlay('PAUSED', 'Press ESC or P to continue');
    } else if (gameState.value === 'gameover') {
      drawOverlay('GAME OVER', `Score: ${score.value}`, [
        `High Score: ${highScore.value}`,
        '',
        'Press SPACE for a new game',
      ]);
    }
  }

  function drawOverlay(title: string, subtitle: string, extra?: string[]) {
    if (!ctx) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#fafafa';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);

    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(subtitle, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

    if (extra) {
      ctx.font = '14px system-ui, sans-serif';
      extra.forEach((line, i) => {
        ctx!.fillText(line, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30 + i * 22);
      });
    }
  }

  return {
    // State
    gameState,
    score,
    highScore,
    lives,
    level,
    activePowerUps,

    // Methods
    init,
    cleanup,
    start,
    togglePause,
  };
}
