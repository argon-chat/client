<template>
  <Popover v-if="props.enablePopup" v-model:open="isOpened">
    <PopoverContent style="width: 19rem;min-height: 25rem;"
      class="p-0 rounded-2xl shadow-xl border border-neutral-800 bg-[#09090b] text-white overflow-hidden">
      <UserProfilePopover :user-id="user.userId" @close:pressed="isOpened = false" />
    </PopoverContent>
    <PopoverTrigger as-child>
      <div class="relative" style="width: 35px; height: 40px;">
        <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="user.userId"
          :overridedSize="35" />
        <span :class="me.statusClass(user.status)"
          class="absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-gray-800"></span>
      </div>
    </PopoverTrigger>
  </Popover>

  <div v-else class="relative" style="width: 40px; height: 45px;">
    <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="user.userId"
      :overridedSize="40" />
    <span :class="me.statusClass(user.status)"
      class="absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-gray-800"></span>
  </div>
  <div class="flex flex-col items-start overflow-hidden shrink-0">
    <span>{{ user.displayName }}</span>
    <span class="text-[10px] flex" v-if="user.activity && props.showActivity">
      {{ t(getTextForActivityKind(user.activity.kind)) }}
      <span class="font-bold pl-1">
        {{ user.activity.titleName }}
      </span>
    </span>

  </div>
</template>
<script setup lang="ts">
import type { RealtimeUser } from "@/store/db/dexie";
import { useLocale } from "@/store/localeStore";
import { useMe } from "@/store/meStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import UserProfilePopover from "./UserProfilePopover.vue";
import { ref } from "vue";
import { ActivityPresenceKind } from "@/lib/glue/argonChat";

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
</script>