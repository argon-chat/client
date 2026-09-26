<template>
  <span class="mass-mention">{{ text }}</span>
</template>
<script setup lang="ts">
import type { IMessageEntity } from "@argon/glue";

// @everyone and role mentions: the text already carries the name, and there is no one profile to open.
defineProps<{
  entity: IMessageEntity;
  text: string;
}>();
</script>
<style scoped>
.mass-mention {
  font-weight: 600;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
  border-radius: 4px;
  padding: 0 2px;
}
</style>
