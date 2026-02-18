<template>
  <Transition name="slide-up">
    <div v-if="activity.isActive" class="playframe-panel">
      <div class="playframe-header">
        <div class="game-info">
          <Gamepad2 class="w-5 h-5" />
          <span class="game-title">{{ activity.currentGame?.title }}</span>
          <Badge variant="outline" class="ml-2">
            {{ activity.hostState }}
          </Badge>
        </div>
        <div class="controls">
          <Button 
            v-if="activity.hostState === 'ready'" 
            variant="ghost" 
            size="icon"
            @click="activity.pauseActivity()"
          >
            <Pause class="w-4 h-4" />
          </Button>
          <Button 
            v-if="activity.hostState === 'paused'" 
            variant="ghost" 
            size="icon"
            @click="activity.resumeActivity()"
          >
            <Play class="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            @click="toggleFullscreen"
          >
            <Maximize2 v-if="!isFullscreen" class="w-4 h-4" />
            <Minimize2 v-else class="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            class="text-destructive hover:text-destructive"
            @click="activity.stopActivity()"
          >
            <X class="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div 
        ref="gameContainer" 
        class="game-container"
        :class="{ fullscreen: isFullscreen }"
      >
        <!-- Game iframe will be inserted here by PlayFrameHost -->
        <div v-if="activity.hostState === 'loading'" class="loading-overlay">
          <Loader2 class="w-8 h-8 animate-spin" />
          <span>{{ t("loading_game") }}</span>
        </div>
        <div v-if="activity.error" class="error-overlay">
          <AlertCircle class="w-8 h-8 text-destructive" />
          <span>{{ activity.error }}</span>
          <Button variant="outline" @click="activity.stopActivity()">
            {{ t("close") }}
          </Button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { usePlayFrameActivity } from "@/store/playframeStore";
import { useLocale } from "@/store/localeStore";
import { Button } from "@argon/ui/button";
import { Badge } from "@argon/ui/badge";
import {
  Gamepad2,
  Pause,
  Play,
  X,
  Maximize2,
  Minimize2,
  Loader2,
  AlertCircle,
} from "lucide-vue-next";

const { t } = useLocale();
const activity = usePlayFrameActivity();

const gameContainer = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);

// Start game when container is available
watch(
  () => activity.isPickerOpen,
  async (selected) => {
    // Game selection handled by picker, we just provide the container
  }
);

// Initialize host when container becomes available and we have a pending game
watch(
  () => activity.currentGame,
  async (game) => {
    if (game && !activity.host) {
      await nextTick();
      if (gameContainer.value) {
        await activity.initializeHost(gameContainer.value);
      }
    }
  }
);

function toggleFullscreen() {
  if (!gameContainer.value) return;
  
  if (!isFullscreen.value) {
    gameContainer.value.requestFullscreen?.();
    isFullscreen.value = true;
  } else {
    document.exitFullscreen?.();
    isFullscreen.value = false;
  }
}

// Handle fullscreen changes
function handleFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

// Also check on mount in case currentGame is already set
onMounted(async () => {
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  
  // Initialize if we have a pending game
  await nextTick();
  if (activity.currentGame && !activity.host && gameContainer.value) {
    await activity.initializeHost(gameContainer.value);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
});

// Expose container for external use
defineExpose({
  getContainer: () => gameContainer.value,
});
</script>

<style scoped>
.playframe-panel {
  display: flex;
  flex-direction: column;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  height: 100%;
}

.playframe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: hsl(var(--muted));
  border-bottom: 1px solid hsl(var(--border));
  flex-shrink: 0;
}

.game-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.game-title {
  font-weight: 600;
  font-size: 14px;
}

.controls {
  display: flex;
  gap: 4px;
}

.game-container {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.game-container.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9999;
}

.game-container :deep(iframe) {
  width: 100%;
  height: 100%;
  border: none;
}

.loading-overlay,
.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
}

/* Animations */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
