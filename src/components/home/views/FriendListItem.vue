<script setup lang="ts">
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { Button } from "@/components/ui/button";
import { RealtimeUser } from "@/store/db/dexie";
import { useLocale } from "@/store/localeStore";
import { usePoolStore } from "@/store/poolStore";
import { onMounted, ref } from "vue";

const { t } = useLocale();
const pool = usePoolStore();

export type FriendListItemVm =
    | {
        kind: "friend";
        userId: string;
        displayName: string;
    }
    | {
        kind: "incoming";
        userId: string;
        displayName: string;
    }
    | {
        kind: "outgoing";
        userId: string;
        displayName: string;
    }
    | {
        kind: "blocked";
        userId: string;
        displayName: string;
    };

const props = defineProps<{
    item: FriendListItemVm;
}>();

const user = ref(null as null | RealtimeUser | undefined)

const emit = defineEmits<{
    (e: "accept", fromUserId: string): void;
    (e: "decline", fromUserId: string): void;
    (e: "cancel", toUserId: string): void;
    (e: "unfriend", toUserId: string): void;
}>();

onMounted(async() => {
    user.value = await pool.getUser(props.item.userId);
})

</script>

<template>
    <div class="flex justify-between items-center" v-if="user">
        <div class="flex items-center gap-3">
            <SmartArgonAvatar :user-id="user.userId" :overrided-size="32"/>
            <div class="text-sm truncate">
                {{ user.displayName }}
            </div>
        </div>

        <template v-if="item.kind === 'friend'">
            <Button variant="outline" size="sm" @click="emit('unfriend', item.userId)">
                {{ t("unfriend") }}
            </Button>
        </template>

        <template v-else-if="item.kind === 'incoming'">
            <div class="flex gap-2">
                <Button size="sm" @click="emit('accept', item.userId)">
                    {{ t("accept") }}
                </Button>
                <Button variant="destructive" size="sm" @click="emit('decline', item.userId)">
                    {{ t("decline") }}
                </Button>
            </div>
        </template>

        <template v-else-if="item.kind === 'outgoing'">
            <Button variant="secondary" size="sm" @click="emit('cancel', item.userId)">
                {{ t("cancel") }}
            </Button>
        </template>

        <template v-else-if="item.kind === 'blocked'">
            <Button variant="secondary" size="sm">
                {{ t("blocked") }}
            </Button>
        </template>
    </div>
</template>
