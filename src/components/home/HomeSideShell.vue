<script setup lang="ts">
import { Button } from '@argon/ui/button';
import ControlBar from './../ControlBar.vue';
import UserBar from './../UserBar.vue';
import {
    IconHome,
    IconUsers,
    IconBoxMultiple,
    IconBell,
    IconSearch,
    IconDialpad,
    IconPin,
} from "@tabler/icons-vue";
import { computed, onMounted, ref, onUnmounted, watch } from 'vue';
import { useLocale } from "@/store/system/localeStore";
import { Separator } from '@argon/ui/separator';
import RecentUserItem from './views/RecentUserItem.vue';
import router from '@/router';
import { useRecentChatsStore } from '@/store/chat/useRecentChatsStore';
import { useApi } from "@/store/system/apiStore";
import type {
    RecentChatUpdatedEvent,
    ChatPinnedEvent,
    ChatUnpinnedEvent,
    ChatReadEvent,
} from "@argon/glue";
import { useBus } from '@/store/realtime/busStore';
import { DisposableBag } from '@argon/core';
import { useMe } from '@/store/auth/meStore';
import SoftphoneModal from '../modals/SoftphoneModal.vue';
import { useNotificationStore } from '@/store/data/notificationStore';
import { useFeatureFlags } from '@/store/features/featureFlagsStore';

const { t } = useLocale();
const { dialpadActive, dmActive, inventoryActive, notificationActive } = useFeatureFlags();

const tab = defineModel<'dashboard' | 'friends' | 'notifications' | 'inventory'>('tab', {
    default: 'dashboard'
});

const recentStore = useRecentChatsStore();
const api = useApi();
const client = api.userChatInteractions;
const bus = useBus();
const me = useMe();
const ntf = useNotificationStore();
const softphoneOpened = ref(false);
const searchQuery = ref('');

const emit = defineEmits<{
    (e: 'select', tab: 'dashboard' | 'friends' | 'notifications' | 'inventory'): void;
}>();

// --- Chat lists ---
const pinnedChats = computed(() =>
    recentStore.recent.filter(u => u.isPinned)
);
const unpinnedChats = computed(() =>
    recentStore.recent.filter(u => !u.isPinned)
);

const filteredPinned = computed(() => {
    if (!searchQuery.value) return pinnedChats.value;
    const q = searchQuery.value.toLowerCase();
    return pinnedChats.value.filter(u => u.displayName.toLowerCase().includes(q));
});
const filteredUnpinned = computed(() => {
    if (!searchQuery.value) return unpinnedChats.value;
    const q = searchQuery.value.toLowerCase();
    return unpinnedChats.value.filter(u => u.displayName.toLowerCase().includes(q));
});

const hasAnyChats = computed(() => filteredPinned.value.length > 0 || filteredUnpinned.value.length > 0);

// --- Badge counts ---
const friendBadge = computed(() => ntf.notifications.friendRequests || 0);
const inventoryBadge = computed(() => ntf.notifications.inventory || 0);

// --- Data loading ---
async function loadChats() {
    const res = await client.GetRecentChats(50, 0);
    recentStore.setChats(res);
}

onMounted(() => {
    loadChats();
    subscribeEvents();
});

function openChat(peerId: string) {
    router.push({ name: "HomeChat", params: { userId: peerId } });
}

// --- EventBus ---
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
});

// --- Nav items ---
interface NavItem {
    key: 'dashboard' | 'friends' | 'inventory' | 'notifications';
    icon: any;
    label: string;
    badge: number;
    visible: boolean;
}

const navItems = computed<NavItem[]>(() => [
    { key: 'dashboard', icon: IconHome, label: t('dashboard'), badge: 0, visible: true },
    { key: 'friends', icon: IconUsers, label: t('friends'), badge: friendBadge.value, visible: true },
    { key: 'inventory', icon: IconBoxMultiple, label: t('inventory'), badge: inventoryBadge.value, visible: inventoryActive },
    { key: 'notifications', icon: IconBell, label: t('notifications'), badge: 0, visible: notificationActive },
]);
</script>

<template>
    <div class="sidebar-shell flex flex-col justify-between rounded-xl gap-2 w-[280px] min-w-[280px]">
        <!-- Main content card -->
        <div class="sidebar-card flex flex-1 flex-col overflow-hidden gap-0.5">
            <!-- Search -->
            <div class="px-2 pt-2 pb-1">
                <div class="relative">
                    <IconSearch class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                        v-model="searchQuery"
                        type="text"
                        :placeholder="t('search_chats')"
                        class="w-full h-8 pl-8 pr-3 text-xs bg-muted/50 border border-border/50 rounded-lg
                               focus:outline-none focus:ring-1 focus:ring-primary/50 focus:bg-muted
                               placeholder:text-muted-foreground/60 transition-colors"
                    />
                </div>
            </div>

            <!-- Navigation tabs -->
            <div class="flex items-center gap-0.5 px-2 py-1">
                <template v-for="item in navItems" :key="item.key">
                    <button v-if="item.visible"
                        @click="emit('select', item.key)"
                        :title="item.label"
                        :class="[
                            'relative flex items-center justify-center w-9 h-8 rounded-md transition-all',
                            tab === item.key
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        ]">
                        <component :is="item.icon" class="w-[18px] h-[18px]" />
                        <span v-if="item.badge > 0"
                            class="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold leading-none">
                            {{ item.badge > 99 ? '99+' : item.badge }}
                        </span>
                    </button>
                </template>

                <div class="flex-1" />

                <button v-if="dialpadActive"
                    @click="softphoneOpened = !softphoneOpened"
                    :title="t('dial_pad')"
                    class="flex items-center justify-center w-9 h-8 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all">
                    <IconDialpad class="w-[18px] h-[18px]" />
                </button>
            </div>

            <Separator class="mx-2" />

            <!-- Chat list -->
            <div v-if="dmActive" class="flex-1 flex flex-col overflow-hidden min-h-0">
                <div class="chat-list flex flex-col gap-0.5 px-1 overflow-y-auto flex-1">
                    <!-- Pinned section -->
                    <template v-if="filteredPinned.length > 0">
                        <div class="flex items-center gap-1.5 px-2 pt-2 pb-1">
                            <IconPin class="w-3 h-3 text-muted-foreground" />
                            <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                                {{ t('pinned') }}
                            </span>
                        </div>
                        <RecentUserItem
                            v-for="u in filteredPinned" :key="u.peerId"
                            :user-id="u.peerId"
                            :display-name="u.displayName"
                            :last-message="u.lastMsg"
                            :last-message-at="u.lastMessageAt"
                            :is-pinned="true"
                            :unread-count="u.unreadCount"
                            @open="openChat"
                        />
                        <Separator class="mx-2 my-1" />
                    </template>

                    <!-- Recent section -->
                    <div v-if="filteredUnpinned.length > 0" class="flex items-center gap-1.5 px-2 pt-2 pb-1">
                        <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            {{ t('direct_messages') }}
                        </span>
                    </div>
                    <RecentUserItem
                        v-for="u in filteredUnpinned" :key="u.peerId"
                        :user-id="u.peerId"
                        :display-name="u.displayName"
                        :last-message="u.lastMsg"
                        :last-message-at="u.lastMessageAt"
                        :unread-count="u.unreadCount"
                        @open="openChat"
                    />

                    <!-- Empty state -->
                    <div v-if="!hasAnyChats" class="flex flex-col items-center justify-center py-8 text-center">
                        <p class="text-xs text-muted-foreground/70">
                            {{ searchQuery ? t('no_results') : t('no_recent_chats') }}
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Control + User bars -->
        <ControlBar />
        <UserBar />
        <SoftphoneModal v-model:open="softphoneOpened" />
    </div>
</template>

<style lang="css" scoped>
.sidebar-card {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    padding: 4px;
}

.chat-list {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted)) transparent;
}

.chat-list::-webkit-scrollbar {
    width: 4px;
}

.chat-list::-webkit-scrollbar-track {
    background: transparent;
}

.chat-list::-webkit-scrollbar-thumb {
    background: hsl(var(--muted));
    border-radius: 8px;
}

.chat-list::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.3);
}
</style>