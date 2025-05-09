<template>
    <template v-if="!isLoading && user && userProfile">

        <div>
            <div class="relative">
                <!-- Banner -->
                <ArgonBanner :file-id="userProfile.BannerFileId" :user-id="userProfile.UserId"/>
                <!-- Avatar -->
                <div class="absolute left-4 -bottom-10">
                    <div class="relative">
                        <ArgonAvatar :fallback="user.DisplayName" :file-id="user.AvatarFileId!" :user-id="props.userId"
                            :overridedSize="80" />
                        <span :class="me.statusClass(user.status)"
                            class="absolute bottom-0 right-0 w-6 h-4 rounded-full border-2 border-gray-800"></span>
                    </div>
                </div>
            </div>
        </div>
        <span class="text-[10px] flex" style="position: fixed;right: 0.5rem;padding: 0.5rem;" v-if="user.activity">
            {{ t(getTextForActivityKind(user.activity.Kind)) }}
            <span class="font-bold pl-1">
                {{ user.activity.TitleName }}
            </span>
        </span>

        <!-- Content -->
        <div class="pt-10 px-4 pb-4">
            <!-- Name + Tag -->
            <div class="flex flex-wrap items-center gap-1 mb-1 leading-none">
                <span class="text-xl font-semibold align-middle">{{ user.DisplayName }}</span>

                <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                    v-if="userProfile.Badges.find(q => q == 'owner')">
                    <Tooltip>
                        <TooltipTrigger>
                            <CrownIcon class="w-5 h-5 text-yellow-400 align-middle" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Space Owner</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                    v-if="userProfile.Badges.find(q => q == 'staff')">
                    <Tooltip>
                        <TooltipTrigger>
                            <ShieldCheckIcon class="w-5 h-5 text-purple-400 align-middle" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Argon Staff</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                    v-if="userProfile.Badges.find(q => q == 'contributor')">
                    <Tooltip>
                        <TooltipTrigger>
                            <GitPullRequestCreateArrow class="w-5 h-5 text-yellow-400 align-middle" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Argon Contributor</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <div class="text-sm text-neutral-400 mb-2">@{{ user.Username }}</div>
            <!-- Quote -->
            <div v-if="userProfile.Bio" class="bg-[#232428] text-sm px-3 py-2 rounded-sm mb-4 max-w-xs">
                {{ userProfile.Bio }}
            </div>

            <!-- Roles -->
            <!--  <div class="flex flex-wrap gap-2 mb-4">
                <Badge v-for="role in user.roles" :key="role.name" variant="destructive">
                    <CigaretteIcon v-if="role.icon" class="w-3 h-3" />
                    {{ role.name }}
                </Badge>
            </div> -->
        </div>
    </template>
    <template v-else>
        <div class="h-full w-full flex items-center justify-center">
            <div class="bg-[#1e1e1e] rounded-xl shadow-md animate-pulse" style="width: 19rem;min-height: 25rem;"></div>
        </div>
    </template>

</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ArgonAvatar from './ArgonAvatar.vue';
import { CrownIcon, ShieldCheckIcon, GitPullRequestCreateArrow } from 'lucide-vue-next';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip';
import { useApi } from '@/store/apiStore';
import { usePoolStore } from '@/store/poolStore';
import { RealtimeUser } from '@/store/db/dexie';
import { useMe } from '@/store/meStore';
import { useLocale } from '@/store/localeStore';
import { ActivityPresenceKind } from '@/lib/glue/ActivityPresenceKind';
import ArgonBanner from './ArgonBanner.vue';

const isLoading = ref(true);
const api = useApi();
const pool = usePoolStore();

const userProfile = ref(null as null | IUserProfileDto);
const user = ref(undefined as undefined | RealtimeUser);
const props = withDefaults(defineProps<{
    userId: Guid
}>(), {});

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


const me = useMe();

onMounted(async () => {
    userProfile.value = await api.serverInteraction.PrefetchProfile(pool.selectedServer!, props.userId);
    user.value = await pool.getUser(props.userId);
    isLoading.value = false;
});

onUnmounted(() => {
})
</script>