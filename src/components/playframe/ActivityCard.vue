<template>
  <!-- Mirrors ParticipantCard's shell so it drops into the media grid as a tile.
       Single "Join" — the game decides if you end up a player or a spectator. -->
  <div class="participant-card activity-card" :class="className" :style="customStyle">
    <div class="ac-body">
      <div class="ac-icon">
        <Gamepad2 class="w-6 h-6" />
      </div>
      <div class="ac-title">{{ presence.gameTitle }}</div>
      <div class="ac-sub">{{ presence.hostName }} · {{ statusText }}</div>
      <Button size="sm" class="ac-btn" @click="activity.joinActivity(presence)">
        Join
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

const props = defineProps<{
  presence: ActivityPresence;
  className?: string;
  customStyle?: Record<string, any>;
}>();

const activity = usePlayFrameActivity();

const statusText = computed(() => {
  const a = props.presence;
  if (a.state === "waiting") return "In lobby";
  if (a.state === "playing") return a.mode === "solo" ? "Solo vs bot" : "In progress";
  if (a.state === "gameover") return "Finished";
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
  border: 1px solid hsl(var(--primary) / 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ac-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  max-width: 100%;
  text-align: center;
}

.ac-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
  flex-shrink: 0;
}

.ac-title {
  font-weight: 600;
  font-size: 14px;
  color: hsl(var(--foreground));
  line-height: 1.1;
}

.ac-sub {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ac-btn {
  margin-top: 2px;
}
</style>
