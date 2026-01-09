<template>
    <div class="widget-container h-full flex flex-col">
        <div class="flex items-center justify-between mb-4">
            <h2 class="flex items-center gap-2 text-lg font-semibold">
                <div class="p-2 rounded-lg bg-green-500/10">
                    <IconUsers class="w-5 h-5 text-green-500" />
                </div>
                {{ t('active_now') }}
            </h2>
        </div>

        <div class="space-y-2 overflow-y-auto flex-1">
            <!-- Loading state -->
            <div v-if="loading" class="flex items-center justify-center h-full">
                <div class="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full"></div>
            </div>

            <!-- Empty state -->
            <div v-else-if="onlineFriends.length === 0"
                class="flex flex-col items-center justify-center h-full text-center">
                <div class="mb-3 p-3 rounded-full bg-muted/50">
                    <IconUserOff class="w-8 h-8 text-muted-foreground/50" />
                </div>
                <p class="text-muted-foreground text-xs mb-1">{{ t('no_friends_online') }}</p>
                <p class="text-[10px] text-muted-foreground/70">{{ t('invite_friends_to_chat') }}</p>
            </div>

            <!-- Friend cards -->
            <div v-else v-for="friend in onlineFriends" :key="friend.id"
                class="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 transition-all cursor-pointer group">
                <div class="relative shrink-0">
                    <SmartArgonAvatar :user-id="friend.id" :overrided-size="40" class="rounded-full" />
                    <div :class="[
                        'absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-card',
                        friend.user?.status === 1 ? 'bg-green-500' :
                            friend.user?.status === 2 ? 'bg-yellow-500' :
                                friend.user?.status === 3 ? 'bg-red-500' :
                                    'bg-gray-500'
                    ]" />
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm truncate">{{ friend.name }}</p>
                    <p class="text-xs text-muted-foreground truncate">{{ friend.status }}</p>
                </div>
                <button @click.stop="callFriend(friend.id)"
                    class="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-primary/10 rounded-lg shrink-0">
                    <IconPhoneCall class="w-5 h-5 text-primary" />
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { IconUsers, IconUserOff, IconPhoneCall } from '@tabler/icons-vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useApi } from '@/store/apiStore';
import { usePoolStore } from '@/store/poolStore';
import { useMe } from '@/store/meStore';
import { useCallManager } from '@/store/callManagerStore';
import { UserStatus } from '@argon/glue';
import type { RealtimeUser } from '@/store/db/dexie';
import SmartArgonAvatar from '@/components/SmartArgonAvatar.vue';
import { logger } from '@argon/core';
import { db } from '@/store/db/dexie';

const { t } = useLocale();
const api = useApi();
const pool = usePoolStore();
const me = useMe();
const calls = useCallManager();

interface Friend {
    id: string;
    name: string;
    status: string;
    user?: RealtimeUser;
}

const friendIds = ref<string[]>([]);
const loading = ref(true);
const friendsUsers = ref<RealtimeUser[]>([]);
let updateInterval: any = null;

// Load friends data from DB
async function updateFriendsData() {
    if (friendIds.value.length === 0) {
        friendsUsers.value = [];
        return;
    }
    
    const users = await db.users.where('userId').anyOf(friendIds.value).toArray();
    
    // Only update if data actually changed
    const hasChanges = users.length !== friendsUsers.value.length || 
        users.some((user, i) => {
            const existing = friendsUsers.value.find(u => u.userId === user.userId);
            return !existing || 
                existing.status !== user.status ||
                existing.activity?.titleName !== user.activity?.titleName;
        });
    
    if (hasChanges) {
        friendsUsers.value = users;
    }
}

// Watch friendIds changes
watch(friendIds, async (ids) => {
    // Clear previous interval
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    if (ids.length === 0) {
        friendsUsers.value = [];
        return;
    }
    
    // Initial load
    await updateFriendsData();
    
    // Update every 2 seconds
    updateInterval = setInterval(updateFriendsData, 2000);
}, { immediate: true });

// Get online friends with their user data
const onlineFriends = computed(() => {
    const result: Friend[] = [];

    logger.log('[ActiveNowWidget] Computing online friends from', friendsUsers.value.length, 'users');

    for (const user of friendsUsers.value) {
        logger.log('[ActiveNowWidget] User:', {
            id: user.userId,
            name: user.displayName || user.username,
            status: user.status,
            statusName: UserStatus[user.status]
        });

        if (user.status !== UserStatus.Offline) {
            result.push({
                id: user.userId,
                name: user.displayName || user.username,
                status: getStatusText(user),
                user: user
            });
        }
    }

    logger.log('[ActiveNowWidget] Online friends result:', result.length);
    return result;
});

function getStatusText(user: RealtimeUser): string {
    if (user.activity?.titleName) {
        let prefix = '';
        switch (user.activity.kind) {
            case 0: // GAME
                prefix = t('activity_play_in');
                break;
            case 1: // SOFTWARE
                prefix = t('activity_work_in');
                break;
            case 2: // STREAMING
                prefix = t('activity_stream');
                break;
            case 3: // LISTEN
                prefix = t('activity_listen');
                break;
            default:
                prefix = '';
        }
        return prefix ? `${prefix} ${user.activity.titleName}` : user.activity.titleName;
    }

    switch (user.status) {
        case UserStatus.Online:
            return t('online');
        case UserStatus.Away:
            return t('away');
        case UserStatus.DoNotDisturb:
            return t('do_not_disturb');
        case UserStatus.InGame:
            return t('in_game');
        case UserStatus.Listen:
            return t('listening');
        case UserStatus.TouchGrass:
            return t('touch_grass');
        case UserStatus.Offline:
        default:
            return t('offline');
    }
}

async function loadFriends() {
    try {
        loading.value = true;
        const friendships = await api.freindsInteraction.GetMyFriendships(100, 0);
        // friendId is the actual user ID of the friend
        friendIds.value = friendships.map(f => f.friendId);
        logger.log('[ActiveNowWidget] Loaded friends count:', friendIds.value.length);
        logger.log('[ActiveNowWidget] Friend IDs:', friendIds.value);
    } catch (error) {
        logger.error('[ActiveNowWidget] Failed to load friends:', error);
        console.error('Failed to load friends:', error);
    } finally {
        loading.value = false;
    }
}
async function callFriend(friendId: string) {
    await calls.startOutgoingCall(friendId);
}

onMounted(() => {
    loadFriends();
});

onUnmounted(() => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});
</script>
