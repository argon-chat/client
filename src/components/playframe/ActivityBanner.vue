<template>
  <div v-if="show" class="activity-banner-stack">
    <div v-for="a in activities" :key="a.sessionId" class="activity-banner">
      <div class="icon">
        <Gamepad2 class="w-5 h-5" />
      </div>
      <div class="info">
        <span class="title">
          <b>{{ a.hostName }}</b> is playing <b>{{ a.gameTitle }}</b>
        </span>
        <span class="sub">{{ statusText(a) }}</span>
      </div>
      <Button v-if="a.joinable" size="sm" @click="activity.joinActivity(a)">
        Join
      </Button>
      <Button
        v-else-if="canWatch(a)"
        size="sm"
        variant="secondary"
        @click="activity.spectateActivity(a)"
      >
        Watch
      </Button>
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

const activity = usePlayFrameActivity();

const activities = computed(() => activity.joinableActivities);
// Only surface activities while you are not already in one.
const show = computed(() => !activity.isActive && activities.value.length > 0);

function canWatch(a: ActivityPresence): boolean {
  return a.spectatable && a.state === "playing";
}

function statusText(a: ActivityPresence): string {
  if (a.state === "waiting") return `Waiting for players (${a.playerCount}/${a.maxPlayers})`;
  if (a.state === "playing") {
    if (a.joinable) return "In progress — open slot";
    return a.mode === "solo" ? "Solo vs bot" : "Match in progress";
  }
  if (a.state === "gameover") return "Match finished";
  return a.mode === "solo" ? "Solo game" : "In lobby";
}
</script>

<style scoped>
.activity-banner-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.activity-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--card) / 0.6);
  backdrop-filter: blur(8px);
}

.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: calc(var(--radius) - 4px);
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
  flex-shrink: 0;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.title {
  font-size: 13px;
  color: hsl(var(--foreground));
}

.sub {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
</style>
