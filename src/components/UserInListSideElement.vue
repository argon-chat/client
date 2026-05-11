<template>
  <Popover v-if="props.enablePopup" v-model:open="isOpened">
    <PopoverContent style="width: 24rem;"
      class="profile-popover p-0 rounded-2xl shadow-xl border overflow-hidden">
      <UserProfilePopover :user-id="user.userId" @close:pressed="isOpened = false" @report="onReportProfile" />
    </PopoverContent>
    <PopoverTrigger as-child>
      <div class="user-element">
        <div class="user-avatar-wrap">
          <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="user.userId"
            :overridedSize="34" />
          <StatusDot :status="user.status" class="status-dot" />
        </div>
        <div class="user-text">
          <span class="user-name">{{ user.displayName }}</span>
          <span class="user-activity" v-if="user.activity && props.showActivity">
            <component :is="getActivityIcon(user.activity.kind)" class="activity-icon" :class="getActivityColor(user.activity.kind)" />
            <span class="font-semibold">{{ user.activity.titleName }}</span>
          </span>
          <span class="user-status-text" v-else-if="props.showActivity && customStatus">{{ customStatus }}</span>
        </div>
      </div>
    </PopoverTrigger>
  </Popover>

  <div v-else class="user-element">
    <div class="user-avatar-wrap">
      <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="user.userId"
        :overridedSize="34" />
      <StatusDot :status="user.status" class="status-dot" />
    </div>
    <div class="user-text">
      <span class="user-name">{{ user.displayName }}</span>
      <span class="user-activity" v-if="user.activity && props.showActivity">
        <component :is="getActivityIcon(user.activity.kind)" class="activity-icon" :class="getActivityColor(user.activity.kind)" />
        <span class="font-semibold">{{ user.activity.titleName }}</span>
      </span>
      <span class="user-status-text" v-else-if="props.showActivity && customStatus">{{ customStatus }}</span>

    </div>
  </div>

  <ReportDialog
    v-model:open="reportDialogOpen"
    :target-kind="ReportTargetKind.PROFILE"
    :target-id="reportUserId"
  />
</template>
<script setup lang="ts">
import type { RealtimeUser } from "@/store/db/dexie";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import StatusDot from "@/components/StatusDot.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@argon/ui/popover";
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import ReportDialog from "./modals/ReportDialog.vue";
import { ref, onMounted } from "vue";
import { ActivityPresenceKind, ReportTargetKind } from "@argon/glue";
import { Gamepad2, Headphones, Monitor, Radio } from "lucide-vue-next";
import { usePoolStore } from "@/store/data/poolStore";
import { useProfileCacheStore } from "@/store/data/profileCacheStore";

const isOpened = ref(false);
const reportDialogOpen = ref(false);
const reportUserId = ref('');
const props = withDefaults(
  defineProps<{
    user: RealtimeUser;
    showActivity?: boolean;
    enablePopup?: boolean;
  }>(),
  { showActivity: true, enablePopup: true },
);
const me = useMe();
const { t } = useLocale();
const pool = usePoolStore();
const profileCache = useProfileCacheStore();
const customStatus = ref<string | null>(null);

onMounted(async () => {
  if (pool.selectedServer) {
    const profile = await profileCache.getProfile(pool.selectedServer, props.user.userId);
    customStatus.value = profile.customStatus || null;
  }
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

const getActivityIcon = (activityKind: ActivityPresenceKind) => {
  switch (activityKind) {
    case ActivityPresenceKind.GAME: return Gamepad2;
    case ActivityPresenceKind.LISTEN: return Headphones;
    case ActivityPresenceKind.SOFTWARE: return Monitor;
    case ActivityPresenceKind.STREAMING: return Radio;
    default: return Monitor;
  }
};

const getActivityColor = (activityKind: ActivityPresenceKind) => {
  switch (activityKind) {
    case ActivityPresenceKind.GAME: return 'activity-game';
    case ActivityPresenceKind.LISTEN: return 'activity-listen';
    case ActivityPresenceKind.SOFTWARE: return 'activity-software';
    case ActivityPresenceKind.STREAMING: return 'activity-streaming';
    default: return '';
  }
};

function onReportProfile(userId: string) {
  isOpened.value = false;
  reportUserId.value = userId;
  setTimeout(() => { reportDialogOpen.value = true; }, 100);
}
</script>

<style scoped>
.user-element {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  width: 100%;
}

.user-avatar-wrap {
  position: relative;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
}

.status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
}

.user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}

.user-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-activity {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 0.7rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  position: relative;
  top: -1px;
}

.activity-game { color: #22d3ee; }
.activity-listen { color: #4ade80; }
.activity-software { color: #fb923c; }
.activity-streaming { color: #a78bfa; }

.user-status-text {
  font-size: 0.7rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
}
</style>