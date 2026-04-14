<template>
    <template v-if="!isLoading && user && userProfile">
        <Transition name="profile-reveal" appear>
        <div class="popover-inner">
            <!-- Banner + Avatar -->
            <div class="banner-section">
                <ArgonBanner :file-id="userProfile.bannerFileID" :user-id="userProfile.userId" />
                <div class="avatar-anchor">
                    <div class="avatar-ring">
                        <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="props.userId"
                            :overridedSize="72" />
                        <span :class="me.statusClass(user.status)" class="avatar-status"></span>
                    </div>
                </div>
            </div>

            <!-- Activity pill (over banner, top-right) -->
            <div v-if="user.activity" class="activity-pill" ref="activityWrapper">
                <span
                    class="pointer-events-none absolute inset-y-0 left-0 w-3 z-10 activity-fade-left"
                    v-if="shouldScroll"></span>
                <span
                    class="pointer-events-none absolute inset-y-0 right-0 w-3 z-10 activity-fade-right"
                    v-if="shouldScroll"></span>
                <span :class="['whitespace-nowrap inline-flex', shouldScroll ? 'animate-marquee' : '']"
                    ref="activityText">
                    <span>
                        {{ t(getTextForActivityKind(user.activity.kind)) }}
                        <span class="font-semibold pl-0.5">{{ user.activity.titleName }}</span>
                    </span>
                    <span v-if="shouldScroll" class="pl-6">
                        {{ t(getTextForActivityKind(user.activity.kind)) }}
                        <span class="font-semibold pl-0.5">{{ user.activity.titleName }}</span>
                    </span>
                </span>
            </div>

            <!-- Content -->
            <div class="profile-content">
                <!-- Name + Badges -->
                <div class="name-row">
                    <span class="display-name">{{ user.displayName }}</span>

                    <!-- <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                        v-if="userProfile.">
                        <Tooltip>
                            <TooltipTrigger>
                                <IconDiamondFilled class="badge-icon text-violet-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Argon Premium</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider> -->
                    <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                        v-if="userProfile.badges.find(q => q == 'owner')">
                        <Tooltip>
                            <TooltipTrigger>
                                <CrownIcon class="badge-icon fill-blue-400 text-yellow-400" />
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
                                <IconCat class="badge-icon fill-purple-400" />
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
                                <IconCpu class="badge-icon fill-yellow-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Argon Contributor</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div class="username">@{{ user.username }}</div>

                <!-- Custom status -->
                <div v-if="userProfile.customStatus" class="custom-status">
                    <span class="custom-status-text">{{ userProfile.customStatus }}</span>
                </div>

                <Separator class="section-sep" />

                <!-- Roles -->
                <div v-if="resolvedRoles.length > 0" class="roles-section">
                    <div class="section-label">{{ t('roles') }}</div>
                    <div class="roles-list">
                        <span v-for="role in resolvedRoles" :key="role.id" class="role-chip"
                            :style="{ '--role-color': formatColour(role.colour) }">
                            <span class="role-dot" :style="{ background: formatColour(role.colour) }"></span>
                            {{ role.name }}
                        </span>
                    </div>
                </div>

                <!-- Member since -->
                <div v-if="memberJoinedAt" class="member-since">
                    <div class="section-label">{{ t('member_since') }}</div>
                    <div class="member-since-date">{{ formatDate(memberJoinedAt) }}</div>
                </div>

                <!-- Bio -->
                <div v-if="userProfile.bio" class="bio-block">
                    {{ userProfile.bio }}
                </div>
            </div>
        </div>
        </Transition>
    </template>
    <template v-else>
        <div class="loading-skeleton">
            <div class="skeleton-banner"></div>
            <div class="skeleton-content">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-line skeleton-line--name"></div>
                <div class="skeleton-line skeleton-line--tag"></div>
                <div class="skeleton-line skeleton-line--bio"></div>
                <div class="skeleton-line skeleton-line--bio2"></div>
            </div>
        </div>
    </template>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import ArgonAvatar from "./../ArgonAvatar.vue";
import { CrownIcon } from "lucide-vue-next";
import { IconDiamondFilled } from "@tabler/icons-vue";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@argon/ui/tooltip";
import { Separator } from "@argon/ui/separator";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { db, type RealtimeUser } from "@/store/db/dexie";
import { useMe } from "@/store/auth/meStore";
import { useLocale } from "@/store/system/localeStore";
import { persistedValue } from "@argon/storage";
import ArgonBanner from "./../ArgonBanner.vue";
import IconCat from "@argon/assets/icons/icon_cat.svg";
import IconCpu from "@argon/assets/icons/icon_gpu_04.svg";
import { ActivityPresenceKind, type ArgonUserProfile, type Archetype } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";

const isLoading = ref(true);
const api = useApi();
const pool = usePoolStore();

const userProfile = ref(null as null | ArgonUserProfile);
const user = ref(undefined as undefined | RealtimeUser);
const resolvedRoles = ref<Archetype[]>([]);
const memberJoinedAt = ref<Date | null>(null);

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const isLightTheme = computed(() => currentTheme.value === "light");

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

const getLuminance = (r: number, g: number, b: number) => {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const formatColour = (argb: number) => {
  const a = ((argb >> 24) & 0xff) / 255;
  let r = (argb >> 16) & 0xff;
  let g = (argb >> 8) & 0xff;
  let b = argb & 0xff;
  const luminance = getLuminance(r, g, b);
  if (isLightTheme.value) {
    if (luminance > 0.5) {
      const factor = 0.6;
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
    }
  } else {
    if (luminance < 0.1) {
      const factor = 2;
      r = Math.min(255, Math.round(r * factor + 50));
      g = Math.min(255, Math.round(g * factor + 50));
      b = Math.min(255, Math.round(b * factor + 50));
    }
  }
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
};

const formatDate = (date: Date) => {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

  // Resolve archetype details for role chips
  if (userProfile.value.archetypes?.length > 0) {
    const archetypeIds = userProfile.value.archetypes.map(a => a.archetypeId);
    const archetypes = await db.archetypes
      .where("id")
      .anyOf(archetypeIds)
      .filter(a => !a.isHidden)
      .toArray();
    resolvedRoles.value = archetypes;
  }

  // Fetch member join date
  if (pool.selectedServer) {
    const member = await db.members
      .where("[userId+spaceId]")
      .equals([props.userId, pool.selectedServer])
      .first();
    if (member?.joinedAt) {
      const joinedDate = (member.joinedAt as any)?.date ?? member.joinedAt;
      memberJoinedAt.value = new Date(joinedDate);
    }
  }

  isLoading.value = false;

  await nextTick();
  const wrapper = activityWrapper.value;
  const text = activityText.value;

  if (wrapper && text) {
    shouldScroll.value = text.scrollWidth > wrapper.clientWidth;
  }
});
</script>

<style lang="css" scoped>
/* Content reveal transition */
.profile-reveal-enter-active {
  transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.profile-reveal-enter-from {
  opacity: 0;
  transform: scale(0.96) translateY(6px);
}

/* Staggered section animation */
.profile-content > * {
  animation: section-fade-in 0.3s ease both;
}
.profile-content > *:nth-child(1) { animation-delay: 0.05s; }
.profile-content > *:nth-child(2) { animation-delay: 0.08s; }
.profile-content > *:nth-child(3) { animation-delay: 0.12s; }
.profile-content > *:nth-child(4) { animation-delay: 0.16s; }
.profile-content > *:nth-child(5) { animation-delay: 0.20s; }
.profile-content > *:nth-child(6) { animation-delay: 0.24s; }
.profile-content > *:nth-child(7) { animation-delay: 0.28s; }

@keyframes section-fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.popover-inner {
  position: relative;
}

/* Banner + Avatar */
.banner-section {
  position: relative;
}

.avatar-anchor {
  position: absolute;
  left: 16px;
  bottom: -36px;
}

.avatar-ring {
  position: relative;
  border-radius: 50%;
  padding: 3px;
  background: hsl(var(--card));
}

.avatar-status {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 18px;
  height: 14px;
  border-radius: 9999px;
  border: 3px solid hsl(var(--card));
}

/* Activity pill */
.activity-pill {
  position: absolute;
  top: 100px;
  right: 12px;
  display: flex;
  align-items: center;
  overflow: hidden;
  max-width: 140px;
  padding: 3px 8px;
  border-radius: 8px;
  background: hsl(var(--background) / 0.85);
  backdrop-filter: blur(6px);
  font-size: 0.65rem;
  color: hsl(var(--muted-foreground));
}

.activity-fade-left {
  background: linear-gradient(to right, hsl(var(--background) / 0.85), transparent);
}
.activity-fade-right {
  background: linear-gradient(to left, hsl(var(--background) / 0.85), transparent);
}

/* Content */
.profile-content {
  padding: 44px 16px 16px;
}

.name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.display-name {
  font-size: 1.15rem;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.badge-icon {
  width: 20px;
  height: 20px;
  vertical-align: middle;
}

.username {
  font-size: 0.8rem;
  color: hsl(var(--muted-foreground));
  margin-bottom: 4px;
}

/* Custom status */
.custom-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
  font-size: 0.78rem;
  color: hsl(var(--foreground) / 0.7);
  font-style: italic;
}

.custom-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Section separator */
.section-sep {
  margin: 10px 0;
  opacity: 0.4;
}

/* Roles */
.roles-section {
  margin-bottom: 10px;
}

.section-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
  margin-bottom: 6px;
}

.roles-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.9);
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border) / 0.4);
}

.role-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Member since */
.member-since {
  margin-bottom: 10px;
}

.member-since-date {
  font-size: 0.78rem;
  color: hsl(var(--foreground) / 0.8);
}

.bio-block {
  font-size: 0.82rem;
  color: hsl(var(--foreground) / 0.85);
  background: hsl(var(--background));
  padding: 8px 12px;
  border-radius: 10px;
  line-height: 1.45;
}

/* Loading skeleton */
.loading-skeleton {
  width: 100%;
  min-height: 25rem;
  overflow: hidden;
}

.skeleton-banner {
  height: 96px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 16px 16px 0 0;
  animation: pulse 1.5s ease-in-out infinite;
}

.skeleton-content {
  padding: 16px;
  position: relative;
}

.skeleton-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: hsl(var(--muted) / 0.4);
  margin-top: -36px;
  margin-bottom: 20px;
  animation: pulse 1.5s ease-in-out infinite;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: hsl(var(--muted) / 0.25);
  margin-bottom: 10px;
  animation: pulse 1.5s ease-in-out infinite;
}

.skeleton-line--name { width: 60%; height: 16px; }
.skeleton-line--tag { width: 35%; }
.skeleton-line--bio { width: 90%; animation-delay: 0.2s; }
.skeleton-line--bio2 { width: 70%; animation-delay: 0.3s; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Marquee */
@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.animate-marquee {
  animation: marquee 10s linear infinite;
}
</style>

<style lang="css">
/* Override radix popover animation for profile popovers */
.profile-popover[data-state="open"] {
  animation-duration: 0.28s !important;
  animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}
.profile-popover[data-state="closed"] {
  animation-duration: 0.15s !important;
  animation-timing-function: ease-in !important;
}
</style>