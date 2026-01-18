<script setup lang="ts">
import { Button } from '@argon/ui/button';
import ControlBar from './../ControlBar.vue';
import UserBar from './../UserBar.vue';
import { IconCookieManFilled, IconTriangleInvertedFilled, IconUserScan, IconNotification, IconDialpad } from "@tabler/icons-vue"
import { computed, onMounted, PropType, ref, onUnmounted } from 'vue';
import { useLocale } from "@/store/localeStore";
import { Separator } from '@argon/ui/separator';
import RecentUserItem from './views/RecentUserItem.vue';
import router from '@/router';
import { useRecentChatsStore } from '@/store/useRecentChatsStore';
import { useApi } from "@/store/apiStore";
import type {
    RecentChatUpdatedEvent,
    ChatPinnedEvent,
    ChatUnpinnedEvent,
    ChatReadEvent,
} from "@argon/glue";
import { useBus } from '@/store/busStore';
import { DisposableBag } from '@argon/core';
import { NBadge } from 'naive-ui';
import { useMe } from '@/store/meStore';
import SoftphoneModal from '../modals/SoftphoneModal.vue';
import { logger } from '@argon/core';
import { useNotifications } from '@/composables/useNotifications';

const { t } = useLocale();

const tab = defineModel<'dashboard' | 'friends' | 'notifications' | 'inventory' | 'overlayDebug'>('tab', {
    default: 'dashboard'
});
const recentStore = useRecentChatsStore();
const api = useApi();
const client = api.userChatInteractions;
const bus = useBus();
const me = useMe();
const recentUsers = computed(() => recentStore.recent);
const softphoneOpened = ref(false);
const notifications = useNotifications();

const emit = defineEmits<{
    (e: 'select', tab: 'dashboard' | 'friends' | 'notifications' | 'inventory' | 'overlayDebug'): void
}>();

async function loadChats() {
    const res = await client.GetRecentChats(50, 0);
    recentStore.setChats(res);
}

onMounted(() => {
    loadChats();
    subscribeEvents();
    notifications.initialize();
});

// --------------------------
// OPEN CHAT
// --------------------------
function openChat(peerId: string) {
    router.push({
        name: "HomeChat",
        params: { userId: peerId }
    });
}

// --------------------------
// EVENTBUS
// --------------------------
const subs = new DisposableBag();

function subscribeEvents() {
    subs.addSubscription(
        bus.onServerEvent<RecentChatUpdatedEvent>("RecentChatUpdatedEvent", (e) => {
            recentStore.upsert({
                peerId: e.peerId,
                lastMsg: e.lastMessage,
                lastMessageAt: e.lastMessageAt,
                isPinned: recentStore.recent.find(x => x.peerId === e.peerId)?.isPinned ?? false,
                pinnedAt: recentStore.recent.find(x => x.peerId === e.peerId)?.pinnedAt ?? null,
                unreadCount: 0,
                userId: me.me!.userId
            });
        })
    );

    subs.addSubscription(
        bus.onServerEvent<ChatPinnedEvent>("ChatPinnedEvent", (e) => {
            recentStore.markPinned(e.peerId, true, e.pinnedAt);
        })
    );

    subs.addSubscription(
        bus.onServerEvent<ChatUnpinnedEvent>("ChatUnpinnedEvent", (e) => {
            recentStore.markPinned(e.peerId, false, null);
        })
    );

    subs.addSubscription(
        bus.onServerEvent<ChatReadEvent>("ChatReadEvent", (e) => {
            recentStore.markRead(e.peerId);
        })
    );
}

onUnmounted(() => {
    subs.dispose();
    notifications.cleanup();
});
</script>


<template>
    <div class="channel-container flex flex-col justify-end rounded-xl space-y-3 min-w-0 max-w-60">
        <div class="item-slot flex flex-1 justify-start items-stretch flex-col overflow-hidden gap-1 h-full rounded-xl"
            style="border-radius: 15px;">
            <Button @click="emit('select', 'dashboard')" :variant="tab == 'dashboard' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconUserScan class="w-6 h-6 mr-2" />
                {{ t("dashboard") }}
            </Button>
            <Button @click="emit('select', 'friends')" :variant="tab == 'friends' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconCookieManFilled class="w-6 h-6 mr-2" />
                {{ t("friends") }}
                <NBadge :value="notifications.pendingFriendRequestsCount.value" :max="50" :offset="[10, -8]" />
            </Button>
            <Button @click="emit('select', 'inventory')" :variant="tab == 'inventory' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconTriangleInvertedFilled class="w-6 h-6 mr-2" />
                {{ t("inventory") }}
                <NBadge :value="notifications.newInventoryItemsCount.value" :max="50" :offset="[10, -8]" />
            </Button>
            <Button @click="emit('select', 'notifications')" :variant="tab == 'notifications' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconNotification class="w-6 h-6 mr-2" />
                {{ t("notifications") }}
                <NBadge :value="0" :max="50" :offset="[10, -8]" />
            </Button>
            <Button @click="emit('select', 'overlayDebug')" :variant="tab == 'overlayDebug' ? 'outline' : 'ghost'"
                class="justify-start">
                <IconNotification class="w-6 h-6 mr-2" />
                Overlay Debug
                <NBadge :value="0" :max="50" :offset="[10, -8]" />
            </Button>
            <Button @click="softphoneOpened = !softphoneOpened" :variant="'link'"
                class="justify-start">
                <IconDialpad class="w-6 h-6 mr-2" />
                {{ t("dial_pad") }}
                <NBadge :value="0" :max="50" :offset="[10, -8]" />
            </Button>
            <Separator class="space-y-4" v-if="false"/>
            <div class="quick-actions flex flex-row justify-between gap-2 py-1" v-if="false">
                <Button @click="softphoneOpened = !softphoneOpened" variant="ghost"
                    class="h-10 w-10 p-0 flex items-center justify-center rounded-lg">
                    <IconDialpad class="w-6 h-6" />
                </Button>

                <Button variant="ghost" class="h-10 w-10 p-0 flex items-center justify-center rounded-lg">
                    <IconCookieManFilled class="w-6 h-6" />
                </Button>

                <Button variant="ghost" class="h-8 w-8 p-0 flex items-center justify-center rounded-lg">
                    <IconTriangleInvertedFilled class="w-4 h-4" />
                </Button>

                <Button variant="ghost" class="h-8 w-8 p-0 flex items-center justify-center rounded-lg">
                    <IconNotification class="w-4 h-4" />
                </Button>
            </div>
            <Separator />
            <div ref="listEl"
                class="recent-users-list flex flex-col gap-1 overflow-y-auto scrollbar-thin scrollbar-hide scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                <RecentUserItem v-for="u in recentUsers" :key="u.peerId" :user-id="u.peerId"
                    :display-name="u.displayName" :last-message="u.lastMsg" @open="openChat" />
                <div v-if="false" class="text-gray-400 text-xs py-2 text-center">
                    ...
                </div>
            </div>
        </div>
        <ControlBar />
        <UserBar />
        <SoftphoneModal v-model:open="softphoneOpened" />
    </div>
</template>

<style lang="css" scoped>
.item-slot {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    padding: 10px;
    display: flex;
    position: relative;
}

.recent-users-list {
    overflow-y: auto;
}

/* Chrome, Edge, Safari */
.recent-users-list::-webkit-scrollbar {
    width: 6px;
}

.recent-users-list::-webkit-scrollbar-track {
    background: transparent;
}

.recent-users-list::-webkit-scrollbar-thumb {
    background: hsl(var(--muted));
    border-radius: 8px;
}

.recent-users-list::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.3);
}

/* Firefox */
.recent-users-list {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted)) transparent;
}
</style>