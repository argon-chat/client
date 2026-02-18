<template>
  <Dialog v-model:open="activity.isPickerOpen">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Gamepad2 class="w-5 h-5" />
          {{ t("start_activity") }}
        </DialogTitle>
        <DialogDescription>
          {{ t("select_game_description") }}
        </DialogDescription>
      </DialogHeader>

      <div class="games-grid">
        <div
          v-for="game in activity.availableGames"
          :key="game.id"
          class="game-card"
          :class="{ selected: selectedGame?.id === game.id }"
          @click="selectedGame = game"
        >
          <div class="game-thumbnail">
            <img 
              v-if="game.thumbnail" 
              :src="game.thumbnail" 
              :alt="game.title"
            />
            <Gamepad2 v-else class="w-12 h-12 text-muted-foreground" />
          </div>
          <div class="game-info">
            <h3 class="game-title">{{ game.title }}</h3>
            <p class="game-description">{{ game.description }}</p>
            <div class="game-meta">
              <Badge variant="secondary" class="text-xs">
                {{ game.minPlayers }}-{{ game.maxPlayers }} {{ t("players") }}
              </Badge>
              <span class="game-developer">{{ game.developer }}</span>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="activity.closePicker()">
          {{ t("cancel") }}
        </Button>
        <Button 
          :disabled="!selectedGame || isStarting"
          @click="startSelectedGame"
        >
          <Loader2 v-if="isStarting" class="w-4 h-4 mr-2 animate-spin" />
          {{ t("start") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { usePlayFrameActivity, type GameManifest } from "@/store/playframeStore";
import { useLocale } from "@/store/localeStore";
import { Button } from "@argon/ui/button";
import { Badge } from "@argon/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@argon/ui/dialog";
import { Gamepad2, Loader2 } from "lucide-vue-next";

const { t } = useLocale();
const activity = usePlayFrameActivity();

const selectedGame = ref<GameManifest | null>(null);
const isStarting = ref(false);

// Reset selection when picker opens
watch(
  () => activity.isPickerOpen,
  (open) => {
    if (open) {
      selectedGame.value = activity.availableGames[0] || null;
      isStarting.value = false;
    }
  }
);

async function startSelectedGame() {
  if (!selectedGame.value) return;

  isStarting.value = true;
  activity.selectGame(selectedGame.value);
  isStarting.value = false;
}
</script>

<style scoped>
.games-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
  padding: 4px;
}

.game-card {
  display: flex;
  flex-direction: column;
  border: 2px solid transparent;
  border-radius: 8px;
  background: hsl(var(--muted) / 0.3);
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
}

.game-card:hover {
  background: hsl(var(--muted) / 0.5);
  border-color: hsl(var(--border));
}

.game-card.selected {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
}

.game-thumbnail {
  aspect-ratio: 16 / 9;
  background: hsl(var(--muted));
  display: flex;
  align-items: center;
  justify-content: center;
}

.game-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.game-info {
  padding: 12px;
}

.game-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
}

.game-description {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 8px;
  line-height: 1.4;
}

.game-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.game-developer {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
</style>
