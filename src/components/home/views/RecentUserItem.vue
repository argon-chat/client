<script setup lang="ts">
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { UserStatus, ActivityPresenceKind } from "@argon/glue";
import { useMe } from "@/store/auth/meStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useLocale } from "@/store/system/localeStore";
import { computed } from "vue";
import { IconPin } from "@tabler/icons-vue";
import type { DateTimeOffset } from "@argon-chat/ion.webcore";

const me = useMe();
const pool = usePoolStore();
const { t } = useLocale();

const props = defineProps<{
    userId: string;
    displayName: string;
    lastMessage?: string | null;
    lastMessageAt?: DateTimeOffset | null;
    isPinned?: boolean;
    status?: UserStatus;
    unreadCount?: number;
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

const activityText = computed(() => {
    const a = displayActivity.value;
    if (!a) return null;
    const prefixMap: Record<number, string> = {
        [ActivityPresenceKind.GAME]: "activity_play_in",
        [ActivityPresenceKind.SOFTWARE]: "activity_work_in",
        [ActivityPresenceKind.STREAMING]: "activity_stream",
        [ActivityPresenceKind.LISTEN]: "activity_listen",
    };
    const prefix = prefixMap[a.kind];
    return prefix ? `${t(prefix)} ${a.titleName}` : a.titleName;
});

const subtitleText = computed(() => {
    if (activityText.value) return activityText.value;
    if (props.lastMessage) return props.lastMessage;
    return null;
});

const timeAgo = computed(() => {
    if (!props.lastMessageAt?.date) return "";
    const now = Date.now();
    const ts = props.lastMessageAt.date.getTime();
    const diff = now - ts;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return t("now");
    if (min < 60) return `${min}m`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w`;
});
</script>

<template>
    <div class="recent-user flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-accent/50 min-w-0"
        @click="emit('open', userId)">
        <!-- Avatar with status dot -->
        <div class="relative w-[36px] h-[36px] shrink-0">
            <ArgonAvatar :user-id="userId" :overrided-size="36" />
            <span :class="me.statusClass(displayStatus)"
                class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card" />
        </div>

        <!-- Name + subtitle -->
        <div class="flex flex-col flex-1 overflow-hidden min-w-0 gap-0.5">
            <div class="flex items-center gap-1">
                <IconPin v-if="isPinned" class="w-3 h-3 text-primary shrink-0" />
                <span class="text-[13px] font-medium truncate leading-tight"
                    :class="{ 'font-semibold': unreadCount && unreadCount > 0 }">
                    {{ displayName }}
                </span>
            </div>
            <span v-if="subtitleText"
                class="text-[11px] text-muted-foreground truncate leading-tight"
                :class="{ 'text-foreground/70': activityText }">
                {{ subtitleText }}
            </span>
        </div>

        <!-- Time + unread badge -->
        <div class="flex flex-col items-end gap-1 shrink-0 self-start pt-0.5">
            <span v-if="timeAgo" class="text-[10px] text-muted-foreground leading-none"
                :class="{ 'text-primary font-medium': unreadCount && unreadCount > 0 }">
                {{ timeAgo }}
            </span>
            <span v-if="unreadCount && unreadCount > 0"
                class="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
                {{ unreadCount > 99 ? '99+' : unreadCount }}
            </span>
        </div>
    </div>
</template>

<style scoped>
.recent-user {
    transition: background-color 0.15s ease;
}
</style>
