<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="icon-motion icon-motion--pop flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-transparent text-muted-foreground cursor-pointer transition-colors hover:bg-muted-foreground/[0.12] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        :title="t('schedule_send')"
        :aria-label="t('schedule_send')"
        data-testid="schedule-send"
      >
        <Clock3Icon class="w-5 h-5" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-2" align="end" side="top">
      <ScheduleTimePicker v-if="open" @pick="onPick" />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Clock3Icon } from "lucide-vue-next";
import { Popover, PopoverContent, PopoverTrigger } from "@argon/ui/popover";
import { useLocale } from "@/store/system/localeStore";
import ScheduleTimePicker from "./ScheduleTimePicker.vue";

const emit = defineEmits<{ (e: "schedule", at: Date): void }>();

const { t } = useLocale();
const open = ref(false);

function onPick(at: Date) {
  open.value = false;
  emit("schedule", at);
}
</script>
