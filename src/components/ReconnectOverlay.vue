<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import { useMagicKeys, whenever } from "@vueuse/core";
import { useBus } from "@/store/busStore";
import { useSystemStore } from "@/store/systemStore";
import { useSnakeGame } from "@/composables/useSnakeGame";

const sys = useSystemStore();
const bus = useBus();

const currentTime = ref(Date.now());
const reconnectStartTime = ref<number | null>(null);
const isGameMode = ref(false);
const isPlaying = ref(false);
const isReconnected = ref(false);
const selectedGame = ref<'snake' | 'dino' | null>(null);
const isDebugMode = ref(false);

// Snake game
const snakeCanvas = ref<HTMLCanvasElement | null>(null);
const snakeGame = useSnakeGame(snakeCanvas);

// Update current time every 100ms for smooth countdown
let timeInterval: NodeJS.Timeout | null = null;

// Debug mode hotkey (Alt+0 to toggle game overlay)
const keys = useMagicKeys();
const alt0 = keys['Alt+0'];

whenever(alt0, () => {
  isDebugMode.value = !isDebugMode.value;
  if (!isDebugMode.value) {
    closeOverlay();
  }
});

watch(() => sys.isLongReconnecting, (isReconnecting) => {
  if (isReconnecting && !timeInterval) {
    currentTime.value = Date.now();
    reconnectStartTime.value = Date.now();
    timeInterval = setInterval(() => {
      currentTime.value = Date.now();
    }, 100);
  } else if (!isReconnecting && timeInterval) {
    clearInterval(timeInterval);
    timeInterval = null;
    reconnectStartTime.value = null;
    
    if (!isPlaying.value) {
      closeOverlay();
    } else {
      isReconnected.value = true;
    }
  }
});

const secondsUntilNextAttempt = computed(() => {
  if (!bus.nextReconnectAttempt) return 0;
  const diff = Math.max(0, bus.nextReconnectAttempt - currentTime.value);
  return Math.ceil(diff / 1000);
});

const reconnectDuration = computed(() => {
  if (!sys.isLongReconnecting || !reconnectStartTime.value) return 0;
  return Math.floor((currentTime.value - reconnectStartTime.value) / 1000);
});

const showGameOption = computed(() => {
  return reconnectDuration.value > 15 || isGameMode.value;
});

const handleRetryNow = async () => {
  await bus.retryConnectionNow();
};

const startGame = (game: 'snake' | 'dino') => {
  selectedGame.value = game;
  isGameMode.value = true;
  isPlaying.value = true;
  
  if (game === 'snake') {
    nextTick(() => {
      snakeGame.init();
    });
  }
};

const closeOverlay = () => {
  if (selectedGame.value === 'snake') {
    snakeGame.cleanup();
  }
  isGameMode.value = false;
  isPlaying.value = false;
  isReconnected.value = false;
  selectedGame.value = null;
  isDebugMode.value = false;
};

onUnmounted(() => {
  snakeGame.cleanup();
  if (timeInterval) {
    clearInterval(timeInterval);
  }
});
</script>

<template>
  <Transition name="overlay-fade">
    <div v-if="sys.isLongReconnecting || isPlaying || isDebugMode" class="reconnect-overlay">
      <!-- Debug mode indicator -->
      <div v-if="isDebugMode" class="debug-indicator">
        🎮 Game Testing Mode (Alt+0 to close)
      </div>
      
      <!-- Header section -->
      <div class="reconnect-header" :class="{ 'header-compact': showGameOption  }" v-if="!isDebugMode">
        <div v-if="!isDebugMode" class="reconnect-spinner" :class="{ 'spinner-small': showGameOption }"></div>
        
        <div v-if="isReconnected && !isDebugMode" class="reconnected-badge">
          <svg class="check-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          Connection Restored
        </div>
        <h2 v-else class="reconnect-title" :class="{ 'title-small': showGameOption }">
          Connection Lost
        </h2>
        
        <p v-if="!isReconnected && !isDebugMode" class="reconnect-message" :class="{ 'message-small': showGameOption }">
          Reconnecting to Argon...
        </p>
        
        <div v-if="!isReconnected && !showGameOption" class="reconnect-info">
          <p v-if="secondsUntilNextAttempt > 0" class="reconnect-timer">
            Next attempt in {{ secondsUntilNextAttempt }}s
          </p>
          <p v-else class="reconnect-timer">Connecting...</p>
        </div>
        
        <button 
          v-if="!isReconnected && !showGameOption" 
          @click="handleRetryNow" 
          class="reconnect-retry-button"
        >
          Retry Now
        </button>
      </div>

      <!-- Game section -->
      <Transition name="game-slide">
        <div v-if="showGameOption || isDebugMode" class="game-container">
          <!-- Game selection -->
          <div v-if="!isPlaying" class="game-selection">
            <h3 class="game-title">While you wait...</h3>
            <p class="game-subtitle">Take a break with a mini game</p>
            
            <div class="game-options">
              <button @click="startGame('snake')" class="game-option">
                <div class="game-icon">🐍</div>
                <div class="game-name">Snake</div>
                <div class="game-description">Classic snake with bonuses</div>
              </button>
            </div>
          </div>

          <!-- Game playing area -->
          <div v-else class="game-playing">
            <!-- Snake Game -->
            <template v-if="selectedGame === 'snake'">
              <div class="snake-game-ui">
                <div class="snake-stats">
                  <div class="snake-stat">
                    <span class="stat-label">Score</span>
                    <span class="stat-value">{{ snakeGame.score.value }}</span>
                  </div>
                  <div class="snake-stat">
                    <span class="stat-label">High Score</span>
                    <span class="stat-value">{{ snakeGame.highScore.value }}</span>
                  </div>
                  <div class="snake-stat">
                    <span class="stat-label">Level</span>
                    <span class="stat-value">{{ snakeGame.level.value }}</span>
                  </div>
                  <div class="snake-stat lives">
                    <span class="stat-label">Lives</span>
                    <span class="stat-value">{{ '❤️'.repeat(Math.max(0, snakeGame.lives.value)) }}</span>
                  </div>
                </div>
                
                <div v-if="snakeGame.activePowerUps.value.length > 0" class="active-powerups">
                  <div 
                    v-for="powerUp in snakeGame.activePowerUps.value" 
                    :key="powerUp.type"
                    class="active-powerup"
                  >
                    <span class="powerup-emoji">{{ powerUp.emoji }}</span>
                    <span class="powerup-timer">{{ powerUp.timeLeft }}с</span>
                  </div>
                </div>
              </div>
              
              <div class="game-canvas-wrapper snake-canvas">
                <canvas ref="snakeCanvas"></canvas>
              </div>
            </template>
            
            
            <div class="game-controls">
              <button 
                v-if="selectedGame === 'snake' && snakeGame.gameState.value === 'playing'" 
                @click="snakeGame.togglePause" 
                class="game-pause-button"
              >
                Pause
              </button>
              <button @click="closeOverlay" class="game-close-button">
                {{ isReconnected ? 'Close and continue' : 'Go back' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.reconnect-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  z-index: 9998;
  padding: 2rem;
}

.debug-indicator {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.5rem 1rem;
  background: rgba(234, 179, 8, 0.2);
  border: 1px solid rgba(234, 179, 8, 0.4);
  border-radius: 0.5rem;
  color: #eab308;
  font-size: 0.75rem;
  font-weight: 600;
  z-index: 10;
}

/* Header section */
.reconnect-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  transition: all 0.3s ease;
}

.header-compact {
  position: absolute;
  top: 2rem;
  gap: 0.75rem;
}

.reconnect-spinner {
  width: 50px;
  height: 50px;
  border: 3px solid rgba(239, 68, 68, 0.1);
  border-top-color: #ef4444;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  transition: all 0.3s ease;
}

.spinner-small {
  width: 30px;
  height: 30px;
  border-width: 2px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.reconnected-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 0.5rem;
  color: #22c55e;
  font-size: 0.875rem;
  font-weight: 600;
  animation: badge-appear 0.4s ease;
}

@keyframes badge-appear {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.check-icon {
  width: 20px;
  height: 20px;
}

.reconnect-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0;
  transition: all 0.3s ease;
}

.title-small {
  font-size: 1.125rem;
}

.reconnect-message {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0;
  text-align: center;
  transition: all 0.3s ease;
}

.message-small {
  font-size: 0.75rem;
}

.reconnect-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
}

.reconnect-timer {
  font-size: 1rem;
  color: #ef4444;
  margin: 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.reconnect-retry-button {
  margin-top: 0.5rem;
  padding: 0.625rem 1.5rem;
  background: rgba(99, 102, 241, 0.9);
  color: white;
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.2);
}

.reconnect-retry-button:hover {
  background: rgba(129, 140, 248, 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.reconnect-retry-button:active {
  background: rgba(79, 70, 229, 0.9);
  transform: translateY(0);
}

/* Game container */
.game-container {
  width: 100%;
  max-width: 850px;
  background: rgba(24, 24, 27, 0.95);
  border: 1px solid rgba(63, 63, 70, 0.5);
  border-radius: 1rem;
  padding: 2rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

/* Game selection */
.game-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.game-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0;
}

.game-subtitle {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0;
}

.game-options {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 1rem;
  width: 100%;
}

.game-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 1rem;
  background: rgba(39, 39, 42, 0.8);
  border: 1px solid rgba(63, 63, 70, 0.5);
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.game-option:hover {
  background: rgba(51, 51, 57, 0.9);
  border-color: rgba(99, 102, 241, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
}

.game-icon {
  font-size: 3rem;
  margin-bottom: 0.5rem;
}

.game-name {
  font-size: 1rem;
  font-weight: 600;
  color: #fafafa;
}

.game-description {
  font-size: 0.75rem;
  color: #a1a1aa;
  text-align: center;
}

.game-status {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  font-size: 0.625rem;
  padding: 0.25rem 0.5rem;
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
  border-radius: 0.25rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Game playing area */
.game-playing {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.game-canvas-wrapper {
  aspect-ratio: 16 / 9;
  background: rgba(0, 0, 0, 0.5);
  border: 2px solid rgba(63, 63, 70, 0.8);
  border-radius: 0.5rem;
  overflow: hidden;
  position: relative;
}

.game-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 1rem;
  color: #71717a;
}

.game-placeholder h3 {
  font-size: 1.5rem;
  margin: 0;
}

.game-placeholder p {
  font-size: 0.875rem;
  margin: 0;
}

.game-controls {
  display: flex;
  justify-content: center;
  gap: 1rem;
}

.game-close-button {
  padding: 0.75rem 2rem;
  background: rgba(99, 102, 241, 0.9);
  color: white;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.game-close-button:hover {
  background: rgba(129, 140, 248, 0.9);
  transform: translateY(-1px);
}

.game-close-button:active {
  background: rgba(79, 70, 229, 0.9);
  transform: translateY(0);
}

.game-pause-button {
  padding: 0.75rem 1.5rem;
  background: rgba(63, 63, 70, 0.9);
  color: white;
  border: 1px solid rgba(82, 82, 91, 0.5);
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.game-pause-button:hover {
  background: rgba(82, 82, 91, 0.9);
  transform: translateY(-1px);
}

/* Snake Game Styles */
.snake-game-ui {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.snake-stats {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.snake-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.snake-stat .stat-label {
  font-size: 0.625rem;
  color: #71717a;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.snake-stat .stat-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: #fafafa;
  font-variant-numeric: tabular-nums;
}

.snake-stat.lives .stat-value {
  font-size: 0.875rem;
  letter-spacing: 0.1em;
}

.active-powerups {
  display: flex;
  gap: 0.5rem;
}

.active-powerup {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: rgba(99, 102, 241, 0.2);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 0.375rem;
  animation: pulse-glow 1s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% {
    box-shadow: 0 0 5px rgba(99, 102, 241, 0.3);
  }
  50% {
    box-shadow: 0 0 15px rgba(99, 102, 241, 0.5);
  }
}

.active-powerup .powerup-emoji {
  font-size: 1rem;
}

.active-powerup .powerup-timer {
  font-size: 0.75rem;
  font-weight: 600;
  color: #c4b5fd;
  font-variant-numeric: tabular-nums;
}

.snake-canvas {
  aspect-ratio: 800 / 480;
}

.snake-canvas canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 0.25rem;
}

.dino-canvas {
  aspect-ratio: 800 / 300;
}

.dino-canvas canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 0.25rem;
}

.dino-game-ui {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.dino-stats {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.dino-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.powerup-legend {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(39, 39, 42, 0.5);
  border-radius: 0.5rem;
  flex-wrap: wrap;
}

.legend-title {
  font-size: 0.75rem;
  color: #71717a;
  white-space: nowrap;
}

.legend-items {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.legend-item {
  font-size: 1rem;
  cursor: help;
  transition: transform 0.2s ease;
}

.legend-item:hover {
  transform: scale(1.3);
}

.legend-item.debuff {
  filter: drop-shadow(0 0 3px rgba(239, 68, 68, 0.5));
}

.legend-item.mystery {
  filter: drop-shadow(0 0 4px rgba(168, 85, 247, 0.6));
  animation: mystery-pulse 1.5s ease-in-out infinite;
}

@keyframes mystery-pulse {
  0%, 100% { filter: drop-shadow(0 0 4px rgba(168, 85, 247, 0.6)); }
  50% { filter: drop-shadow(0 0 8px rgba(168, 85, 247, 0.9)); }
}

.debuff-title {
  margin-left: 0.75rem;
  color: #ef4444 !important;
}

/* Transitions */
.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 0.3s ease;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}

.game-slide-enter-active,
.game-slide-leave-active {
  transition: all 0.4s ease;
}

.game-slide-enter-from {
  opacity: 0;
  transform: translateY(30px) scale(0.95);
}

.game-slide-leave-to {
  opacity: 0;
  transform: translateY(-30px) scale(0.95);
}
</style>
