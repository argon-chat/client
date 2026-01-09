<script setup lang="ts">
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { UserStatus, ActivityPresenceKind } from "@argon/glue";
import { useMe } from "@/store/meStore";
import { usePoolStore } from "@/store/poolStore";
import { useLocale } from "@/store/localeStore";
import { computed } from "vue";

const me = useMe();
const pool = usePoolStore();
const { t } = useLocale();

const props = defineProps<{
    userId: string;
    displayName: string;
    lastMessage?: string | null;
    status?: UserStatus;
}>();

const emit = defineEmits<{
    (e: "open", userId: string): void;
}>();

const user = pool.getUserReactive(computed(() => props.userId));

const ECHO_USER_ID = "44444444-2222-1111-2222-444444444444";

const isEchoUser = computed(() => props.userId === ECHO_USER_ID);

const displayStatus = computed(() => {
    if (isEchoUser.value) return UserStatus.Online;
    return user.value?.status ?? UserStatus.Offline;
});

const displayActivity = computed(() => {
    if (isEchoUser.value) {
        return {
            kind: ActivityPresenceKind.LISTEN,
            titleName: "Music... 🎵🎶"
        };
    }
    return user.value?.activity;
});

const getTextForActivityKind = (activityKind: ActivityPresenceKind) => {
    switch (activityKind) {
        case ActivityPresenceKind.GAME:
            return "activity_play_in";
        case ActivityPresenceKind.SOFTWARE:
            return "activity_work_in";
        case ActivityPresenceKind.STREAMING:
            return "activity_stream";
        case ActivityPresenceKind.LISTEN:
            return "activity_listen";
        default:
            return "error";
    }
};

</script>

<template>
    <div class="recent-user flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-accent/50 min-w-0"
        @click="emit('open', userId)">
        <div class="relative w-[40px] h-[40px] shrink-0">
            <SmartArgonAvatar :user-id="userId" :overrided-size="40" />

            <span :class="me.statusClass(displayStatus)"
                class="absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-card"></span>
        </div>

        <div class="flex flex-col flex-1 overflow-hidden min-w-0">

            <div class="text-sm font-medium truncate">
                {{ displayName }}
            </div>

            <div v-if="displayActivity" class="text-[10px] flex items-center text-muted-foreground truncate">
                {{ t(getTextForActivityKind(displayActivity.kind)) }}
                <span class="font-bold pl-1 truncate">
                    {{ displayActivity.titleName }}
                </span>
            </div>

            <div v-else-if="lastMessage"
                class="relative text-xs text-gray-400 flex-1 min-w-0 max-w-full overflow-hidden flex">
                <span class="block overflow-hidden whitespace-nowrap text-ellipsis min-w-0 flex-1"
                    style="min-width: 0 !important; max-width: 100% !important; display: block;">
                    {{ lastMessage }}
                </span>

                <!-- <div class="absolute top-0 right-0 h-full pointer-events-none"
                    style="width: 30px; background: linear-gradient(to right, transparent, #161616); " /> -->
            </div>

            <div v-else class="text-xs text-gray-500 italic truncate">
            </div>

        </div>
    </div>
</template>

<style scoped>
.recent-user {
    transition: background-color 0.15s ease;
}
</style>
