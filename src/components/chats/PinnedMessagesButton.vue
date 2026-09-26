<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        v-bind="$attrs"
        class="icon-motion icon-motion--pop relative flex items-center justify-center gap-1 h-8 min-w-8 px-1.5 bg-transparent border-none rounded-lg text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
        :class="{ 'bg-accent text-foreground': open }"
        :title="t('pins_title')"
        :aria-label="t('pins_title')"
        data-testid="pinned-messages-button"
      >
        <PinIcon class="w-4 h-4 rotate-45" />
        <span v-if="count" class="text-xs font-medium tabular-nums leading-none" data-testid="pinned-messages-count">{{ count }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-[22rem] p-0 overflow-hidden" align="end">
      <PinnedMessagesPanel
        :pins="pins"
        :can-manage="canManage"
        :loading="!loaded"
        @jump="onJump"
        @unpin="unpin"
      />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import { PinIcon } from "lucide-vue-next";
import type { Guid } from "@argon-chat/ion.webcore";
import { Popover, PopoverContent, PopoverTrigger } from "@argon/ui/popover";
import { useToast } from "@argon/ui/toast";
import PinnedMessagesPanel from "@/components/chats/PinnedMessagesPanel.vue";
import { useChannelPins } from "@/composables/useChannelPins";
import { useBus } from "@/store/realtime/busStore";
import { useLocale } from "@/store/system/localeStore";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  channelId: Guid;
  spaceId?: Guid;
  /** Scrolls the list to the message; false when it is not loaded. */
  jumpTo: (messageId: bigint) => boolean;
}>();

const { t } = useLocale();
const { toast } = useToast();
const bus = useBus();

const open = ref(false);
const { pins, count, loaded, canManage, refresh, unpin } = useChannelPins(() => props.channelId, () => props.spaceId);

// Channel-scoped events reach only the open channel and are not replayed, so load on every open
// and again after the connection comes back.
watch(() => [props.channelId, props.spaceId], () => {
  open.value = false;
  void refresh();
}, { immediate: true });

const subscriptions = [bus.reconnected, bus.resumed, bus.needFullResync].map((s) => s.subscribe(() => void refresh()));
onUnmounted(() => subscriptions.forEach((s) => s.unsubscribe()));

function onJump(messageId: bigint) {
  if (props.jumpTo(messageId)) {
    open.value = false;
    return;
  }
  toast({ title: t('pins_not_loaded') });
}
</script>
