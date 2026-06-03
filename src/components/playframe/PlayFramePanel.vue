<template>
  <!-- When popped out, the panel (and its live iframe) teleports into the
       fullscreen overlay target without remounting the host. -->
  <Teleport to="#playframe-popout-target" :disabled="!activity.isPopout">
    <div v-if="activity.isActive" class="playframe-panel" :class="{ 'is-popout': activity.isPopout }">
      <div class="playframe-header">
        <div class="game-info">
          <Gamepad2 class="w-5 h-5" />
          <span class="game-title">{{ activity.currentGame?.title }}</span>
          <Badge v-if="roleLabel" variant="secondary" class="ml-2">
            {{ roleLabel }}
          </Badge>
          <Badge variant="outline" class="ml-1">
            {{ activity.hostState }}
          </Badge>
        </div>
        <div class="controls">
          <Button
            variant="ghost"
            size="icon"
            :title="activity.isPopout ? 'Dock' : 'Pop out'"
            @click="activity.togglePopout()"
          >
            <Shrink v-if="activity.isPopout" class="w-4 h-4" />
            <ExternalLink v-else class="w-4 h-4" />
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
        @pointerenter="focusGame"
        @pointerdown="focusGame"
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
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { usePlayFrameActivity } from "@/store/features/playframeStore";
import { useLocale } from "@/store/system/localeStore";
import { Button } from "@argon/ui/button";
import { Badge } from "@argon/ui/badge";
import {
  Gamepad2,
  X,
  Maximize2,
  Minimize2,
  Loader2,
  AlertCircle,
  ExternalLink,
  Shrink,
} from "lucide-vue-next";

const { t } = useLocale();
const activity = usePlayFrameActivity();

const gameContainer = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);

const roleLabel = computed(() => {
  switch (activity.myRole) {
    case "host":
      return "Host";
    case "player":
      return "Player";
    case "spectator":
      return "Spectating";
    default:
      return null;
  }
});

// The game iframe is sandboxed (opaque origin); keyboard input only reaches it
// while the iframe element holds focus. Nothing focuses it automatically, so we
// focus it on ready, on click, and after it moves between surfaces (popout).
function focusGame() {
  const iframe = gameContainer.value?.querySelector("iframe");
  iframe?.focus({ preventScroll: true });
}

watch(
  () => activity.hostState,
  async (state) => {
    if (state === "ready") {
      await nextTick();
      focusGame();
    }
  }
);

watch(
  () => activity.isPopout,
  async () => {
    await nextTick();
    focusGame();
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
  background: hsl(var(--card) / 0.6);
  backdrop-filter: blur(8px);
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: var(--radius);
  overflow: hidden;
  height: 100%;
}

.playframe-panel.is-popout {
  width: 100%;
  height: 100%;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
}

.playframe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px 6px 12px;
  background: hsl(var(--card) / 0.4);
  border-bottom: 1px solid hsl(var(--border) / 0.4);
  flex-shrink: 0;
}

.game-info {
  display: flex;
  align-items: center;
  gap: 8px;
  color: hsl(var(--foreground));
}

.game-info :deep(svg) {
  color: hsl(var(--primary));
}

.game-title {
  font-weight: 600;
  font-size: 13px;
}

.controls {
  display: flex;
  gap: 2px;
}

.game-container {
  position: relative;
  flex: 1;
  min-height: 0;
  background: hsl(var(--background));
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
  background: hsl(var(--background) / 0.85);
  backdrop-filter: blur(4px);
  color: hsl(var(--foreground));
  font-size: 13px;
}
</style>
