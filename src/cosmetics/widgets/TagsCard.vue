<script setup lang="ts">
import { computed } from "vue";
import type { TagsContent } from "@/cosmetics/kinds/widget-tags";
import type { ResolvedCosmetic } from "@/cosmetics/types";

const props = defineProps<{ item: ResolvedCosmetic }>();

const content = computed(() => props.item.content as TagsContent | null);
</script>

<template>
  <div class="tags-card">
    <div v-if="content?.heading" class="tags-heading">{{ content.heading }}</div>

    <div v-if="content?.tags?.length" class="tags-row">
      <span v-for="tag in content.tags" :key="tag" class="tag">{{ tag }}</span>
    </div>
  </div>
</template>

<style scoped>
.tags-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tags-heading {
  font-size: 0.78rem;
  font-weight: 600;
}

.tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  padding: 2px 8px;
  border-radius: 999px;
  background: hsl(var(--secondary) / 0.8);
  font-size: 0.68rem;
}
</style>
