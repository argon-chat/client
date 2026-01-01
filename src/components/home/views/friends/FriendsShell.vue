<template>
    <div v-bind="$attrs" class="flex flex-col h-full space-y-4">

        <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
                <IconCookieManFilled class="text-primary w-6 h-6" />
                <span class="text-2xl font-bold">{{ t("friends") }}</span>
            </div>

            <Button variant="default" size="sm" @click="openAddFriend" :disabled="loading">
                <IconUserPlus class="w-4 h-4 mr-1" />
                {{ t("add_friend") }}
            </Button>
        </div>

        <div class="flex gap-2 items-center">
            <div class="flex gap-2 flex-1">
                <Button 
                    variant="ghost" 
                    size="sm"
                    :class="{ 'bg-accent': activeFilter === 'friends' }"
                    @click="activeFilter = 'friends'"
                    :disabled="loading"
                >
                    {{ t("friends_list") }}
                    <Badge variant="secondary" class="ml-2">{{ friends.length }}</Badge>
                </Button>
                <Button 
                    v-if="(incoming.length + outgoing.length) > 0"
                    variant="ghost" 
                    size="sm"
                    :class="{ 'bg-accent': activeFilter === 'pending' }"
                    @click="activeFilter = 'pending'"
                    :disabled="loading"
                >
                    {{ t("pending") }}
                    <Badge variant="default" class="ml-2">
                        {{ incoming.length + outgoing.length }}
                    </Badge>
                </Button>
                <Button 
                    v-if="blocked.length > 0"
                    variant="ghost" 
                    size="sm"
                    :class="{ 'bg-accent': activeFilter === 'blocked' }"
                    @click="activeFilter = 'blocked'"
                    :disabled="loading"
                >
                    {{ t("blocked") }}
                    <Badge variant="secondary" class="ml-2">{{ blocked.length }}</Badge>
                </Button>
            </div>

            <Input 
                type="search" 
                v-model="query" 
                :placeholder="t('search_placeholder')" 
                class="w-64"
                :disabled="loading"
            />
        </div>

        <div v-if="loading" class="flex items-center justify-center flex-1 text-muted-foreground">
            <div class="text-center space-y-2">
                <div class="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
                <p class="text-sm">{{ t("loading") }}</p>
            </div>
        </div>

        <FriendList 
            v-else
            :items="filteredItems" 
            :loading="actionLoading" 
            @accept="acceptRequest"
            @decline="declineRequest" 
            @cancel="cancelRequest" 
            @unfriend="unfriendRequest"
        />

    </div>


    <AddFriendModal v-model:open="addFriendOpen" @added="loadAll" />
</template>


<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import Input from "@/components/ui/input/Input.vue";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { IconCookieManFilled, IconUserPlus } from "@tabler/icons-vue";
import FriendList from "./FriendList.vue";

import { useLocale } from "@/store/localeStore";
import { useApi } from "@/store/apiStore";
import { useToast } from "@/components/ui/toast/use-toast";

import { FriendRequest, Friendship, SendFriendStatus, UserBlock } from "@/lib/glue/argonChat";
import AddFriendModal from "@/components/modals/AddFriendModal.vue";
import { useBus } from "@/store/busStore";
import { useFriendEvents } from "@/composables/useFriendEvents";
import { useMe } from "@/store/meStore";
import type { FriendListItemVm } from "./FriendListItem.vue";

const { t } = useLocale();
const { toast } = useToast();
defineOptions({ inheritAttrs: false });

const me = useMe();
const api = useApi();
const client = api.freindsInteraction;
const query = ref("");
const activeFilter = ref<"friends" | "pending" | "blocked">("friends");
const loading = ref(true);
const actionLoading = ref(false);

const meId = computed(() => me.me!.userId);

const friends = ref<Friendship[]>([]);
const incoming = ref<FriendRequest[]>([]);
const outgoing = ref<FriendRequest[]>([]);
const blocked = ref<UserBlock[]>([]);

const addFriendOpen = ref(false);
function openAddFriend() {
    addFriendOpen.value = true;
}

// Список элементов по фильтру
const allItems = computed(() => {
    const items: FriendListItemVm[] = [];
    
    if (activeFilter.value === "friends") {
        items.push(...friends.value.map((x) => ({
            kind: "friend" as const,
            userId: x.friendId,
            displayName: x.friendId,
            avatarUrl: null,
        })));
    } else if (activeFilter.value === "pending") {
        items.push(...incoming.value.map((x) => ({
            kind: "incoming" as const,
            userId: x.requesterId,
            displayName: x.requesterId,
            avatarUrl: null,
        })));
        
        items.push(...outgoing.value.map((x) => ({
            kind: "outgoing" as const,
            userId: x.targetId,
            displayName: x.targetId,
            avatarUrl: null,
        })));
    } else if (activeFilter.value === "blocked") {
        items.push(...blocked.value.map((x) => ({
            kind: "blocked" as const,
            userId: x.blockedId,
            displayName: x.blockedId,
            avatarUrl: null,
        })));
    }
    
    return items;
});

// Фильтрованный список с поиском
const filteredItems = computed(() => {
    const searchQuery = query.value.toLowerCase();
    if (!searchQuery) return allItems.value;
    return allItems.value.filter(i => i.userId.toLowerCase().includes(searchQuery));
});

async function loadAll() {
    try {
        loading.value = true;
        const [friendsData, incomingData, outgoingData, blockedData] = await Promise.all([
            client.GetMyFriendships(50, 0),
            client.GetMyFriendPendingList(50, 0),
            client.GetMyFriendOutgoingList(50, 0),
            client.GetBlockList(50, 0),
        ]);
        friends.value = friendsData;
        incoming.value = incomingData;
        outgoing.value = outgoingData;
        blocked.value = blockedData;
    } catch (error) {
        console.error("Failed to load friends data:", error);
        toast({
            title: t("error"),
            description: t("failed_to_load_friends"),
            variant: "destructive",
        });
    } finally {
        loading.value = false;
    }
}
onMounted(loadAll);

async function acceptRequest(from: string) {
    try {
        actionLoading.value = true;
        await client.AcceptFriendRequest(from);
        toast({
            title: t("success"),
            description: t("friend_request_accepted"),
        });
    } catch (error) {
        console.error("Failed to accept friend request:", error);
        toast({
            title: t("error"),
            description: t("failed_to_accept_request"),
            variant: "destructive",
        });
    } finally {
        actionLoading.value = false;
    }
}

async function declineRequest(from: string) {
    try {
        actionLoading.value = true;
        await client.DeclineFriendRequest(from);
        toast({
            title: t("success"),
            description: t("friend_request_declined"),
        });
    } catch (error) {
        console.error("Failed to decline friend request:", error);
        toast({
            title: t("error"),
            description: t("failed_to_decline_request"),
            variant: "destructive",
        });
    } finally {
        actionLoading.value = false;
    }
}

async function cancelRequest(to: string) {
    try {
        actionLoading.value = true;
        await client.CancelFriendRequest(to);
        toast({
            title: t("success"),
            description: t("friend_request_canceled"),
        });
    } catch (error) {
        console.error("Failed to cancel friend request:", error);
        toast({
            title: t("error"),
            description: t("failed_to_cancel_request"),
            variant: "destructive",
        });
    } finally {
        actionLoading.value = false;
    }
}

async function unfriendRequest(to: string) {
    try {
        actionLoading.value = true;
        await client.RemoveFriend(to);
        toast({
            title: t("success"),
            description: t("friend_removed"),
        });
    } catch (error) {
        console.error("Failed to remove friend:", error);
        toast({
            title: t("error"),
            description: t("failed_to_remove_friend"),
            variant: "destructive",
        });
    } finally {
        actionLoading.value = false;
    }
}

useFriendEvents({
    onRequestReceived(e) {
        incoming.value.unshift({
            requesterId: e.requesterId,
            targetId: meId.value,
            requestedAt: e.requestDate,
        });
    },

    onRequestAccepted(e) {
        friends.value.unshift({
            userId: meId.value,
            friendId: e.userId,
            friendAt: e.friendAt,
        });

        incoming.value = incoming.value.filter(x => x.requesterId !== e.userId);
        outgoing.value = outgoing.value.filter(x => x.targetId !== e.userId);
    },

    onRequestDeclined(e) {
        outgoing.value = outgoing.value.filter(x => x.targetId !== e.targetId);
    },

    onRequestCanceled(e) {
        incoming.value = incoming.value.filter(x => x.requesterId !== e.requesterId);
    },

    onFriendshipRemoved(e) {
        friends.value = friends.value.filter(x => x.friendId !== e.userId);
    },

    onUserBlocked(e) {
        blocked.value.unshift({
            userId: meId.value,
            blockedId: e.blockId,
            blockedAt: {
                offsetMinutes: 0,
                date: new Date()
            }
        });

        friends.value = friends.value.filter(x => x.friendId !== e.blockId);
        incoming.value = incoming.value.filter(x => x.requesterId !== e.blockId);
        outgoing.value = outgoing.value.filter(x => x.targetId !== e.blockId);
    },

    onUserUnblocked(e) {
        blocked.value = blocked.value.filter(x => x.blockedId !== e.blockId);
    }
});
</script>
