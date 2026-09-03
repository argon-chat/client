<script setup lang="ts">
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import StatusDot from "@/components/StatusDot.vue";
import { Button } from "@argon/ui/button";
import { Badge } from "@argon/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@argon/ui/popover";
import UserProfilePopover from "@/components/popovers/UserProfilePopover.vue";
import ReportDialog from "@/components/modals/ReportDialog.vue";
import { useLocale } from "@/store/system/localeStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useMe } from "@/store/auth/meStore";
import { ref, computed, watch } from "vue";
import { ActivityPresenceKind, ReportTargetKind, UserStatus } from "@argon/glue";

const { t } = useLocale();
const pool = usePoolStore();
const me = useMe();
const isOpened = ref(false);
const reportDialogOpen = ref(false);
const reportUserId = ref('');

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
    disabled?: boolean;
}>();

const user = pool.getUserReactive(computed(() => props.item.userId));

// getUserReactive only mirrors what the local cache already holds, and someone who sent a friend
// request from outside any shared space has never been cached — which is why pending rows rendered
// as nothing at all. Asking for the identity writes it to the cache and the live query picks it up.
watch(
    () => props.item.userId,
    (userId) => {
        if (userId && !user.value) void pool.getUser(userId);
    },
    { immediate: true },
);

const emit = defineEmits<{
    (e: "accept", fromUserId: string): void;
    (e: "decline", fromUserId: string): void;
    (e: "cancel", toUserId: string): void;
    (e: "unfriend", toUserId: string): void;
}>();

function onReportProfile(userId: string) {
  isOpened.value = false;
  reportUserId.value = userId;
  setTimeout(() => { reportDialogOpen.value = true; }, 100);
}

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

// A row with nothing under the name looked half-empty, so a friend without an activity shows their
// status instead. InGame and Listen have no label of their own — when they carry no activity to
// name, "online" is what they mean.
const statusKey = computed(() => {
    const status = user.value?.status ?? UserStatus.Offline;
    return status === UserStatus.InGame || status === UserStatus.Listen
        ? UserStatus.Online
        : status;
});
</script>

<template>
    <Popover v-if="user && item.kind === 'friend'" v-model:open="isOpened">
        <PopoverContent style="width: 24rem;"
            class="profile-popover p-0 rounded-2xl shadow-xl border overflow-hidden">
            <UserProfilePopover :user-id="user.userId" @close:pressed="isOpened = false" @report="onReportProfile" />
        </PopoverContent>
        <PopoverTrigger as-child>
            <div class="friend-row friend-row--clickable" :class="{ 'friend-row--disabled': disabled }">
                <div class="friend-row-avatar">
                    <ArgonAvatar :user-id="user.userId" :overrided-size="38" />
                    <StatusDot :status="user.status" :size="14" class="friend-row-dot" />
                </div>

                <div class="friend-row-main">
                    <span class="friend-row-name">{{ user.displayName }}</span>
                    <span v-if="user.activity" class="friend-row-sub">
                        {{ t(getTextForActivityKind(user.activity.kind)) }}
                        <span class="friend-row-sub-strong">{{ user.activity.titleName }}</span>
                    </span>
                    <span v-else class="friend-row-sub">
                        <span :class="me.statusClass(statusKey, false)">{{ t(`status_${statusKey}`) }}</span>
                    </span>
                </div>

                <div class="friend-row-actions" @click.stop>
                    <Button
                        variant="ghost"
                        size="sm"
                        class="friend-row-remove"
                        :disabled="disabled"
                        @click="emit('unfriend', item.userId)"
                    >
                        {{ t("unfriend") }}
                    </Button>
                </div>
            </div>
        </PopoverTrigger>
    </Popover>

    <!-- Requests and blocks render whether or not the identity has resolved yet: an incoming
         request you cannot see is one you cannot accept. -->
    <div
        v-else
        class="friend-row"
        :class="{
            'friend-row--disabled': disabled,
            'friend-row--waiting': item.kind === 'incoming',
            'friend-row--muted': item.kind === 'blocked',
        }"
    >
        <div class="friend-row-avatar">
            <ArgonAvatar :user-id="item.userId" :overrided-size="38" />
        </div>

        <div class="friend-row-main">
            <span class="friend-row-name" :class="{ 'friend-row-name--pending': !user }">
                {{ user?.displayName ?? item.displayName }}
            </span>
            <span class="friend-row-sub">
                <Badge v-if="item.kind === 'blocked'" variant="destructive" class="friend-row-badge">
                    {{ t("blocked_status") }}
                </Badge>
            </span>
        </div>

        <div class="friend-row-actions">
            <template v-if="item.kind === 'incoming'">
                <Button size="sm" :disabled="disabled" @click="emit('accept', item.userId)">
                    {{ t("accept") }}
                </Button>
                <Button variant="ghost" size="sm" class="friend-row-remove" :disabled="disabled"
                    @click="emit('decline', item.userId)">
                    {{ t("decline") }}
                </Button>
            </template>

            <template v-else-if="item.kind === 'outgoing'">
                <Button variant="ghost" size="sm" class="friend-row-remove" :disabled="disabled"
                    @click="emit('cancel', item.userId)">
                    {{ t("cancel") }}
                </Button>
            </template>

            <template v-else-if="item.kind === 'friend'">
                <Button variant="ghost" size="sm" class="friend-row-remove" :disabled="disabled"
                    @click="emit('unfriend', item.userId)">
                    {{ t("unfriend") }}
                </Button>
            </template>
        </div>
    </div>

    <ReportDialog
      v-model:open="reportDialogOpen"
      :target-kind="ReportTargetKind.PROFILE"
      :target-id="reportUserId"
    />
</template>

<style scoped>
.friend-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.625rem;
    border-radius: calc(var(--radius) - 4px);
    transition: background 0.15s ease;
}

.friend-row--clickable {
    cursor: pointer;
}

.friend-row:hover {
    background: hsl(var(--accent) / 0.6);
}

/* A request waiting on you is the one row on this screen that wants something back. */
.friend-row--waiting {
    background: hsl(var(--primary) / 0.06);
}

.friend-row--waiting:hover {
    background: hsl(var(--primary) / 0.1);
}

.friend-row--muted {
    opacity: 0.7;
}

.friend-row--disabled {
    opacity: 0.5;
    pointer-events: none;
}

.friend-row-avatar {
    position: relative;
    flex-shrink: 0;
    line-height: 0;
}

/* The dot carries a --card coloured ring, so it only reads as a badge while the row sits on the
   panel — which it now always does. */
.friend-row-dot {
    position: absolute;
    right: -1px;
    bottom: -1px;
}

.friend-row-main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    flex: 1;
    min-width: 0;
    /* Two lines whether or not the second one has content, so rows keep one rhythm. */
    min-height: 2.375rem;
}

.friend-row-name {
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.15rem;
    color: hsl(var(--foreground));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.friend-row-sub {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
    line-height: 1rem;
    color: hsl(var(--muted-foreground));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.friend-row-sub-strong {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Still resolving — the id stands in, so the row is never blank. */
.friend-row-name--pending {
    color: hsl(var(--muted-foreground));
    font-family: ui-monospace, "Fira Code", monospace;
    font-size: 0.75rem;
}

.friend-row-badge {
    font-size: 0.625rem;
    padding: 0 0.375rem;
    line-height: 1rem;
}

.friend-row-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
}

/* Seven outlined buttons in a column read as a wall; the destructive intent shows up on hover. */
.friend-row-remove {
    color: hsl(var(--muted-foreground));
}

.friend-row-remove:hover:not(:disabled) {
    background: hsl(var(--destructive) / 0.12);
    color: hsl(var(--destructive));
}
</style>
