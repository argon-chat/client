<template>
    <div v-bind="$attrs" class="friends-shell">

        <header class="friends-header">
            <div class="friends-title">
                <div class="friends-title-icon">
                    <IconCookieManFilled class="w-5 h-5" />
                </div>
                <div class="flex flex-col min-w-0">
                    <span class="friends-title-text">{{ t("friends") }}</span>
                    <span class="friends-title-sub">
                        {{ friends.length }} {{ t("friends_list").toLowerCase() }}
                    </span>
                </div>
            </div>

            <div class="friends-header-actions">
                <div class="friends-search">
                    <IconSearch class="friends-search-icon" />
                    <Input
                        type="search"
                        v-model="query"
                        :placeholder="t('search_placeholder')"
                        class="h-9 pl-8 pr-8"
                        :disabled="loading"
                    />
                    <button
                        v-if="query"
                        type="button"
                        class="friends-search-clear"
                        :title="t('clear')"
                        :aria-label="t('clear')"
                        @click="query = ''"
                    >
                        <IconX class="w-3.5 h-3.5" />
                    </button>
                </div>

                <Button
                    size="icon"
                    class="h-9 w-9 shrink-0"
                    :title="t('add_friend')"
                    :aria-label="t('add_friend')"
                    :disabled="loading"
                    @click="openAddFriend"
                >
                    <IconUserPlus class="w-4 h-4" />
                </Button>
            </div>
        </header>

        <Transition name="friends-swap" mode="out-in">
            <div v-if="loading" key="skeleton" class="friends-skeleton">
                <div v-for="i in 8" :key="i" class="friends-skeleton-row" :style="{ '--row-index': i - 1 }">
                    <Skeleton class="h-[38px] w-[38px] rounded-full shrink-0" />
                    <div class="flex flex-col gap-2 flex-1 min-w-0">
                        <Skeleton class="h-3 w-40 max-w-[60%]" />
                        <Skeleton class="h-2.5 w-24 max-w-[35%]" />
                    </div>
                    <Skeleton class="h-8 w-24 rounded-md shrink-0" />
                </div>
            </div>

            <FriendList
                v-else
                key="list"
                :items="filteredItems"
                :art="emptyArt"
                :can-add="!query.trim()"
                :loading="actionLoading"
                @accept="acceptRequest"
                @decline="declineRequest"
                @cancel="cancelRequest"
                @unfriend="unfriendRequest"
                @add="openAddFriend"
            />
        </Transition>

    </div>


    <AddFriendModal v-model:open="addFriendOpen" @added="loadAll" />
</template>


<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { Input } from "@argon/ui/input";
import { Button } from "@argon/ui/button";

import { IconCookieManFilled, IconSearch, IconUserPlus, IconX } from "@tabler/icons-vue";
import FriendList from "./FriendList.vue";
import type { EmptyStateArtName } from "@/components/shared/EmptyStateArt.vue";
import Skeleton from "@/components/shared/Skeleton.vue";

import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import { useToast } from "@argon/ui/toast";

import { FriendRequest, Friendship, SendFriendStatus, UserBlock } from "@argon/glue";
import { IonDateTime } from "@argon-chat/ion.webcore";
import AddFriendModal from "@/components/modals/AddFriendModal.vue";
import { useBus } from "@/store/realtime/busStore";
import { useFriendEvents } from "@/composables/useFriendEvents";
import { useMe } from "@/store/auth/meStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import type { FriendListItemVm } from "./FriendListItem.vue";

const { t } = useLocale();
const { toast } = useToast();
defineOptions({ inheritAttrs: false });

const me = useMe();
const pool = usePoolStore();
const ntf = useNotificationStore();
const api = useApi();
const client = api.freindsInteraction;
const query = ref("");
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

// Friend lists come back as bare ids, so nothing on this screen knows a name until the users are
// resolved. One batch covers every section — it fills the cache the rows read from, which is also
// what makes a request from someone outside your spaces render at all.
const knownIds = computed(() => {
    const ids = new Set<string>();
    for (const x of friends.value) ids.add(x.friendId);
    for (const x of incoming.value) ids.add(x.requesterId);
    for (const x of outgoing.value) ids.add(x.targetId);
    for (const x of blocked.value) ids.add(x.blockedId);
    return [...ids];
});

const names = ref(new Map<string, string>());

watch(knownIds, async (ids) => {
    if (!ids.length) return;
    const users = await pool.getUsersBatch(ids);
    const next = new Map(names.value);
    for (const [id, user] of users) next.set(id, user.displayName);
    names.value = next;
}, { immediate: true });

const nameOf = (userId: string) => names.value.get(userId) ?? userId;

// One list, ordered by what needs attention: requests first, then friends, then blocks. There is
// no mode to switch — a tab bar over sections that are usually empty was more chrome than content,
// and it hid the very thing it was counting.
const allItems = computed<FriendListItemVm[]>(() => [
    ...incoming.value.map((x) => ({
        kind: "incoming" as const,
        userId: x.requesterId,
        displayName: nameOf(x.requesterId),
    })),
    ...outgoing.value.map((x) => ({
        kind: "outgoing" as const,
        userId: x.targetId,
        displayName: nameOf(x.targetId),
    })),
    ...friends.value.map((x) => ({
        kind: "friend" as const,
        userId: x.friendId,
        displayName: nameOf(x.friendId),
    })),
    ...blocked.value.map((x) => ({
        kind: "blocked" as const,
        userId: x.blockedId,
        displayName: nameOf(x.blockedId),
    })),
]);

// Searching used to compare against the id, so typing a name matched nothing at all.
const filteredItems = computed(() => {
    const searchQuery = query.value.trim().toLowerCase();
    if (!searchQuery) return allItems.value;
    return allItems.value.filter(i =>
        i.displayName.toLowerCase().includes(searchQuery) ||
        i.userId.toLowerCase().includes(searchQuery),
    );
});

// A search that matched nothing is not the same as having nobody.
const emptyArt = computed<EmptyStateArtName>(() =>
    query.value.trim() && allItems.value.length ? "not-found" : "no-friends-sad",
);

/** Whether the lists on screen are the server's — a failed load leaves them as they were. */
async function loadAll(): Promise<boolean> {
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
        return true;
    } catch (error) {
        console.error("Failed to load friends data:", error);
        toast({
            title: t("error"),
            description: t("failed_to_load_friends"),
            variant: "destructive",
        });
        return false;
    } finally {
        loading.value = false;
    }
}
onMounted(async () => {
    const loaded = await loadAll();
    // The badge on the Friends tab counts unread "friend_request_received" notifications. Handling
    // a request never touched them, so the dot outlived the request that caused it; the requests
    // are the first thing on this screen, so arriving here is what counts as having seen them —
    // but only if they arrived. Clearing it after a failed load would hide requests nobody saw.
    if (loaded && ntf.notifications.friendRequests > 0) {
        void ntf.markAllNotificationsRead("friend_request_received");
    }
});

async function acceptRequest(from: string) {
    try {
        actionLoading.value = true;
        await client.AcceptFriendRequest(from);
        // Nothing comes back to whoever pressed the button — the event goes to the other side — so
        // the request would sit here, accepted but still listed, until the next reload.
        incoming.value = incoming.value.filter(x => x.requesterId !== from);
        if (!friends.value.some(x => x.friendId === from)) {
            friends.value = [
                { userId: meId.value, friendId: from, friendAt: IonDateTime.now() },
                ...friends.value,
            ];
        }
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
        incoming.value = incoming.value.filter(x => x.requesterId !== from);
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
        outgoing.value = outgoing.value.filter(x => x.targetId !== to);
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
        friends.value = friends.value.filter(x => x.friendId !== to);
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
            // The event carries no timestamp, so this is a local stand-in until the next
            // refresh replaces it with the server's. UTC, as the old literal was.
            blockedAt: IonDateTime.now()
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

<style scoped>
.friends-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 0.75rem;
}

/* Was an <Alert>, which is why it read as a notification bar rather than a page header. Search and
   the add action live here too — a toolbar row of its own for two controls was wasted space. */
.friends-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.75rem 1rem;
    border-radius: var(--radius);
    border: 1px solid hsl(var(--border) / 0.6);
    background: hsl(var(--card));
}

.friends-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
}

.friends-title-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    flex-shrink: 0;
    border-radius: calc(var(--radius) - 4px);
    background: hsl(var(--primary) / 0.12);
    color: hsl(var(--primary));
}

.friends-title-text {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.25rem;
}

.friends-title-sub {
    font-size: 0.75rem;
    line-height: 1rem;
    color: hsl(var(--muted-foreground));
}

.friends-header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
}

.friends-search {
    position: relative;
    width: 16rem;
    max-width: 100%;
}

.friends-search-icon {
    position: absolute;
    left: 0.625rem;
    top: 50%;
    transform: translateY(-50%);
    width: 0.875rem;
    height: 0.875rem;
    color: hsl(var(--muted-foreground));
    pointer-events: none;
}

/* The row has its own clear button; the engine's native one would sit on top of it. */
.friends-search input::-webkit-search-cancel-button {
    display: none;
}

.friends-search-clear {
    position: absolute;
    right: 0.375rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    border: none;
    border-radius: 9999px;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.friends-search-clear:hover {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
}

/* Same panel as the loaded list, so nothing jumps when the data lands. */
.friends-skeleton {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 6px;
    border-radius: var(--radius);
    border: 1px solid hsl(var(--border) / 0.6);
    background: hsl(var(--card));
}

.friends-skeleton-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.625rem;
    /* Rows fade in one after another instead of the whole block blinking into place. */
    animation: friends-skeleton-in 0.35s ease both;
    animation-delay: calc(var(--row-index, 0) * 40ms);
}

@keyframes friends-skeleton-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Skeleton -> list, and list -> skeleton on a reload. */
.friends-swap-enter-active {
    transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.friends-swap-leave-active {
    transition: opacity 0.15s ease;
}

.friends-swap-enter-from {
    opacity: 0;
    transform: translateY(6px);
}

.friends-swap-leave-to {
    opacity: 0;
}

</style>
