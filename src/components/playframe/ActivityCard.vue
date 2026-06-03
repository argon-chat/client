<template>
  <!-- Mirrors ParticipantCard's shell so it drops into the media grid as a tile. -->
  <div class="participant-card activity-card" :class="className" :style="customStyle">
    <div class="ac-body">
      <div class="ac-icon">
        <Gamepad2 class="w-7 h-7" />
      </div>
      <div class="ac-title">{{ presence.gameTitle }}</div>
      <div class="ac-status">{{ statusText }}</div>
      <Button v-if="presence.joinable" size="sm" class="ac-btn" @click="activity.joinActivity(presence)">
        Join Activity
      </Button>
      <Button
        v-else-if="canWatch"
        size="sm"
        variant="secondary"
        class="ac-btn"
        @click="activity.spectateActivity(presence)"
      >
        Watch
      </Button>
    </div>

    <!-- Bottom name overlay (matches participant cards) -->
    <div class="participant-overlay text-center">
      <span class="participant-name text-xs">{{ presence.hostName }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  usePlayFrameActivity,
  type ActivityPresence,
} from "@/store/features/playframeStore";
import { Button } from "@argon/ui/button";
import { Gamepad2 } from "lucide-vue-next";

const props = defineProps<{
  presence: ActivityPresence;
  className?: string;
  customStyle?: Record<string, any>;
}>();

const activity = usePlayFrameActivity();

const canWatch = computed(
  () => props.presence.spectatable && props.presence.state === "playing",
);

const statusText = computed(() => {
  const a = props.presence;
  if (a.state === "waiting") return `Waiting for players (${a.playerCount}/${a.maxPlayers})`;
  if (a.state === "playing") return a.mode === "solo" ? "Solo vs bot" : "Match in progress";
  if (a.state === "gameover") return "Match finished";
  return "In lobby";
});
</script>

<style scoped>
/* Shell — kept in sync with ParticipantCard.vue */
.participant-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.activity-card {
  border-color: hsl(var(--primary) / 0.4);
}

.ac-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  text-align: center;
}

.ac-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}

.ac-title {
  font-weight: 600;
  font-size: 14px;
  color: hsl(var(--foreground));
}

.ac-status {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.ac-btn {
  margin-top: 4px;
}

.participant-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, hsl(var(--card) / 0.9), hsl(var(--card) / 0.5) 60%, transparent);
  padding: 1.5rem 0.5rem 0.375rem;
  display: flex;
  justify-content: center;
}

.participant-name {
  color: hsl(var(--muted-foreground));
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
