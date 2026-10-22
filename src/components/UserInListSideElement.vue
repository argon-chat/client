<template>
  <ContextMenu @update:open="onContextMenuOpen">
  <ContextMenuTrigger as="div" :disabled="!props.enablePopup" class="w-full">
  <Popover v-if="props.enablePopup" v-model:open="isOpened">
    <!-- Not clipped: a worn frame draws deliberately outside the card, and the card rounds itself. -->
    <PopoverContent style="width: 24rem;" :collision-padding="popoverRoom"
      class="profile-popover p-0 rounded-2xl shadow-xl border overflow-visible">
      <UserProfilePopover :user-id="user.userId" @close:pressed="isOpened = false" @report="onReportProfile" />
    </PopoverContent>
    <PopoverTrigger as-child>
      <div class="user-element" :class="{ 'is-offline': isOffline }" v-on="rowEvents">
        <div class="user-avatar-wrap">
          <ArgonAvatar :fallback="user.displayName"
            :file-id="user.avatarFileId"
            :user-id="user.userId"
            :overridedSize="34" :profile="worn" />
          <StatusDot :status="user.status" class="status-dot" />
        </div>
        <div class="user-text">
          <span class="user-name-row">
            <CosmeticNickname class="user-name" surface="memberListRow" :profile="worn">{{ user.displayName }}</CosmeticNickname>
            <BotTag :flags="user.flags" />
          </span>
          <span class="user-activity" v-if="user.activity && props.showActivity">
            <component :is="getActivityIcon(user.activity.kind)" class="activity-icon" :class="getActivityColor(user.activity.kind)" />
            <span class="font-semibold">{{ user.activity.titleName }}</span>
          </span>
          <span class="user-status-text" v-else-if="props.showActivity && status" data-testid="member-custom-status">
            <StatusEmoji :profile="status" :size="14" :hovered="rowActive" />
            <span v-if="status.customStatus" class="user-status-label">{{ status.customStatus }}</span>
          </span>
        </div>
      </div>
    </PopoverTrigger>
  </Popover>

  <div v-else class="user-element" :class="{ 'is-offline': isOffline }" v-on="rowEvents">
    <div class="user-avatar-wrap">
      <ArgonAvatar :fallback="user.displayName"
        :file-id="user.avatarFileId"
        :user-id="user.userId"
        :overridedSize="34" :profile="worn" />
      <StatusDot :status="user.status" class="status-dot" />
    </div>
    <div class="user-text">
      <span class="user-name-row">
        <CosmeticNickname class="user-name" surface="memberListRow" :profile="worn">{{ user.displayName }}</CosmeticNickname>
        <BotTag :flags="user.flags" />
      </span>
      <span class="user-activity" v-if="user.activity && props.showActivity">
        <component :is="getActivityIcon(user.activity.kind)" class="activity-icon" :class="getActivityColor(user.activity.kind)" />
        <span class="font-semibold">{{ user.activity.titleName }}</span>
      </span>
      <span class="user-status-text" v-else-if="props.showActivity && status" data-testid="member-custom-status">
        <StatusEmoji :profile="status" :size="14" :hovered="rowActive" />
        <span v-if="status.customStatus" class="user-status-label">{{ status.customStatus }}</span>
      </span>
    </div>
  </div>

  </ContextMenuTrigger>
  <ContextMenuContent v-if="props.enablePopup" class="w-64">
    <ContextMenuItem @select="isOpened = true">
      <UserRound class="w-4 h-4 mr-2" />{{ t('profile') }}
    </ContextMenuItem>
    <ContextMenuItem v-if="!isSelf && !isBot" @select="openDirectChat">
      <MessageSquare class="w-4 h-4 mr-2" />{{ t('send_message') }}
    </ContextMenuItem>
    <template v-if="voiceMember && !isSelf">
      <ContextMenuSeparator />
      <ContextMenuLabel><VolumeSlider :user="voiceMember" /></ContextMenuLabel>
    </template>
    <template v-if="!isSelf && !isBot">
      <ContextMenuSeparator />
      <ContextMenuItem @select="toggleBlock">
        <Ban class="w-4 h-4 mr-2" />{{ friends.isBlocked(user.userId) ? t('unblock_user') : t('block_user') }}
      </ContextMenuItem>
    </template>
    <ContextMenuItem v-if="!isSelf" @select="onReportProfile(user.userId)">
      <Flag class="w-4 h-4 mr-2" />{{ t('report_user_profile') }}
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem @select="copyUserId">
      <Copy class="w-4 h-4 mr-2" />{{ t('copy_user_id') }}
    </ContextMenuItem>
  </ContextMenuContent>
  </ContextMenu>
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
import BotTag from "@/components/shared/BotTag.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@argon/ui/popover";
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import ReportDialog from "./modals/ReportDialog.vue";
import { ref, computed } from "vue";
import { ActivityPresenceKind, ReportTargetKind, UserStatus, UserFlag } from "@argon/glue";
import { Gamepad2, Headphones, Monitor, Radio, UserRound, MessageSquare, Ban, Flag, Copy } from "lucide-vue-next";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuLabel } from '@argon/ui/context-menu';
import { useRouter } from 'vue-router';
import { useFriendsStore } from '@/store/data/friendsStore';
import { useUnifiedCall } from '@/store/media/unifiedCallStore';
import VolumeSlider from './audio/VolumeSlider.vue';
import { useToast } from '@argon/ui/toast';
import { logger } from '@argon/core';
import { usePoolStore } from "@/store/data/poolStore";
import StatusEmoji from "@/components/expressions/StatusEmoji.vue";
import { hasCustomStatus } from "@/lib/statusIcon";
import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
import { useCosmeticOverhang } from "@/composables/useCosmeticFit";
import { useCosmeticsDrawnOn } from "@/composables/useCosmeticsDrawnOn";
import { useProfileStatus } from "@/composables/useProfileStatus";
import { useWornProfile } from "@/composables/useWornProfile";

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
const router = useRouter();
const friends = useFriendsStore();
const voice = useUnifiedCall();
const { toast } = useToast();
const isSelf = computed(() => me.me?.userId === props.user.userId);
const isBot = computed(() => ((props.user.flags ?? 0) & (UserFlag.BOT | UserFlag.SYSTEM)) !== 0);
const voiceMember = computed(() => {
  const channelId = voice.connectedVoiceChannelId;
  return channelId ? pool.realtimeChannelUsers.get(channelId)?.Users.get(props.user.userId) : undefined;
});

function onContextMenuOpen(open: boolean) {
  if (!open) return;
  isOpened.value = false;
  if (!isSelf.value && !isBot.value) void friends.ensureLoaded();
}

function openDirectChat() {
  void router.push({ name: 'HomeChat', params: { userId: props.user.userId } });
}

async function toggleBlock() {
  try {
    if (friends.isBlocked(props.user.userId)) await friends.unblock(props.user.userId);
    else await friends.block(props.user.userId);
  } catch (error) {
    actionFailed(error);
  }
}

async function copyUserId() {
  try {
    await navigator.clipboard.writeText(props.user.userId);
  } catch (error) {
    actionFailed(error);
  }
}

function actionFailed(error: unknown) {
  logger.warn('Member context menu action failed', error);
  toast({ title: t('error'), description: t('unexpected_error'), variant: 'destructive' });
}

// Dim offline members (status dot already shows it; dim the whole row too).
const isOffline = computed(() => props.user.status === UserStatus.Offline);

// The status emoji plays only while the row is hovered or focused, not in every visible row.
const hovered = ref(false);
const focused = ref(false);
const rowActive = computed(() => hovered.value || focused.value);
const rowEvents = {
  mouseenter: () => (hovered.value = true),
  mouseleave: () => (hovered.value = false),
  focusin: () => (focused.value = true),
  focusout: () => (focused.value = false),
};
// A custom status is only ever rendered when the row is showing activity at all and the member has
// no activity to show instead. The member list is virtualised, so every row used to ask for a full
// profile on mount — including the rows that had nowhere to put the answer (the role editor renders
// them with show-activity off) and the ones the user scrolled straight past.
const wantsStatus = computed(() => props.showActivity && !props.user.activity);

// What a member wears rides the same row, so a member with an activity is asked too — but only in
// the member list, and only while the catalogue has anything on for a row to draw — or for the card
// it opens, whose frame keeps that card clear of the window through this same row.
const cosmeticsDrawn = useCosmeticsDrawnOn(["memberListRow", "avatar", "profileCard"]);
const wantsCosmetics = computed(() => props.showActivity && cosmeticsDrawn.value);

// Scrolling a row out of view drops its request before it reaches the wire.
const row = useProfileStatus(
  () => pool.selectedServer,
  () => props.user.userId,
  () => !!pool.selectedServer && (wantsStatus.value || wantsCosmetics.value),
);

/** Set only when there is something to show: text, an icon, or both. */
const status = computed(() => {
  if (!wantsStatus.value || !hasCustomStatus(row.value)) {
    return null;
  }

  return row.value;
});

const heldWorn = computed(() => {
  if (!wantsCosmetics.value) {
    return null;
  }

  return row.value;
});

const worn = useWornProfile(() => props.user.userId, heldWorn);

/**
 * How far this person's frame hangs outside their card, kept as room between the card and the window.
 *
 * A popover is placed by measuring its own box, and a frame draws outside that box on purpose — so a
 * card opened from this list, which lives against the right edge, had its right-hand side cut off by
 * the window. Zero for anyone wearing nothing, and the card sits where it always did.
 */
const popoverRoom = useCosmeticOverhang(worn);

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
  transition: opacity 0.15s ease;
}

/* Offline members are dimmed (Discord-like); brighten on hover. */
.user-element.is-offline {
  opacity: 0.4;
}
.user-element.is-offline:hover {
  opacity: 0.85;
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

.user-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.user-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap;

  /* Clip, not hidden: a worn glow may then spill past the box by the room the name style leaves it.
     Clip is no scroll container, which is what let the name shrink before; hence the min-width. */
  overflow: clip;
  min-width: 0;
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
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 0.7rem;
  color: hsl(var(--muted-foreground));
  font-style: italic;
}

.user-status-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
