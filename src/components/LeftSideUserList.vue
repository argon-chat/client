<template>
    <div class="user-list-container rounded-xl p-4 shadow-md w-56 overflow-y-auto scrollbar-thin scrollbar-hide scrollbar-thumb-gray-600 scrollbar-track-gray-800"
        style="background-color: #161616;
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);">
        <h3 class="text-lg text-white mb-4">{{ t("users") }}</h3>
        <ul class="text-gray-400 space-y-2">
            <li v-for="user in dataPool.activeServerUsers.value" :key="user.UserId"
                class="flex items-center space-x-3 hover:text-white user-item">
                <div class="relative" style="width: 40px; height: 45px;">
                    <ArgonAvatar :fallback="user.DisplayName" :file-id="user.AvatarFileId!" :user-id="user.UserId"
                        :overridedSize="40" />
                    <span :class="me.statusClass(user.status)"
                        class="absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-gray-800"></span>
                </div>
                <div class="flex flex-col items-start overflow-hidden shrink-0">
                    <span>{{ user.DisplayName }}</span>
                    <span class="text-[10px] flex" v-if="user.activity">
                        {{ t(getTextForActivityKind(user.activity.Kind)) }}
                        <span class="font-bold pl-1">
                            {{ user.activity.TitleName }}
                        </span>
                    </span>
                </div>

            </li>
        </ul>
    </div>
</template>
<script setup lang="ts">
import ArgonAvatar from '@/components/ArgonAvatar.vue';
import { ActivityPresenceKind } from '@/lib/glue/ActivityPresenceKind';
import { useLocale } from '@/store/localeStore';
import { useMe } from '@/store/meStore';
import { usePoolStore } from '@/store/poolStore';
const dataPool = usePoolStore();
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

<style lang="css" scoped>
.user-item {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    position: relative;
    mask-image: linear-gradient(to right, black 90%, transparent 100%);
}
</style>