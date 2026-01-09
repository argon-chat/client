<template>
    <template v-if="!isLoading && user && userProfile">
        <div>
            <div class="relative">
                <button @click="emit('close:pressed')"
                    class="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition"
                    aria-label="Close">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <!-- Banner -->
                <ArgonBanner :file-id="userProfile.bannerFileID" :user-id="userProfile.userId" />
                <!-- Avatar -->
                <div class="absolute left-4 -bottom-10">
                    <div class="relative">
                        <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="props.userId"
                            :overridedSize="80" />
                        <span :class="me.statusClass(user.status)"
                            class="absolute bottom-0 right-0 w-6 h-4 rounded-full border-2 border-gray-800"></span>
                    </div>
                </div>
            </div>
        </div>
        <span class="text-[10px] flex fixed right-2 p-2 overflow-hidden max-w-[160px] min-w-[12rem] text-center items-center" v-if="user.activity"
            ref="activityWrapper">
            <span
                class="pointer-events-none absolute inset-y-0 left-0 w-4 z-10 bg-gradient-to-r from-[rgba(0,0,0,0.7)] to-transparent" v-if="shouldScroll"></span>
            <span
                class="pointer-events-none absolute inset-y-0 right-0 w-4 z-10 bg-gradient-to-l from-[rgba(0,0,0,0.7)] to-transparent" v-if="shouldScroll"></span>
            <span :class="['whitespace-nowrap inline-block', shouldScroll ? 'animate-marquee' : '']" ref="activityText"
                style="display: inline-flex;">
                <span>
                    {{ t(getTextForActivityKind(user.activity.kind)) }}
                    <span class="font-bold pl-1">{{ user.activity.titleName }}</span>
                </span>
                <span v-if="shouldScroll" class="pl-8">
                    {{ t(getTextForActivityKind(user.activity.kind)) }}
                    <span class="font-bold pl-1">{{ user.activity.titleName }}</span>
                </span>
            </span>
        </span>
        <!-- Content -->
        <div class="pt-10 px-4 pb-4">
            <!-- Name + Tag -->
            <div class="flex flex-wrap items-center gap-1 mb-1 leading-none">
                <span class="text-xl font-semibold align-middle">{{ user.displayName }}</span>

                <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                    v-if="userProfile.badges.find(q => q == 'owner')">
                    <Tooltip>
                        <TooltipTrigger>
                            <CrownIcon class="w-6 h-6 fill-blue-400 text-yellow-400  align-middle" />
                        </TooltipTrigger>
                        <TooltipContent> 
                            <p>Space Owner</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                    v-if="userProfile.badges.find(q => q == 'staff')">
                    <Tooltip>
                        <TooltipTrigger>
                            <IconCat class="w-6 h-6 align-middle fill-purple-400" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Argon Staff</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                    v-if="userProfile.badges.find(q => q == 'contributor')">
                    <Tooltip>
                        <TooltipTrigger>
                            <IconCpu class="w-6 h-6 fill-yellow-400 align-middle" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Argon Contributor</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <div class="text-sm text-neutral-400 mb-2">@{{ user.username }}</div>
            <!-- Quote -->
            <div v-if="userProfile.bio" class="bg-[#232428] text-sm px-3 py-2 rounded-sm mb-4 max-w-xs">
                {{ userProfile.bio }}
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
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import ArgonAvatar from "./../ArgonAvatar.vue";
import {
  CrownIcon,
  ShieldCheckIcon,
  GitPullRequestCreateArrow,
} from "lucide-vue-next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@argon/ui/tooltip";
import { useApi } from "@/store/apiStore";
import { usePoolStore } from "@/store/poolStore";
import type { RealtimeUser } from "@/store/db/dexie";
import { useMe } from "@/store/meStore";
import { useLocale } from "@/store/localeStore";
import ArgonBanner from "./../ArgonBanner.vue";
import IconCat from "@argon/assets/icons/icon_cat.svg"
import IconCpu from "@argon/assets/icons/icon_gpu_04.svg"
import IconClean from "@argon/assets/icons/icon_clean.svg"
import IconGiga from "@argon/assets/icons/icon_gigachad.svg"
import { ActivityPresenceKind, ArgonUserProfile } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";

const isLoading = ref(true);
const api = useApi();
const pool = usePoolStore();

const userProfile = ref(null as null | ArgonUserProfile);
const user = ref(undefined as undefined | RealtimeUser);
const props = withDefaults(
  defineProps<{
    userId: Guid;
  }>(),
  {},
);

const emit = defineEmits<(e: "close:pressed") => void>();

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

const me = useMe();

const activityWrapper = ref<HTMLElement | null>(null);
const activityText = ref<HTMLElement | null>(null);
const shouldScroll = ref(false);

onMounted(async () => {
  userProfile.value = await api.serverInteraction.PrefetchProfile(
    pool.selectedServer!,
    props.userId,
  );
  userProfile.value.badges.push(
    ...(await pool.generateBadgesByArchetypes(userProfile.value.archetypes)),
  );
  user.value = await pool.getUser(props.userId);
  isLoading.value = false;

  await nextTick();
  const wrapper = activityWrapper.value;
  const text = activityText.value;

  if (wrapper && text) {
    shouldScroll.value = text.scrollWidth > wrapper.clientWidth;
  }
});

onUnmounted(() => {});
</script>
<style lang="css" scoped>
@keyframes marquee {
    0% {
        transform: translateX(0);
    }

    100% {
        transform: translateX(-50%);
    }
}

.animate-marquee {
    animation: marquee 10s linear infinite;
}
</style>