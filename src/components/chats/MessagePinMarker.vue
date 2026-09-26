<template>
  <span
    v-if="pinned"
    class="pointer-events-auto flex items-center justify-center w-4 h-4 rounded-full bg-card text-primary ring-1 ring-border/60 shadow-sm"
    :title="t('pins_marker')"
    :aria-label="t('pins_marker')"
    data-testid="message-pin-marker"
  >
    <PinIcon class="w-2.5 h-2.5 rotate-45" />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PinIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import { usePinStore } from "@/store/data/pinStore";

const props = defineProps<{ channelId: string; messageId: bigint }>();

const { t } = useLocale();
const pins = usePinStore();

const pinned = computed(() => pins.isPinned(props.channelId, props.messageId));
</script>
