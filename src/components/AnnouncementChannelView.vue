<template>
    <div class="channel-chat flex flex-col h-full rounded-lg">
        <div v-if="channelData" class="header-list rounded-t-lg bg-cover bg-no-repeat bg-center contrast-125 relative"
            style="z-index: 3">
            <div class="p-4 flex flex-col border-b space-y-1">
                <div class="flex justify-between items-center">
                    <h2 class="text-lg font-bold relative z-10 text-white flex items-center">
                        <AntennaIcon class="mr-2" /> {{ channelData.name }}
                    </h2>
                </div>
            </div>
        </div>
        
        <div v-if="channelData && selectedChannelId && selectedSpaceId" ref="messageContainer"
            class="messages flex-1 overflow-y-auto space-y-4 rounded-t-lg pb-4 p-5">
            <ChatView :channel-id="selectedChannelId" :space-id="selectedSpaceId" @select-reply="onReplySelect" />
        </div>

        <div v-if="!channelData" class="flex flex-1 flex-col items-center justify-center text-center space-y-2 p-5">
            <div class="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <AntennaIcon class="h-10 w-10 text-muted-foreground" />
                <h3 class="mt-4 text-lg font-semibold">
                    {{ t("no_announcement_channel_found") }}
                </h3>
                <p class="mb-4 mt-2 text-sm text-muted-foreground">
                    {{ t("you_not_access_to_channel_or_not_found_channels") }}
                </p>
            </div>
        </div>

        <!-- Input area for users with ManageChannels permission -->
        <div v-if="channelData && canManageChannels" class="message-input rounded-b-lg flex items-center space-x-3 p-5">
            <EnterText style="width: 100%;" :reply-to="replyTo" :space-id="selectedSpaceId!" @clear-reply="replyTo = null" @typing="onTypingEvent"
                @stop_typing="onStopTypingEvent" />
        </div>

        <!-- Follow banner for users without ManageChannels permission -->
        <div v-else-if="channelData" class="announcement-banner rounded-b-lg flex items-center justify-center p-4">
            <div class="flex items-center gap-3 text-muted-foreground">
                <BellIcon class="h-5 w-5" />
                <span class="text-sm">{{ t("follow_to_get_updates") }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { AntennaIcon, BellIcon } from "lucide-vue-next";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useLocale } from "@/store/localeStore";
import EnterText from "./chats/EnterText.vue";
import ChatView from "./ChatView.vue";
import { usePoolStore } from "@/store/poolStore";
import { usePexStore } from "@/store/permissionStore";
import { logger } from "@/lib/logger";
import type { Subscription } from "rxjs";
import { useBus } from "@/store/busStore";
import { ArgonChannel, ArgonMessage, IAmStopTypingEvent, IAmTypingEvent } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";

const { t } = useLocale();
const pool = usePoolStore();
const pex = usePexStore();
const bus = useBus();

const channelData = ref(null as null | ArgonChannel);
const subs = ref(null as Subscription | null);
const messageContainer = ref<HTMLElement | null>(null);

const canManageChannels = computed(() => pex.has('ManageChannels'));

const getChannel = (channelId: Guid) => pool.getChannel(channelId);

const replyTo = ref<ArgonMessage | null>(null);

function onReplySelect(message: ArgonMessage) {
    replyTo.value = message;
}

const selectedSpaceId = defineModel<string | null>('selectedSpace', {
    type: String, required: true
});

const selectedChannelId = defineModel<string | null>('selectedChannelId', {
    type: String, required: true
});

const onTypingEvent = () => {
    if (!channelData.value) return;
    bus.sendEventAsync(new IAmTypingEvent(channelData.value.channelId));
};

const onStopTypingEvent = () => {
    if (!channelData.value) return;
    bus.sendEventAsync(new IAmStopTypingEvent(channelData.value.channelId));
};

onMounted(async () => {
    subs.value = pool.onChannelChanged.subscribe(onChannelChanged);

    if (selectedChannelId.value) {
        logger.log("Selected announcement channel", selectedChannelId.value);
        const channel = await getChannel(selectedChannelId.value);
        if (channel) channelData.value = channel;
    }
});

onUnmounted(() => {
    subs.value?.unsubscribe();
});

const onChannelChanged = async (channelId: Guid | null) => {
    logger.log("onChannelChanged (announcement)");
    selectedChannelId.value = channelId;
    if (channelId) {
        const channel = await getChannel(channelId);
        if (channel) channelData.value = channel;
    }
};

watch(selectedChannelId, async (id) => {
    if (id) {
        const channel = await getChannel(id);
        if (channel) channelData.value = channel;
    } else {
        channelData.value = null;
    }
});
</script>

<style scoped>
.header-list {
    background-color: #161616;
    padding-top: 5px;
}

.announcement-banner {
    background-color: hsl(var(--muted));
    border-top: 1px solid hsl(var(--border));
}
</style>
