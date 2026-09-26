<template>
  <div class="flex flex-col max-h-[min(60vh,30rem)]" data-testid="pinned-messages-panel">
    <div class="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border/40">
      <PinIcon class="w-4 h-4 text-muted-foreground rotate-45" />
      <span class="text-sm font-semibold">{{ t('pins_title') }}</span>
      <span v-if="pins.length" class="ml-auto text-xs text-muted-foreground tabular-nums">{{ pins.length }}/{{ PIN_LIMIT }}</span>
    </div>

    <div v-if="loading && !pins.length" class="flex justify-center py-8">
      <Loader2Icon class="w-5 h-5 animate-spin text-muted-foreground" />
    </div>

    <div
      v-else-if="!pins.length"
      class="flex flex-col items-center text-center gap-1.5 px-6 py-8"
      data-testid="pinned-messages-empty"
    >
      <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-1">
        <PinIcon class="w-5 h-5 text-muted-foreground rotate-45" />
      </div>
      <p class="text-sm font-medium">{{ t('pins_empty') }}</p>
      <p class="text-xs text-muted-foreground leading-relaxed">{{ t('pins_empty_hint') }}</p>
    </div>

    <div v-else class="overflow-y-auto p-1.5 flex flex-col gap-0.5">
      <PinnedMessageRow
        v-for="pin in pins"
        :key="String(pin.message.messageId)"
        :pin="pin"
        :can-manage="canManage"
        @jump="(id) => emit('jump', id)"
        @unpin="(id) => emit('unpin', id)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Loader2Icon, PinIcon } from "lucide-vue-next";
import type { PinnedMessage } from "@argon/glue";
import PinnedMessageRow from "@/components/chats/PinnedMessageRow.vue";
import { useLocale } from "@/store/system/localeStore";
import { PIN_LIMIT } from "@/store/data/pinStore";

withDefaults(defineProps<{
  pins: readonly PinnedMessage[];
  canManage: boolean;
  loading?: boolean;
}>(), { loading: false });

const emit = defineEmits<{
  (e: "jump", messageId: bigint): void;
  (e: "unpin", messageId: bigint): void;
}>();

const { t } = useLocale();
</script>
