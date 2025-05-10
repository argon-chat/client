<template>
    <Popover v-model:open="isOpened">
        <PopoverContent style="width: 19rem;min-height: 25rem;"
            class="p-0 rounded-2xl shadow-xl border border-neutral-800 bg-[#09090b] text-white overflow-hidden">
            <UserProfilePopover :user-id="user.UserId" @close:pressed="isOpened = false" />
        </PopoverContent>
        <PopoverTrigger as-child>
            <div class="relative" style="width: 40px; height: 45px;">
                <ArgonAvatar :fallback="user.DisplayName" :file-id="user.AvatarFileId!" :user-id="user.UserId"
                    :overridedSize="40" />
                <span :class="me.statusClass(user.status)"
                    class="absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-gray-800"></span>
            </div>
        </PopoverTrigger>
    </Popover>
    <div class="flex flex-col items-start overflow-hidden shrink-0">
        <span>{{ user.DisplayName }}</span>
        <span class="text-[10px] flex" v-if="user.activity">
            {{ t(getTextForActivityKind(user.activity.Kind)) }}
            <span class="font-bold pl-1">
                {{ user.activity.TitleName }}
            </span>
        </span>
    </div>
</template>
<script setup lang="ts">
import { ActivityPresenceKind } from '@/lib/glue/ActivityPresenceKind';
import { RealtimeUser } from '@/store/db/dexie';
import { useLocale } from '@/store/localeStore';
import { useMe } from '@/store/meStore';
import ArgonAvatar from '@/components/ArgonAvatar.vue';
import {
    Popover,
    PopoverTrigger,
    PopoverContent
} from '@/components/ui/popover';
import UserProfilePopover from './UserProfilePopover.vue';
import { ref } from 'vue';

const isOpened = ref(false);
withDefaults(defineProps<{
    user: RealtimeUser
}>(), {});
const me = useMe();
const { t } = useLocale();

const getTextForActivityKind = (activityKind: ActivityPresenceKind) => {
    switch (activityKind) {
        case "GAME": return "activity_play_in";
        case "SOFTWARE": return "activity_work_in";
        case "STREAMING": return "activity_stream";
        case "LISTEN": return "activity_listen";
        default: return "error";
    }
}

</script>