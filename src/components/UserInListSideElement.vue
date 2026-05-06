<template>
  <Popover v-if="props.enablePopup" v-model:open="isOpened">
    <PopoverContent style="width: 24rem;"
      class="profile-popover p-0 rounded-2xl shadow-xl border overflow-hidden">
      <UserProfilePopover :user-id="user.userId" @close:pressed="isOpened = false" />
    </PopoverContent>
    <PopoverTrigger as-child>
      <div class="user-element">
        <div class="user-avatar-wrap">
          <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="user.userId"
            :overridedSize="34" />
          <span :class="me.statusClass(user.status)" class="status-dot"></span>
        </div>
        <div class="user-text">
          <span class="user-name">{{ user.displayName }}</span>
          <span class="user-activity" v-if="user.activity && props.showActivity">
            <component :is="getActivityIcon(user.activity.kind)" class="activity-icon" :class="getActivityColor(user.activity.kind)" />
            <span class="font-semibold">{{ user.activity.titleName }}</span>
          </span>
        </div>
      </div>
    </PopoverTrigger>
  </Popover>

  <div v-else class="user-element">
    <div class="user-avatar-wrap">
      <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="user.userId"
        :overridedSize="34" />
      <span :class="me.statusClass(user.status)" class="status-dot"></span>
    </div>
    <div class="user-text">
      <span class="user-name">{{ user.displayName }}</span>
      <span class="user-activity" v-if="user.activity && props.showActivity">
        <component :is="getActivityIcon(user.activity.kind)" class="activity-icon" :class="getActivityColor(user.activity.kind)" />
        <span class="font-semibold">{{ user.activity.titleName }}</span>
      </span>
    </div>
  </div>
</template>
<script setup lang="ts">
import type { RealtimeUser } from "@/store/db/dexie";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@argon/ui/popover";
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import { ref } from "vue";
import { ActivityPresenceKind } from "@argon/glue";
import { Gamepad2, Headphones, Monitor, Radio } from "lucide-vue-next";

const isOpened = ref(false);
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
  width: 13px;
  height: 10px;
  border-radius: 9999px;
  border: 2px solid hsl(var(--card));
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
</style>