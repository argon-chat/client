<script setup lang="ts">
import { computed } from "vue";
import type { NoteContent } from "@/cosmetics/kinds/widget-note";
import type { ResolvedCosmetic } from "@/cosmetics/types";

const props = defineProps<{ item: ResolvedCosmetic }>();

const content = computed(() => props.item.content as NoteContent | null);
</script>

<template>
  <div class="note-card">
    <div v-if="content?.heading" class="note-heading">{{ content.heading }}</div>
    <p v-if="content?.body" class="note-body">{{ content.body }}</p>
  </div>
</template>

<style scoped>
.note-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.note-heading {
  font-size: 0.78rem;
  font-weight: 600;
}

.note-body {
  font-size: 0.74rem;
  line-height: 1.35;
  color: hsl(var(--muted-foreground));
  white-space: pre-wrap;
}
</style>
