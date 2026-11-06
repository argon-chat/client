<template>
  <div class="flex items-center gap-3 py-3 select-none">
    <div class="flex-1 h-px bg-border/40" />
    <span class="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
      {{ label }}
    </span>
    <div class="flex-1 h-px bg-border/40" />
  </div>
</template>

<script lang="ts">
// One formatter for every separator. `toLocaleDateString` with options builds a new
// Intl.DateTimeFormat on each call, and a separator's label is worked out again whenever the list
// re-renders its row. Same locale (the default) and options, so the same text. A formatter keeps the
// time zone it was made in, so a new one is made when the zone's offset moves (the machine's zone
// changed, or a DST switch).
let dayFormat: Intl.DateTimeFormat | null = null;
let dayFormatOffset = 0;
function formatDay(d: Date, now: Date): string {
  const offset = now.getTimezoneOffset();
  if (!dayFormat || offset !== dayFormatOffset) {
    dayFormat = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    dayFormatOffset = offset;
  }
  return dayFormat.format(d);
}
</script>

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

  return formatDay(d, now);
});
</script>
