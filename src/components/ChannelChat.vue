<template>
    <div class="channel-chat flex flex-col h-full rounded-lg">
        <div v-if="channelData"
            class="header-list rounded-t-lg overflow-hidden bg-cover bg-no-repeat bg-center contrast-125">
            <div class="relative p-4 flex justify-between items-center border-b">
                <h2 class="text-lg font-bold relative z-10 text-white" style="display: flex; text-align: center; align-items: anchor-center;">
                    <HashIcon style="margin-right: 0.5rem"/> {{ channelData.Name }} 
                </h2>
            </div>
        </div>
        <div v-if="channelData && hiddenChannelId" ref="messageContainer"
            class="messages flex-1 overflow-y-auto space-y-4 rounded-t-lg pb-4 p-5">
            <ChatView :channel-id="hiddenChannelId"/>
        </div>

        <div v-if="!channelData" class="flex flex-1 flex-col items-center justify-center text-center space-y-2 p-5">
            <div class="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <RadioIcon class="h-10 w-10 text-muted-foreground" />
                <h3 class="mt-4 text-lg font-semibold">
                    {{ t("no_text_channel_found") }}
                </h3>
                <p class="mb-4 mt-2 text-sm text-muted-foreground">
                    {{ t("you_not_access_to_channel_or_not_found_channels") }}
                </p>
            </div>
        </div>

        <div v-if="channelData" class="message-input rounded-b-lg flex items-center space-x-3 p-5">
            <EnterText style="width: 100%;" />
        </div>
    </div>
</template>
<script setup lang="ts">
import { RadioIcon } from 'lucide-vue-next';
import { onMounted, onUnmounted, ref } from 'vue'
import { useLocale } from '@/store/localeStore';
import EnterText from './chats/EnterText.vue';
import ChatView from './ChatView.vue';
import { usePoolStore } from '@/store/poolStore';
import { logger } from '@/lib/logger';
import { Subscription } from 'rxjs';
import {
  HashIcon
} from 'lucide-vue-next';
const { t } = useLocale();
const pool = usePoolStore();

const channelData = ref(null as null | IChannel);
const subs = ref(null as Subscription | null);
const hiddenChannelId = ref(null as null | Guid);

const messageContainer = ref<HTMLElement | null>(null);

const getChannel = function (channelId: Guid) {
    return pool.getChannel(channelId);
}

onMounted(async () => {
    subs.value = pool.onChannelChanged.subscribe(onChannelChanged)

    if (pool.selectedChannel) {
        logger.log("Selected channel", pool.selectedChannel);
        channelData.value = (await getChannel(pool.selectedChannel!))!;
    }
});

onUnmounted(() => {
    subs.value?.unsubscribe();
})

const onChannelChanged = async function(channelId: Guid | null) {
    logger.log("onChannelChanged");
    hiddenChannelId.value = channelId;
    if (channelId)
        channelData.value = (await getChannel(channelId!))!;
}

</script>

<style scoped>
.editor:focus {
    border: 1px solid #4a90e2;
}

.header-list {
    background-color: #161616;
    padding-top: 5px;
}
</style>
