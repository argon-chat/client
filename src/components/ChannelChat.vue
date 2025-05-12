<template>
    <div class="channel-chat flex flex-col h-full rounded-lg">
        <div v-if="channelData"
            class="header-list rounded-t-lg bg-cover bg-no-repeat bg-center contrast-125 relative" style="z-index: 3">
            <div class="p-4 flex flex-col border-b space-y-1">
                <div class="flex justify-between items-center">
                    <h2 class="text-lg font-bold relative z-10 text-white flex items-center">
                        <HashIcon class="mr-2" /> {{ channelData.Name }}
                    </h2>
                </div>
            </div>
            <Transition name="typing-slide">
                <div v-if="typingUsers.length > 0"
                    class="absolute top-full left-1/2 transform -translate-x-1/2 z-20 overflow-hidden">
                    <div
                        class="backdrop-blur-sm bg-black/30 rounded-b-lg px-4 py-2 text-sm text-white whitespace-nowrap text-center w-fit max-w-[90vw] min-w-[10rem] text-ellipsis overflow-hidden">
                        <span>
                            {{
                                typingUsers.length === 1
                                    ? t("typing.one", { name: typingUsers[0].DisplayName })
                                    : typingUsers.length <= 3 ? t("typing.few", {
                                        names: typingUsers.map(u =>
                                            u.DisplayName).join(", ")
                                    }) : t("typing.many")
                            }}
                        </span>
                        <span class="inline-flex gap-[1px] ml-1">
                            <span class="dot inline-block w-[4px] h-[4px] bg-white rounded-full animate-dot1"></span>
                            <span class="dot inline-block w-[4px] h-[4px] bg-white rounded-full animate-dot2"></span>
                            <span class="dot inline-block w-[4px] h-[4px] bg-white rounded-full animate-dot3"></span>
                        </span>
                    </div>
                </div>
            </Transition>
        </div>
        <div v-if="channelData && hiddenChannelId" ref="messageContainer"
            class="messages flex-1 overflow-y-auto space-y-4 rounded-t-lg pb-4 p-5">
            <ChatView :channel-id="hiddenChannelId" @select-reply="onReplySelect" />
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
            <EnterText style="width: 100%;" :reply-to="replyTo" @clear-reply="replyTo = null" @typing="onTypingEvent"
                @stop_typing="onStopTypingEvent" />
        </div>
    </div>
</template>
<script setup lang="ts">
import { RadioIcon } from 'lucide-vue-next';
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useLocale } from '@/store/localeStore';
import EnterText from './chats/EnterText.vue';
import ChatView from './ChatView.vue';
import { usePoolStore } from '@/store/poolStore';
import { logger } from '@/lib/logger';
import { Subscription } from 'rxjs';
import {
    HashIcon
} from 'lucide-vue-next';
import { RealtimeUser } from '@/store/db/dexie';
import { useBus } from '@/store/busStore';
const { t } = useLocale();
const pool = usePoolStore();
const bus = useBus();
const channelData = ref(null as null | IChannel);
const subs = ref(null as Subscription | null);
const hiddenChannelId = ref(null as null | Guid);
const messageContainer = ref<HTMLElement | null>(null);
const typingUsers = ref<RealtimeUser[]>([])

const getChannel = function (channelId: Guid) {
    return pool.getChannel(channelId);
}

const replyTo = ref<IArgonMessageDto | null>(null);

function onReplySelect(message: IArgonMessageDto) {
    replyTo.value = message;
}

watch(() => hiddenChannelId, () => {
    typingUsers.value = []
});

const onTypingEvent = () => {
    if (!channelData.value) return;
    bus.sendEventAsync({ channelId: channelData.value.Id, serverId: channelData.value.ServerId, EventKey: "IAmTypingEvent" } as IAmTypingEvent);
}
const onStopTypingEvent = () => {
    if (!channelData.value) return;
    bus.sendEventAsync({ channelId: channelData.value.Id, serverId: channelData.value.ServerId, EventKey: "IAmStopTypingEvent" } as IAmStopTypingEvent);
}

onMounted(async () => {
    subs.value = pool.onChannelChanged.subscribe(onChannelChanged);
    subs.value.add(bus.onServerEvent<UserTypingEvent>("UserTypingEvent", async (q) => {
        if (q.channelId !== hiddenChannelId.value) return;
        const user = await pool.getUser(q.userId);
        if (user && !typingUsers.value.some(u => u.UserId === user.UserId)) {
            typingUsers.value.push(user)
        }
    }));
    subs.value.add(bus.onServerEvent<UserStopTypingEvent>("UserStopTypingEvent", (q) => {
        if (q.channelId !== hiddenChannelId.value) return;
        typingUsers.value = typingUsers.value.filter(u => u.UserId !== q.userId);
    }));

    if (pool.selectedTextChannel) {
        logger.log("Selected channel", pool.selectedTextChannel);
        hiddenChannelId.value = pool.selectedTextChannel;
        channelData.value = (await getChannel(pool.selectedTextChannel!))!;
    }
});

onUnmounted(() => {
    subs.value?.unsubscribe();
})

const onChannelChanged = async function (channelId: Guid | null) {
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

.typing-slide-enter-active,
.typing-slide-leave-active {
    transition: transform 0.3s ease, visibility 0.3s ease;
}

.typing-slide-enter-active,
.typing-slide-leave-active {
    transition: max-height 0.3s ease;
}

.typing-slide-enter-from,
.typing-slide-leave-to {
    max-height: 0;
}

.typing-slide-enter-to,
.typing-slide-leave-from {
    max-height: 100px;
}

@keyframes dot-flash {
    0% {
        opacity: 0;
    }

    20% {
        opacity: 1;
    }

    100% {
        opacity: 0;
    }
}

.animate-dot1 {
    animation: dot-flash 1.5s infinite;
    animation-delay: 0s;
}

.animate-dot2 {
    animation: dot-flash 1.5s infinite;
    animation-delay: 0.3s;
}

.animate-dot3 {
    animation: dot-flash 1.5s infinite;
    animation-delay: 0.6s;
}
</style>
