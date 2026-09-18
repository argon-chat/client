<template>
  <span class="status-dot" :class="me.statusClass(status)" :style="sizeStyle" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMe } from "@/store/auth/meStore";
import { UserStatus } from "@argon/glue";

const me = useMe();

const props = withDefaults(
  defineProps<{
    status: UserStatus;
    size?: number;
  }>(),
  { size: 12 },
);

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${Math.round(props.size * 0.77)}px`,
}));
</script>

<style lang="css" scoped>
.status-dot {
  display: block;
  border-radius: 9999px;
  border: 2px solid hsl(var(--card));
  flex-shrink: 0;

  /*
   * Above every decoration, always.
   *
   * Whether somebody is here is not decoration and cannot be something a ring hides. A decoration
   * asks for z-index 2 inside an avatar that makes no stacking context of its own, so the two were
   * competing in the same context and the dot — asking for nothing — lost.
   */
  position: relative;
  z-index: 5;
}
</style>
