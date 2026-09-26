<template>
  <div class="flex flex-col gap-1 w-64" data-testid="schedule-picker">
    <p class="px-1 pb-0.5 text-xs font-semibold text-muted-foreground">{{ title ?? t("schedule_send_title") }}</p>

    <button
      v-for="preset in presets"
      :key="preset.id"
      type="button"
      class="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      :data-testid="`schedule-preset-${preset.id}`"
      @click="emit('pick', preset.at)"
    >
      <span>{{ t(PRESET_KEYS[preset.id]) }}</span>
      <span class="text-xs text-muted-foreground tabular-nums">{{ formatWhen(preset.at) }}</span>
    </button>

    <div class="mt-1 flex flex-col gap-1.5 border-t border-border px-1 pt-2">
      <span class="text-xs text-muted-foreground">{{ t("schedule_custom") }}</span>
      <div class="flex gap-1.5">
        <input
          v-model="date"
          type="date"
          :min="bounds.minDate"
          :max="bounds.maxDate"
          class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          data-testid="schedule-date"
        />
        <input
          v-model="time"
          type="time"
          class="h-8 w-[88px] rounded-md border border-input bg-background px-2 text-sm"
          data-testid="schedule-time"
        />
      </div>
      <p v-if="problem" class="text-[11px] leading-snug text-destructive" data-testid="schedule-problem">
        {{ t(PUBLISH_TIME_KEYS[problem]) }}
      </p>
      <Button size="sm" class="h-8" :disabled="!!problem" data-testid="schedule-confirm" @click="pickCustom">
        {{ confirmLabel ?? t("schedule_confirm") }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@argon/ui/button";
import { useLocale } from "@/store/system/localeStore";
import {
  MAX_LEAD_MS,
  PUBLISH_TIME_KEYS,
  checkPublishAt,
  combineDateTime,
  schedulePresets,
  splitDateTime,
  type SchedulePresetId,
} from "@/composables/useScheduledPosts";

const props = defineProps<{
  /** Pre-fills the custom time, e.g. the post's current time when rescheduling. */
  initial?: Date;
  title?: string;
  confirmLabel?: string;
}>();

const emit = defineEmits<{ (e: "pick", at: Date): void }>();

const { t } = useLocale();

const PRESET_KEYS: Record<SchedulePresetId, string> = {
  in_1h: "schedule_preset_in_1h",
  tomorrow_9: "schedule_preset_tomorrow_9",
};

const now = new Date();
const presets = schedulePresets(now);

const start = splitDateTime(props.initial ?? new Date(now.getTime() + 60 * 60_000));
const date = ref(start.date);
const time = ref(start.time);

const bounds = {
  minDate: splitDateTime(now).date,
  maxDate: splitDateTime(new Date(now.getTime() + MAX_LEAD_MS)).date,
};

const chosen = computed(() => combineDateTime(date.value, time.value));
const problem = computed(() => checkPublishAt(chosen.value, new Date()));

const whenFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
const formatWhen = (at: Date) => whenFormat.format(at);

function pickCustom() {
  // Checked again at click time: the popover may have been open for a while.
  if (!chosen.value || checkPublishAt(chosen.value, new Date())) return;
  emit("pick", chosen.value);
}
</script>
