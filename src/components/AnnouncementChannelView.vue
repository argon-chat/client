<template>
    <div class="channel-chat flex flex-col h-full rounded-lg overflow-hidden relative">
        <div v-if="channelData && selectedChannelId && selectedSpaceId" ref="messageContainer"
            class="messages-scroll flex-1 p-5">
            <ChatView 
                :channel-id="selectedChannelId" 
                :space-id="selectedSpaceId" 
                :channel-name="channelData.name" 
                :channel-type="'announcement'"
                :typing-users="typingUsers" 
                @select-reply="onReplySelect" 
            />
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
        <div v-if="channelData && canManageChannels" class="message-input rounded-b-lg p-5 overflow-hidden flex-shrink-0">
            <EnterText :reply-to="replyTo" :space-id="selectedSpaceId!" @clear-reply="replyTo = null" @typing="onTypingEvent"
                @stop_typing="onStopTypingEvent" />
        </div>

        <!-- Follow banner for users without ManageChannels permission -->
        <div v-else-if="channelData" class="announcement-banner rounded-b-lg flex items-center justify-center p-4 flex-shrink-0">
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
import { logger } from "@argon/core";
import type { Subscription } from "rxjs";
import type { RealtimeUser } from "@/store/db/dexie";
import { useBus } from "@/store/busStore";
import { ArgonChannel, ArgonMessage, IAmStopTypingEvent, IAmTypingEvent, UserStopTypingEvent, UserTypingEvent } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";

const { t } = useLocale();
const pool = usePoolStore();
const pex = usePexStore();
const bus = useBus();

const channelData = ref(null as null | ArgonChannel);
const subs = ref(null as Subscription | null);
const messageContainer = ref<HTMLElement | null>(null);
const typingUsers = ref<RealtimeUser[]>([]);
const lastTypingTime = new Map<string, number>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const TYPING_TIMEOUT_MS = 15000;

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

watch(
    () => selectedChannelId.value,
    async (newChannelId) => {
        typingUsers.value = [];
        if (newChannelId) {
            const channel = await getChannel(newChannelId);
            channelData.value = channel ?? null;
        } else {
            channelData.value = null;
        }
    },
    { immediate: true }
);

const onTypingEvent = () => {
    if (!channelData.value) return;
    logger.log("Sending IAmTypingEvent with channelId:", channelData.value.channelId);
    bus.sendEventAsync(new IAmTypingEvent(channelData.value.channelId));
};

const onStopTypingEvent = () => {
    if (!channelData.value) return;
    logger.log("Sending IAmStopTypingEvent with channelId:", channelData.value.channelId);
    bus.sendEventAsync(new IAmStopTypingEvent(channelData.value.channelId));
};

function scheduleTypingTimeout(userId: string) {
    const oldTimer = typingTimers.get(userId);
    if (oldTimer) clearTimeout(oldTimer);

    const timer = setTimeout(() => {
        const last = lastTypingTime.get(userId);
        if (last && Date.now() - last >= TYPING_TIMEOUT_MS) {
            typingUsers.value = typingUsers.value.filter((u) => u.userId !== userId);
            typingTimers.delete(userId);
            lastTypingTime.delete(userId);
        }
    }, TYPING_TIMEOUT_MS + 100);

    typingTimers.set(userId, timer);
}

onMounted(async () => {
    subs.value = pool.onChannelChanged.subscribe(onChannelChanged);
    subs.value.add(
        bus.onServerEvent<UserTypingEvent>("UserTypingEvent", async (q) => {
            logger.log("UserTypingEvent received", q.channelId, "current:", selectedChannelId.value);
            if (q.channelId !== selectedChannelId.value) return;

            lastTypingTime.set(q.userId, Date.now());

            if (!typingUsers.value.some((u) => u.userId === q.userId)) {
                const user = await pool.getUser(q.userId);
                logger.log("User found for typing:", user);
                if (user) {
                    typingUsers.value = [...typingUsers.value, user];
                }
            }

            scheduleTypingTimeout(q.userId);
        }),
    );

    subs.value.add(
        bus.onServerEvent<UserStopTypingEvent>("UserStopTypingEvent", (q) => {
            if (q.channelId !== selectedChannelId.value) return;

            typingUsers.value = typingUsers.value.filter(
                (u) => u.userId !== q.userId,
            );
            lastTypingTime.delete(q.userId);

            const timer = typingTimers.get(q.userId);
            if (timer) {
                clearTimeout(timer);
                typingTimers.delete(q.userId);
            }
        }),
    );
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
</script>

<style scoped>
.channel-chat {
    border: 1px solid hsl(var(--border) / 0.5);
}

.messages-scroll {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
}

.message-input {
    background: hsl(var(--card));
}

.announcement-banner {
    background: hsl(var(--muted));
    border-top: 1px solid hsl(var(--border));
}
</style>
