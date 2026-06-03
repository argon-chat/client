<template>
  <!-- Teleport target for the popped-out PlayFrame panel. Always present in the
       DOM so <Teleport> can resolve it; only becomes a visible overlay while
       activity.isPopout is true. -->
  <div
    id="playframe-popout-target"
    class="playframe-popout"
    :class="{ active: activity.isPopout }"
    @click.self="activity.closePopout()"
  />
</template>

<script setup lang="ts">
import { usePlayFrameActivity } from "@/store/features/playframeStore";

const activity = usePlayFrameActivity();
</script>

<style scoped>
.playframe-popout:not(.active) {
  display: none;
}

.playframe-popout.active {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
}

.playframe-popout.active :deep(.playframe-panel) {
  width: min(1280px, 95vw);
  height: min(820px, 92vh);
}
</style>
