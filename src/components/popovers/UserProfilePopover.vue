<template>
    <template v-if="!isLoading && user && userProfile">
        <Transition name="profile-reveal" appear>
        <div class="popover-inner" :style="cardGlowStyle">
            <!-- Full-bleed background (extends behind everything) -->
            <div class="card-bg">
                <video
                    v-if="bgSrc"
                    :src="bgSrc"
                    autoplay
                    loop
                    muted
                    playsinline
                    class="card-bg-media"
                />
                <div v-else-if="hasColors" class="card-bg-media" :style="gradientStyle" />
                <div v-else class="card-bg-media card-bg-default" />
                <!-- Color tint overlay -->
                <div v-if="bgSrc && primaryTintStyle" class="card-bg-tint" :style="primaryTintStyle" />
            </div>

            <!-- Empty hero zone to reserve space for the background -->
            <div class="hero-spacer"></div>

            <!-- Glass content area (overlaps bg via negative margin) -->
            <div class="glass-zone">
                <!-- Frosted glass transition band -->
                <div class="glass-frost"></div>

                <!-- Shine line at the glass edge -->
                <div class="glass-shine" :style="glassShineTint"></div>

                <div class="glass-body" :style="glassTintStyle">
                    <!-- Avatar overlapping into the background -->
                    <div class="profile-header">
                        <div class="avatar-anchor">
                            <div class="hero-avatar" :style="avatarRingStyle">
                                <ArgonAvatar :fallback="user.displayName" :file-id="user.avatarFileId" :user-id="props.userId"
                                    :overridedSize="80" />
                                <span :class="me.statusClass(user.status)" class="status-dot"></span>
                            </div>
                        </div>
                        <div class="hero-info">
                            <div class="hero-name-row">
                                <span class="hero-display-name" :style="nameAccentStyle">{{ user.displayName }}</span>
                                <TooltipProvider :delayDuration="300" :ignoreNonKeyboardFocus="true"
                                    v-if="user && (user.flags & UserFlag.PREMIUM) !== 0">
                                    <Tooltip>
                                        <TooltipTrigger>
                                            <IconDiamondFilled class="badge-icon text-violet-400" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Argon Ultima</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
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
                            <div class="hero-username">@{{ user.username }}</div>
                            <!-- Status / Activity -->
                            <div class="hero-status">
                                <span v-if="user.activity" class="hero-activity">
                                    {{ t(getTextForActivityKind(user.activity.kind)) }}
                                    <span class="font-medium">{{ user.activity.titleName }}</span>
                                </span>
                                <span v-else class="hero-presence" :class="presenceClass">
                                    {{ statusText }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Custom status -->
                    <div v-if="userProfile.customStatus" class="custom-status">
                        <span class="custom-status-text">{{ userProfile.customStatus }}</span>
                    </div>

                    <Separator v-if="userProfile.customStatus" class="section-sep" />

                <!-- Roles -->
                <div class="roles-section">
                    <div class="section-label">{{ t('roles') }}</div>
                    <div class="roles-list">
                        <span v-for="role in resolvedRoles" :key="role.id" class="role-chip"
                            :style="{ '--role-color': formatColour(role.colour) }">
                            <span class="role-dot" :style="{ background: formatColour(role.colour) }"></span>
                            {{ role.name }}
                            <button v-if="canManageRoles && !role.isLocked && !role.isDefault"
                                class="role-remove" @click.stop="removeRole(role.id)" title="Remove role">×</button>
                        </span>
                        <button v-if="canManageRoles" class="role-chip role-add-btn" @click="showRolePicker = !showRolePicker" title="Add role">
                            <span>+</span>
                        </button>
                    </div>
                    <div v-if="showRolePicker && canManageRoles" class="role-picker">
                        <div v-for="role in availableRoles" :key="role.id"
                            class="role-picker-item" @click="addRole(role.id)">
                            <span class="role-dot" :style="{ background: formatColour(role.colour) }"></span>
                            {{ role.name }}
                        </div>
                        <div v-if="availableRoles.length === 0" class="text-xs text-muted-foreground p-2">
                            {{ t("no_roles_available") || "No roles available" }}
                        </div>
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
                </div><!-- .glass-body -->
            </div><!-- .glass-zone -->
        </div>
        </Transition>
    </template>
    <template v-else>
        <div class="loading-skeleton">
            <div class="skeleton-hero"></div>
            <div class="skeleton-content">
                <div class="skeleton-line skeleton-line--name"></div>
                <div class="skeleton-line skeleton-line--tag"></div>
                <div class="skeleton-line skeleton-line--bio"></div>
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
import { usePoolStore } from "@/store/data/poolStore";
import { useProfileCacheStore } from "@/store/data/profileCacheStore";
import { db, type RealtimeUser } from "@/store/db/dexie";
import { useMe } from "@/store/auth/meStore";
import { useLocale } from "@/store/system/localeStore";
import { persistedValue } from "@argon/storage";
import IconCat from "@argon/assets/icons/icon_cat.svg";
import IconCpu from "@argon/assets/icons/icon_gpu_04.svg";
import { ActivityPresenceKind, UserFlag, UserStatus, type ArgonUserProfile, type Archetype } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";
import { usePexStore } from "@/store/data/permissionStore";
import { useApi } from "@/store/system/apiStore";
import { argbToRgba, getBackgroundSrc } from "@/lib/profileCustomization";

const isLoading = ref(true);
const api = useApi();
const pool = usePoolStore();
const profileCache = useProfileCacheStore();
const pex = usePexStore();

const userProfile = ref(null as null | ArgonUserProfile);
const user = ref(undefined as undefined | RealtimeUser);
const resolvedRoles = ref<Archetype[]>([]);
const memberJoinedAt = ref<Date | null>(null);
const showRolePicker = ref(false);
const allSpaceRoles = ref<Archetype[]>([]);

const canManageRoles = computed(() => pex.has('ManageArchetype'));

const availableRoles = computed(() => {
  const currentIds = new Set(resolvedRoles.value.map(r => r.id));
  return allSpaceRoles.value.filter(r => !currentIds.has(r.id) && !r.isHidden && !r.isLocked);
});

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const isLightTheme = computed(() => currentTheme.value === "light");

// ── Profile customization computeds ──

const bgSrc = computed(() => getBackgroundSrc(userProfile.value?.backgroundId));

const hasColors = computed(() =>
  userProfile.value?.primaryColor != null || userProfile.value?.accentColor != null
);

const gradientStyle = computed(() => {
  const primary = userProfile.value?.primaryColor
    ? argbToRgba(userProfile.value.primaryColor)
    : "hsl(var(--muted))";
  const accent = userProfile.value?.accentColor
    ? argbToRgba(userProfile.value.accentColor)
    : primary;
  return { background: `linear-gradient(135deg, ${primary}, ${accent})` };
});

// Tint overlay when background + primaryColor
const primaryTintStyle = computed(() => {
  if (!userProfile.value?.primaryColor) return null;
  const color = argbToRgba(userProfile.value.primaryColor);
  const opacity = isLightTheme.value ? "0.12)" : "0.2)";
  return { background: color.replace(/[\d.]+\)$/, opacity) };
});

// Glass area tint from primaryColor
const glassTintStyle = computed(() => {
  if (isLightTheme.value) return {};
  if (!userProfile.value?.primaryColor) return {};
  const color = argbToRgba(userProfile.value.primaryColor);
  return { background: `linear-gradient(180deg, ${color.replace(/[\d.]+\)$/, "0.10)")}, transparent 60%)` };
});

// Glass shine line color tint
const glassShineTint = computed(() => {
  if (!userProfile.value?.accentColor) return {};
  const accent = argbToRgba(userProfile.value.accentColor);
  const opacity = isLightTheme.value ? "0.4)" : "0.3)";
  return { background: `linear-gradient(90deg, transparent, ${accent.replace(/[\d.]+\)$/, opacity)}, transparent)` };
});

// Accent glow on card border — more dramatic multi-layer glow
const cardGlowStyle = computed(() => {
  if (!userProfile.value?.accentColor) return {};
  const accent = argbToRgba(userProfile.value.accentColor);
  if (isLightTheme.value) {
    const border = accent.replace(/[\d.]+\)$/, "0.3)");
    const shadow = accent.replace(/[\d.]+\)$/, "0.15)");
    return { boxShadow: `0 4px 20px ${shadow}, inset 0 0 0 1px ${border}` };
  }
  const outerGlow = accent.replace(/[\d.]+\)$/, "0.25)");
  const midGlow = accent.replace(/[\d.]+\)$/, "0.12)");
  const innerBorder = accent.replace(/[\d.]+\)$/, "0.2)");
  return {
    boxShadow: `0 0 30px ${outerGlow}, 0 0 60px ${midGlow}, inset 0 0 0 1px ${innerBorder}`,
  };
});

// Avatar ring with accent — add a glow
const avatarRingStyle = computed(() => {
  if (!userProfile.value?.accentColor) return {};
  const accent = argbToRgba(userProfile.value.accentColor);
  if (isLightTheme.value) {
    const glow = accent.replace(/[\d.]+\)$/, "0.25)");
    return { borderColor: accent, boxShadow: `0 0 8px ${glow}` };
  }
  const glow = accent.replace(/[\d.]+\)$/, "0.4)");
  return {
    borderColor: accent,
    boxShadow: `0 0 12px ${glow}`,
  };
});

// Name accent highlight
const nameAccentStyle = computed(() => {
  if (!userProfile.value?.accentColor) return {};
  const accent = argbToRgba(userProfile.value.accentColor);
  if (isLightTheme.value) {
    // Darken the accent for readability on white
    const darkened = accent.replace(/rgba\((\d+), (\d+), (\d+)/, (_m, r, g, b) => {
      return `rgba(${Math.round(r * 0.7)}, ${Math.round(g * 0.7)}, ${Math.round(b * 0.7)}`;
    });
    return { color: darkened };
  }
  return { color: accent };
});

// Status text + class
const statusText = computed(() => {
  if (!user.value) return "";
  switch (user.value.status) {
    case UserStatus.Online: return t("status_online") || "Online";
    case UserStatus.Away: return t("status_away") || "Away";
    case UserStatus.DoNotDisturb: return t("status_dnd") || "Do Not Disturb";
    case UserStatus.TouchGrass: return t("status_touch_grass") || "Touch Grass";
    case UserStatus.Offline: return t("status_offline") || "Offline";
    default: return t("status_online") || "Online";
  }
});

const presenceClass = computed(() => {
  if (!user.value) return "";
  switch (user.value.status) {
    case UserStatus.Online: return "presence-online";
    case UserStatus.Away: return "presence-away";
    case UserStatus.DoNotDisturb: return "presence-dnd";
    case UserStatus.Offline: return "presence-offline";
    default: return "presence-online";
  }
});

// ── Props ──

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

onMounted(async () => {
  userProfile.value = await profileCache.getProfile(
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

  // Load all roles for this space (for add role picker)
  if (pool.selectedServer) {
    allSpaceRoles.value = await db.archetypes
      .where("spaceId")
      .equals(pool.selectedServer)
      .toArray();
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
});

async function addRole(archetypeId: Guid) {
  if (!pool.selectedServer) return;
  try {
    const memberIds = await pool.getMemberIdsByUserIds(pool.selectedServer, [props.userId]);
    if (!memberIds || memberIds.length === 0) return;
    await api.archetypeInteraction.SetArchetypeToMember(pool.selectedServer, memberIds[0], archetypeId, true);
    const role = allSpaceRoles.value.find(r => r.id === archetypeId);
    if (role) resolvedRoles.value.push(role);
    showRolePicker.value = false;
  } catch (e) {
    console.error("Failed to add role", e);
  }
}

async function removeRole(archetypeId: Guid) {
  if (!pool.selectedServer) return;
  try {
    const memberIds = await pool.getMemberIdsByUserIds(pool.selectedServer, [props.userId]);
    if (!memberIds || memberIds.length === 0) return;
    await api.archetypeInteraction.SetArchetypeToMember(pool.selectedServer, memberIds[0], archetypeId, false);
    resolvedRoles.value = resolvedRoles.value.filter(r => r.id !== archetypeId);
  } catch (e) {
    console.error("Failed to remove role", e);
  }
}
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

.popover-inner {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  transition: box-shadow 0.3s ease;
  background: hsl(var(--card));
}

/* ── Full-bleed background ── */
.card-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.card-bg-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-bg-default {
  background: linear-gradient(160deg, hsl(var(--muted) / 0.5) 0%, hsl(var(--card)) 100%);
}

.card-bg-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: overlay;
}

/* ── Hero spacer — reserves space for the visible background ── */
.hero-spacer {
  position: relative;
  height: 100px;
  z-index: 1;
}

/* ── Glass zone (frost + shine + body) ── */
.glass-zone {
  position: relative;
  z-index: 2;
}

/* Frosted glass transition band */
.glass-frost {
  height: 28px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  background: linear-gradient(
    to bottom,
    hsl(var(--card) / 0) 0%,
    hsl(var(--card) / 0.35) 40%,
    hsl(var(--card) / 0.7) 100%
  );
  mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 100%);
}

/* Shine/accent line at glass edge */
.glass-shine {
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.08), transparent);
}

/* Main glass body */
.glass-body {
  background: hsl(var(--card) / 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 0 16px 16px;
}

/* ── Profile header: overlapping avatar + name ── */
.profile-header {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  margin-bottom: 12px;
}

.avatar-anchor {
  flex-shrink: 0;
  margin-top: -44px;  /* overlap into background */
}

.hero-avatar {
  position: relative;
  border-radius: 50%;
  padding: 3px;
  border: 3px solid hsl(var(--card) / 0.9);
  background: hsl(var(--card) / 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 16px hsl(var(--background) / 0.4);
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  line-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-dot {
  position: absolute;
  bottom: 2px;
  right: 2px;
  width: 13px;
  height: 10px;
  border-radius: 9999px;
  border: 2px solid hsl(var(--card));
}

.hero-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding-bottom: 2px;
}

.hero-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.hero-display-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: hsl(var(--foreground));
  transition: color 0.3s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge-icon {
  width: 17px;
  height: 17px;
  vertical-align: middle;
  filter: drop-shadow(0 1px 2px hsl(var(--background) / 0.3));
}

.hero-username {
  font-size: 0.72rem;
  color: hsl(var(--foreground) / 0.5);
}

.hero-status {
  font-size: 0.75rem;
  line-height: 1.3;
}

.hero-activity {
  color: hsl(var(--foreground) / 0.8);
}

.hero-presence {
  font-weight: 600;
}
.presence-online { color: #4ade80; }
.presence-away { color: #fbbf24; }
.presence-dnd { color: #f87171; }
.presence-offline { color: #9ca3af; }

/* ── Content sections ── */

/* Staggered section animation */
.glass-body > :not(.profile-header) {
  animation: section-fade-in 0.3s ease both;
}
.glass-body > :nth-child(2) { animation-delay: 0.04s; }
.glass-body > :nth-child(3) { animation-delay: 0.08s; }
.glass-body > :nth-child(4) { animation-delay: 0.12s; }
.glass-body > :nth-child(5) { animation-delay: 0.16s; }
.glass-body > :nth-child(6) { animation-delay: 0.20s; }
.glass-body > :nth-child(7) { animation-delay: 0.24s; }

@keyframes section-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Custom status */
.custom-status {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
  font-size: 0.78rem;
  color: hsl(var(--foreground) / 0.65);
  font-style: italic;
}

.custom-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Section separator */
.section-sep {
  margin: 8px 0;
  opacity: 0.25;
}

/* Roles */
.roles-section {
  margin-bottom: 10px;
}

.section-label {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.9);
  background: hsl(var(--background) / 0.45);
  border: 1px solid hsl(var(--border) / 0.3);
}

.role-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.role-remove {
  margin-left: 2px;
  opacity: 0.5;
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1;
  transition: opacity 0.15s;
}
.role-remove:hover {
  opacity: 1;
  color: hsl(var(--destructive));
}

.role-add-btn {
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
  border-style: dashed;
}
.role-add-btn:hover {
  opacity: 1;
}

.role-picker {
  margin-top: 4px;
  background: hsl(var(--popover) / 0.85);
  backdrop-filter: blur(10px);
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 8px;
  max-height: 120px;
  overflow-y: auto;
}

.role-picker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 0.75rem;
  transition: background 0.1s;
}
.role-picker-item:hover {
  background: hsl(var(--accent) / 0.5);
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
  background: hsl(var(--background) / 0.3);
  padding: 8px 12px;
  border-radius: 10px;
  line-height: 1.45;
  border: 1px solid hsl(var(--border) / 0.15);
}

/* Loading skeleton */
.loading-skeleton {
  width: 100%;
  min-height: 18rem;
  overflow: hidden;
  border-radius: 16px;
  background: hsl(var(--card));
}

.skeleton-hero {
  height: 100px;
  background: hsl(var(--muted) / 0.3);
  animation: pulse 1.5s ease-in-out infinite;
}

.skeleton-content {
  padding: 16px;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: hsl(var(--muted) / 0.25);
  margin-bottom: 10px;
  animation: pulse 1.5s ease-in-out infinite;
}

.skeleton-line--name { width: 55%; height: 16px; }
.skeleton-line--tag { width: 30%; }
.skeleton-line--bio { width: 85%; animation-delay: 0.2s; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ── Light theme overrides ── */
:root:not(.dark) .popover-inner {
  box-shadow: 0 4px 24px hsl(var(--foreground) / 0.1), 0 0 0 1px hsl(var(--border));
}

:root:not(.dark) .card-bg-default {
  background: linear-gradient(160deg, hsl(var(--muted)) 0%, hsl(var(--border)) 100%);
}

:root:not(.dark) .glass-frost {
  display: none;
}

:root:not(.dark) .glass-shine {
  display: none;
}

:root:not(.dark) .glass-body {
  background: hsl(var(--card));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

:root:not(.dark) .hero-avatar {
  border-color: hsl(var(--card));
  box-shadow: 0 2px 10px hsl(var(--foreground) / 0.12);
}

:root:not(.dark) .role-chip {
  background: hsl(var(--muted));
  border-color: hsl(var(--border));
}

:root:not(.dark) .role-picker {
  background: hsl(var(--card));
  border-color: hsl(var(--border));
}

:root:not(.dark) .bio-block {
  background: hsl(var(--muted) / 0.5);
  border-color: hsl(var(--border) / 0.6);
}

:root:not(.dark) .loading-skeleton {
  box-shadow: 0 2px 16px hsl(var(--foreground) / 0.06);
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
