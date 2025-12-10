<template>
    <div v-bind="$attrs" class="flex flex-col h-full space-y-4">

        <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
                <IconCookieManFilled class="text-primary w-6 h-6" />
                <span class="text-2xl font-bold">{{ t("friends") }}</span>
            </div>

            <Button variant="default" size="sm" @click="openAddFriend">
                <IconUserPlus class="w-4 h-4 mr-1" />
                {{ t("add_friend") }}
            </Button>
        </div>

        <Input type="search" v-model="query" :placeholder="t('search_placeholder')" class="w-full" />

        <Tabs v-model="activeTab" class="w-full">
            <TabsList class="flex gap-2">
                <TabsTrigger value="friends" class="flex items-center gap-2">
                    {{ t("friends_list") }}
                    <Badge variant="secondary">{{ friends.length }}</Badge>
                </TabsTrigger>

                <TabsTrigger value="incoming" class="flex items-center gap-2">
                    {{ t("incoming_requests") }}
                    <Badge variant="secondary">{{ incoming.length }}</Badge>
                </TabsTrigger>

                <TabsTrigger value="outgoing" class="flex items-center gap-2">
                    {{ t("outgoing_requests") }}
                    <Badge variant="secondary">{{ outgoing.length }}</Badge>
                </TabsTrigger>

                <TabsTrigger value="blocked" class="flex items-center gap-2">
                    {{ t("blocked_users") }}
                    <Badge variant="secondary">{{ blocked.length }}</Badge>
                </TabsTrigger>
            </TabsList>

            <TabsContent value="friends" class="flex-1 mt-2 overflow-hidden">
                <FriendList :items="friendsItems" @unfriend="unfriendRequest"/>
            </TabsContent>

            <TabsContent value="incoming" class="flex-1 mt-2 overflow-hidden">
                <FriendList :items="incomingItems" @accept="acceptRequest" @decline="declineRequest" />
            </TabsContent>

            <TabsContent value="outgoing" class="flex-1 mt-2 overflow-hidden">
                <FriendList :items="outgoingItems" @cancel="cancelRequest" />
            </TabsContent>

            <TabsContent value="blocked" class="flex-1 mt-2 overflow-hidden">
                <FriendList :items="blockedItems" />
            </TabsContent>
        </Tabs>

    </div>


    <AddFriendModal v-model:open="addFriendOpen" @added="loadAll" />
</template>


<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import Input from "@/components/ui/input/Input.vue";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { IconCookieManFilled, IconUserPlus } from "@tabler/icons-vue";
import FriendList from "./FriendList.vue";

import { useLocale } from "@/store/localeStore";
import { useApi } from "@/store/apiStore";

import { FriendRequest, Friendship, SendFriendStatus, UserBlock } from "@/lib/glue/argonChat";
import AddFriendModal from "@/components/modals/AddFriendModal.vue";
import { useBus } from "@/store/busStore";
import { useFriendEvents } from "@/composables/useFriendEvents";
import { useMe } from "@/store/meStore";

const { t } = useLocale();
defineOptions({ inheritAttrs: false });

const me = useMe();
const api = useApi();
const client = api.freindsInteraction;
const query = ref("");
const activeTab = ref("friends");

const meId = computed(() => me.me!.userId);

const friends = ref<Friendship[]>([]);
const incoming = ref<FriendRequest[]>([]);
const outgoing = ref<FriendRequest[]>([]);
const blocked = ref<UserBlock[]>([]);

const addFriendOpen = ref(false);
function openAddFriend() {
    addFriendOpen.value = true;
}

const friendsItems = computed(() =>
    friends.value
        .map((x) => ({
            kind: "friend" as const,
            userId: x.friendId,
            displayName: x.friendId,
            avatarUrl: null,
        }))
        .filter(i => i.displayName.toLowerCase().includes(query.value.toLowerCase()))
);



const incomingItems = computed(() =>
    incoming.value
        .map((x) => ({
            kind: "incoming" as const,
            userId: x.requesterId,
            displayName: x.requesterId,
            avatarUrl: null,
        }))
        .filter(i => i.displayName.toLowerCase().includes(query.value.toLowerCase()))
);

const outgoingItems = computed(() =>
    outgoing.value
        .map((x) => ({
            kind: "outgoing" as const,
            userId: x.targetId,
            displayName: x.targetId,
            avatarUrl: null,
        }))
        .filter(i => i.displayName.toLowerCase().includes(query.value.toLowerCase()))
);

const blockedItems = computed(() =>
    blocked.value
        .map((x) => ({
            kind: "blocked" as const,
            userId: x.blockedId,
            displayName: x.blockedId,
            avatarUrl: null,
        }))
        .filter(i => i.displayName.toLowerCase().includes(query.value.toLowerCase()))
);

async function loadAll() {
    friends.value = await client.GetMyFriendships(50, 0);
    incoming.value = await client.GetMyFriendPendingList(50, 0);
    outgoing.value = await client.GetMyFriendOutgoingList(50, 0);
    blocked.value = await client.GetBlockList(50, 0);
}
onMounted(loadAll);

async function acceptRequest(from: string) {
    await client.AcceptFriendRequest(from);
}

async function declineRequest(from: string) {
    await client.DeclineFriendRequest(from);
}

async function cancelRequest(to: string) {
    await client.CancelFriendRequest(to);
}

async function unfriendRequest(to: string) {
    await client.RemoveFriend(to);
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
