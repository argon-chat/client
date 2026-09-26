<template>
  <ContextMenuItem data-testid="message-pin-toggle" @select="toggle(message.messageId)">
    <PinOffIcon v-if="pinned" class="w-4 h-4 mr-2 opacity-60" />
    <PinIcon v-else class="w-4 h-4 mr-2 opacity-60" />
    {{ pinned ? t('pins_unpin') : t('pins_pin') }}
  </ContextMenuItem>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PinIcon, PinOffIcon } from "lucide-vue-next";
import type { ArgonMessage } from "@argon/glue";
import { ContextMenuItem } from "@argon/ui/context-menu";
import { useLocale } from "@/store/system/localeStore";
import { useChannelPins } from "@/composables/useChannelPins";

const props = defineProps<{ message: ArgonMessage }>();

const { t } = useLocale();
const { isPinned, toggle } = useChannelPins(() => props.message.channelId, () => props.message.spaceId);

const pinned = computed(() => isPinned(props.message.messageId));
</script>
