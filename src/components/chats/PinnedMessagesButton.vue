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
        :loading="!loaded && !failed"
        :failed="failed"
        @jump="onJump"
        @unpin="unpin"
        @retry="refresh(true)"
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
  /** Scrolls to the message, loading the history around it if need be; false when it is gone. */
  jumpTo: (messageId: bigint) => boolean | Promise<boolean>;
}>();

const { t } = useLocale();
const { toast } = useToast();
const bus = useBus();

const open = ref(false);
const { pins, count, loaded, failed, canManage, refresh, unpin } = useChannelPins(() => props.channelId, () => props.spaceId);

// Channel-scoped events reach only the open channel and are not replayed: a channel opened again
// after a while is loaded again (see PIN_TTL_MS), and so is a list a pin event could not fill in,
// once the panel opens. A resumed session missed nothing; a reconnect or a resync may have.
watch(() => [props.channelId, props.spaceId], () => {
  open.value = false;
  void refresh();
}, { immediate: true });

watch(open, (isOpen) => {
  if (isOpen) void refresh();
});

const subscriptions = [bus.reconnected, bus.needFullResync].map((s) => s.subscribe(() => void refresh(true)));
onUnmounted(() => subscriptions.forEach((s) => s.unsubscribe()));

async function onJump(messageId: bigint) {
  if (await props.jumpTo(messageId)) {
    open.value = false;
    return;
  }
  toast({ title: t('message_jump_gone') });
}
</script>
