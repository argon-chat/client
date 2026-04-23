<template>
  <div class="flex items-center gap-3 py-3 select-none">
    <div class="flex-1 h-px bg-border/40" />
    <span class="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
      {{ label }}
    </span>
    <div class="flex-1 h-px bg-border/40" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ date: Date }>();

const label = computed(() => {
  const d = props.date;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === yesterday.getTime()) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
});
</script>
