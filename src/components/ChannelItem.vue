<template>
  <div
    :data-channel-id="channel.channelId"
    :data-active="isActive || undefined"
    :data-connected="isConnectedVoiceChannel || undefined"
    :data-drop-position="isDragOver ? dropPosition : undefined"
    :data-member-drop="memberDrop"
    :data-locked="voiceLocked || undefined"
    :data-broadcast="isBroadcast || undefined"
    :data-live="isLive || undefined"
    class="channel-item"
  >
    <ContextMenu>
      <ContextMenuTrigger as="div">
        <div
          class="channel-row"
          :draggable="canManageChannels"
          @dragstart="emit('dragstart', channel, groupId, $event)"
          @dragover="emit('dragover', channel, groupId, index, $event)"
          @dragleave="emit('dragleave', channel, $event)"
          @drop="emit('drop', channel, groupId, index, $event)"
          @dragend="emit('dragend')"
        >
          <div
            class="channel-inner"
            :aria-disabled="voiceLocked || undefined"
            :title="voiceLocked ? t('voice_channel_locked') : undefined"
            @click="onClick"
            @auxclick="onAuxClick"
          >
            <div class="flex items-center space-x-2">
            <HashIcon v-if="channel.type === ChannelType.Text" class="w-5 h-5 text-muted-foreground flex-shrink-0 icon-appear" />
            <RadioTowerIcon v-else-if="isBroadcast" data-testid="broadcast-icon" class="icon-appear" :class="['w-5 h-5 flex-shrink-0', isConnectedVoiceChannel ? 'text-green-400' : 'text-muted-foreground']" :title="t('broadcast_channel')" />
            <Volume2Icon class="icon-appear" v-else-if="isVoice" :class="['w-5 h-5 flex-shrink-0', isConnectedVoiceChannel ? 'text-green-400' : 'text-muted-foreground']" />
            <AntennaIcon v-else-if="channel.type === ChannelType.Announcement" :class="['w-5 h-5 flex-shrink-0', announcementUnread ? 'announcement-accent' : 'text-muted-foreground']" />
            <span :class="['text-muted-foreground font-medium truncate', channelUnread && 'text-foreground font-semibold', announcementUnread && 'announcement-accent']" :title="voiceLocked ? t('voice_channel_locked') : channel?.name">{{ channel?.name }}</span>
            <!-- A target: this channel hears the radio of the broadcast channel(s) that list it. -->
            <RadioIcon
              v-if="hearsRadioOf.length > 0"
              data-testid="radio-target"
              class="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/60"
              :title="t('broadcast_hears_radio_of', { name: hearsRadioOf.map((c) => c.name).join(', ') })"
            />
            <span v-if="isLive" data-testid="live-pill" class="live-pill flex-shrink-0">{{ t('broadcast_live') }}</span>
            <LockIcon v-if="voiceLocked" data-testid="voice-lock" class="w-3.5 h-3.5 ml-auto flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <span v-if="channelMentions > 0" class="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex-shrink-0">
              {{ channelMentions }}
            </span>
            <span v-else-if="announcementUnread" data-testid="announcement-new" class="ml-auto new-pill flex-shrink-0">{{ t('announcement_new') }}</span>
            <span v-else-if="channelUnread" class="ml-auto w-2 h-2 rounded-full unread-dot flex-shrink-0" />
            <span v-if="isConnectedVoiceChannel" class="text-xs text-green-400 ml-auto">●</span>
            <button
              v-if="canButton && !voiceLocked"
              class="split-btn ml-auto icon-motion icon-motion--pop"
              @click.stop="emit('open-split', channel.channelId)"
              title="Open in split"
            >
              <IconColumns class="w-3.5 h-3.5" />
            </button>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-56">
        <GatedMenuItem
          v-if="isVoice"
          :gate="connectGate"
          :disabled="isConnectedVoiceChannel"
          :reason="t('voice_channel_locked')"
          data-action="join-voice"
          @click="emit('switch-voice', channel.channelId)"
        >
          <Volume2Icon class="w-4 h-4 mr-2" />
          {{ t("join_channel") }}
        </GatedMenuItem>
        <!-- Sits next to Join, because it is the same act performed for somebody else: the server
             mints a room link only for a caller who could walk in themselves. -->
        <GatedMenuItem
          v-if="isVoice"
          :gate="connectGate"
          :disabled="creatingVoiceInvite"
          :reason="t('voice_channel_locked')"
          data-action="voice-invite"
          @click="copyVoiceInvite"
        >
          <Loader2 v-if="creatingVoiceInvite" class="w-4 h-4 mr-2 animate-spin" />
          <LinkIcon v-else class="w-4 h-4 mr-2" />
          {{ t("invite_to_voice") }}
        </GatedMenuItem>
        <ContextMenuItem v-if="splitEnabled" @click="emit('open-split', channel.channelId)">
          <IconColumns class="w-4 h-4 mr-2" />
          {{ t("open_in_split") }}
        </ContextMenuItem>
        <ContextMenuItem @click="toggleMute">
          <BellIcon v-if="channelMutedItself" class="w-4 h-4 mr-2" />
          <BellOffIcon v-else class="w-4 h-4 mr-2" />
          {{ channelMutedItself ? t("unmute_channel") : t("mute_channel") }}
        </ContextMenuItem>

        <template v-if="manageGate !== 'hidden'">
          <ContextMenuSeparator />
          <GatedMenuItem :gate="manageGate" data-action="edit-channel" @click="windows.openChannelSettings(channel.spaceId, channel.channelId)">
            <SettingsIcon class="w-4 h-4 mr-2" />
            {{ t("edit_channel") }}
          </GatedMenuItem>
          <GatedMenuItem :gate="manageGate" :disabled="duplicating" data-action="duplicate-channel" @click="duplicateChannel">
            <CopyPlusIcon class="w-4 h-4 mr-2" />
            {{ t("duplicate_channel") }}
          </GatedMenuItem>
        </template>

        <ContextMenuSeparator />
        <ContextMenuItem @click="copyChannelId">
          <CopyIcon class="w-4 h-4 mr-2" />
          {{ t("copy_channel_id") }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <!-- Voice channel users -->
    <TransitionGroup
      v-if="isVoice && voiceUsers && voiceUsers.Users.size > 0"
      tag="ul"
      name="voice-user"
      class="voice-user-list"
    >
      <li
        v-for="user in voiceUsers.Users.values()"
        :key="user.userId"
        :draggable="canDragMember(user.userId)"
        :data-movable="moveGate === 'allowed' || undefined"
        @dragstart="onMemberDragStart(user.userId, $event)"
        @dragend="emit('dragend')"
      >
        <ContextMenu>
          <ContextMenuTrigger :disabled="!hasMemberMenu(user.userId)">
            <VoiceChannelUser :user="user" :channel-id="channel.channelId" :connecting="isUserConnecting(user.userId)" />
          </ContextMenuTrigger>
          <ContextMenuContent class="w-64">
            <ContextMenuLabel v-if="showsVolume(user.userId)">
              <VolumeSlider :user="user"/>
            </ContextMenuLabel>

            <template v-if="!isGuest(user.userId)">
              <ContextMenuSub v-if="moveGate === 'allowed'">
                <ContextMenuSubTrigger inset data-action="move-to">
                  {{ t("voice_move_to") }}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent class="w-56">
                  <GatedMenuItem
                    v-for="target in moveTargets"
                    :key="target.channelId"
                    :gate="moveTargetGate(target)"
                    :data-move-target="target.channelId"
                    @select="moveMember(user.userId, target.channelId)"
                  >
                    <Volume2Icon class="w-4 h-4 mr-2" />
                    <span class="truncate">{{ target.name }}</span>
                  </GatedMenuItem>
                  <ContextMenuItem v-if="moveTargets.length === 0" disabled>
                    {{ t("voice_move_no_targets") }}
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <GatedMenuItem v-else-if="moveGate === 'denied'" gate="denied" inset data-action="move-to">
                {{ t("voice_move_to") }}
              </GatedMenuItem>
              <GatedMenuItem
                :gate="muteGate"
                inset
                data-action="server-mute"
                @select="toggleServerMute(user)"
              >
                {{ t("voice_server_mute") }}
                <CheckIcon v-if="serverFlags(user).serverMuted" class="w-4 h-4 ml-auto" />
              </GatedMenuItem>
              <GatedMenuItem
                :gate="deafenGate"
                inset
                data-action="server-deafen"
                @select="toggleServerDeafen(user)"
              >
                {{ t("voice_server_deafen") }}
                <CheckIcon v-if="serverFlags(user).serverDeafened" class="w-4 h-4 ml-auto" />
              </GatedMenuItem>
            </template>

            <GatedMenuItem
              :gate="kickGate"
              inset
              data-action="kick"
              @click="emit('kick-member', user.userId, channel.channelId, channel.spaceId)"
            >
              {{ t("kick") }}
              <ContextMenuShortcut v-if="kickGate === 'allowed'">⌘]</ContextMenuShortcut>
            </GatedMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </li>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { computed, ref as vueRef, TransitionGroup } from 'vue';
import {
  HashIcon, Volume2Icon, AntennaIcon, BellIcon, BellOffIcon, SettingsIcon, CopyIcon, CopyPlusIcon,
  LinkIcon, Loader2, CheckIcon, LockIcon, RadioIcon, RadioTowerIcon,
} from 'lucide-vue-next';
import { IconColumns } from '@tabler/icons-vue';
import { canButton, canCtrlClick, splitEnabled } from '@/composables/useSplitView';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@argon/ui/context-menu';
import { useToast } from '@argon/ui/toast';
import { logger } from '@argon/core';
import { ChannelType, MuteLevelType, MuteTargetKind, VoiceInviteError } from '@argon/glue';
import { enumName } from '@/lib/telemetry/metrics';
import { useApi } from '@/store/system/apiStore';
import { usePexStore, type PermissionGate } from '@/store/data/permissionStore';
import type { ArgonEntitlementFlag } from '@/lib/rbac/ArgonEntitlement';
import { useLocale } from '@/store/system/localeStore';
import { useMe } from '@/store/auth/meStore';
import { useUnifiedCall } from '@/store/media/unifiedCallStore';
import { useNotificationStore } from '@/store/data/notificationStore';
import { useSpaceStore } from '@/store/data/serverStore';
import { useWindow } from '@/store/ui/windowStore';
import VoiceChannelUser from './channels/VoiceChannelUser.vue';
import VolumeSlider from './audio/VolumeSlider.vue';
import GatedMenuItem from './shared/GatedMenuItem.vue';
import { isVoiceLikeChannel } from '@/lib/voice/channels';
import { isAnnouncementUnread } from '@/lib/announcements/spaceAnnouncements';
import { useVoiceModeration } from '@/composables/useVoiceModeration';
import { decodeVoiceState } from '@argon/calls/voice-state';
import type { DropPosition, MemberDropState } from '@/composables/useChannelDragDrop';
import type { Guid } from '@argon-chat/ion.webcore';
import type { ArgonChannel } from '@argon/glue';
import type { IRealtimeChannel, IRealtimeChannelUser } from '@/store/realtime/realtimeStore';

const props = defineProps<{
  channel: ArgonChannel;
  groupId: Guid | null;
  index: number;
  isActive: boolean;
  isDragOver: boolean;
  dropPosition?: DropPosition;
  voiceUsers?: IRealtimeChannel;
  /** The space's voice channels, for the "Move to" menu. */
  voiceChannels?: ArgonChannel[];
  /** While a member is dragged: whether this row takes the drop, and whether it is under the cursor. */
  memberDrop?: MemberDropState;
}>();

const emit = defineEmits<{
  select: [channelId: string];
  'open-split': [channelId: string];
  'switch-voice': [channelId: string];
  dragstart: [channel: ArgonChannel, groupId: Guid | null, event: DragEvent];
  dragover: [channel: ArgonChannel, groupId: Guid | null, index: number, event: DragEvent];
  dragleave: [channel: ArgonChannel, event: DragEvent];
  drop: [channel: ArgonChannel, groupId: Guid | null, index: number, event: DragEvent];
  dragend: [];
  'member-dragstart': [userId: string, channel: ArgonChannel, event: DragEvent];
  'kick-member': [userId: string, channelId: string, spaceId: string];
}>();

// Left-click selects; Ctrl/Cmd-click or middle-click opens in split (when enabled).
// A voice channel the user may not connect to does nothing: the row already says why.
function onClick(e: MouseEvent) {
  if (voiceLocked.value) return;
  if (canCtrlClick.value && (e.ctrlKey || e.metaKey)) {
    emit('open-split', props.channel.channelId);
    return;
  }
  emit('select', props.channel.channelId);
}
function onAuxClick(e: MouseEvent) {
  if (voiceLocked.value) return;
  if (canCtrlClick.value && e.button === 1) {
    e.preventDefault();
    emit('open-split', props.channel.channelId);
  }
}

const pex = usePexStore();
const api = useApi();
const { t } = useLocale();
const me = useMe();
const voice = useUnifiedCall();
const ntf = useNotificationStore();
const servers = useSpaceStore();
const windows = useWindow();
const { toast } = useToast();

const channelUnread = computed(() => {
  const mute = ntf.effectiveMuteLevel(props.channel.channelId, props.channel.spaceId);
  if (mute === MuteLevelType.All) return false;
  if (mute === MuteLevelType.OnlyMentions) return false;
  return ntf.isChannelUnread(props.channel.channelId, props.channel.lastMessageId);
});

// An unread announcement channel gets the accent name and a NEW pill instead of the plain dot.
const announcementUnread = computed(() => isAnnouncementUnread(props.channel, ntf));

const channelMentions = computed(() => {
  const mute = ntf.effectiveMuteLevel(props.channel.channelId, props.channel.spaceId);
  if (mute === MuteLevelType.All) return 0;
  return ntf.channelMentionCount(props.channel.channelId);
});

const channelMuted = computed(() => ntf.isTargetMuted(props.channel.channelId) || ntf.isTargetMuted(props.channel.spaceId));

// Everything here is decided per channel: an overwrite can take a right away in one channel only.
const gateOf = (flag: ArgonEntitlementFlag) => pex.gate(props.channel.channelId, flag, props.channel.spaceId);

const manageGate = computed(() => gateOf('ManageChannels'));
const canManageChannels = computed(() => manageGate.value === 'allowed');
const isVoice = computed(() => isVoiceLikeChannel(props.channel.type));
const isConnectedVoiceChannel = computed(() =>
  isVoice.value &&
  voice.connectedVoiceChannelId === props.channel.channelId
);

// ── Broadcast (radio) ──

const isBroadcast = computed(() => isVoice.value && props.channel.broadcast != null);

// The broadcast channels whose target list names this one, from the same list the "Move to"
// menu reads — the sidebar already has every voice channel of the space.
const hearsRadioOf = computed(() =>
  (props.voiceChannels ?? []).filter(
    (c) => c.channelId !== props.channel.channelId && (c.broadcast?.targets.includes(props.channel.channelId) ?? false),
  ),
);

// LIVE on HQ only (decision 14): while a radio from it is audible in my room, or — when I am in
// HQ myself — while I or another member is on air.
const isLive = computed(() => {
  if (!isBroadcast.value) return false;
  const radio = voice.radio;
  if (radio.onAir.some((s) => s.hqChannelId === props.channel.channelId)) return true;
  return isConnectedVoiceChannel.value && (radio.transmitting || radio.busyBy !== null);
});

const canConnect = computed(() => pex.hasIn(props.channel.channelId, 'Connect', props.channel.spaceId));
// Join is never hidden on a voice channel: not being allowed in is exactly what the user needs to see.
const connectGate = computed<PermissionGate>(() => (canConnect.value ? 'allowed' : 'denied'));
const voiceLocked = computed(() => isVoice.value && !canConnect.value && !isConnectedVoiceChannel.value);

// A user shows in the presence list as soon as they join, but their actual voice
// (LiveKit media) connects a moment later. Show a "connecting" indicator during that
// gap. We can only tell for the channel we're connected to (that's where we have
// LiveKit data): self is connecting until the room reports connected; a peer is
// connecting until their participant appears in the room.
const isUserConnecting = (userId: string) => {
  if (voice.connectedVoiceChannelId !== props.channel.channelId) return false;
  if (userId === me.me?.userId) return !voice.isConnected;
  if (!voice.isConnected) return true;
  return !voice.participants[userId];
};

// ── Voice member menu and drag ──

const moderation = useVoiceModeration();

// Move and kick act in the member's channel, so the server checks them there.
const moveGate = computed(() => gateOf('MoveMember'));
const kickGate = computed(() => gateOf('KickMember'));
// Server mute and deafen restrict the member across the whole space, so the server checks them space-wide.
const spaceGateOf = (flag: ArgonEntitlementFlag): PermissionGate =>
  pex.hasInSpace(props.channel.spaceId, flag) ? 'allowed' : 'hidden';
const muteGate = computed(() => spaceGateOf('MuteMember'));
const deafenGate = computed(() => spaceGateOf('DeafenMember'));

// Guests exist only in the LiveKit room, not in the space: nothing to moderate server-side.
const isGuest = (userId: string) => {
  const id = userId.toLowerCase();
  return id.startsWith('ccccfcfa') || id.startsWith('guest-');
};

const canModerateMember = (userId: string) =>
  !isGuest(userId) && [moveGate.value, muteGate.value, deafenGate.value].some((g) => g !== 'hidden');

// Per-user volume only means something for the room we are hearing.
const showsVolume = (userId: string) => isConnectedVoiceChannel.value && userId !== me.me?.userId;

const hasMemberMenu = (userId: string) =>
  showsVolume(userId) || canModerateMember(userId) || kickGate.value !== 'hidden';

// Anyone may pick a member up: dropped on a text channel it becomes a mention there.
const canDragMember = (userId: string) => !isGuest(userId);

const moveTargets = computed(() =>
  (props.voiceChannels ?? []).filter(
    (c) => c.channelId !== props.channel.channelId && isVoiceLikeChannel(c.type),
  ),
);

// The server also wants MoveMember on the target. Whether the member may join it is theirs to know.
const moveTargetGate = (target: ArgonChannel): PermissionGate =>
  pex.hasIn(target.channelId, 'MoveMember', target.spaceId) ? 'allowed' : 'denied';

const serverFlags = (user: IRealtimeChannelUser) => decodeVoiceState(user.state);

function onMemberDragStart(userId: string, event: DragEvent) {
  if (!canDragMember(userId)) return;
  emit('member-dragstart', userId, props.channel, event);
}

function moveMember(userId: string, targetChannelId: string) {
  void moderation.moveMember(props.channel.spaceId, props.channel.channelId, userId, targetChannelId);
}

function toggleServerMute(user: IRealtimeChannelUser) {
  void moderation.setServerMuted(props.channel.spaceId, user.userId, !serverFlags(user).serverMuted);
}

function toggleServerDeafen(user: IRealtimeChannelUser) {
  void moderation.setServerDeafened(props.channel.spaceId, user.userId, !serverFlags(user).serverDeafened);
}

// ── Context menu actions ──

// This channel's own mute, not the space's: the menu item toggles this channel only.
const channelMutedItself = computed(() => ntf.isTargetMuted(props.channel.channelId));

function toggleMute() {
  if (channelMutedItself.value) {
    void ntf.unmuteTarget(props.channel.channelId);
  } else {
    void ntf.muteTarget(props.channel.channelId, MuteTargetKind.Channel, MuteLevelType.All, false, null);
  }
}

const duplicating = vueRef(false);

async function duplicateChannel() {
  if (duplicating.value || !canManageChannels.value) return;
  duplicating.value = true;
  try {
    const copy = await servers.duplicateChannel(props.channel.spaceId, props.channel.channelId);
    if (copy) toast({ title: t('channel_duplicated') });
    else toast({ title: t('channel_duplicate_failed'), variant: 'destructive' });
  } finally {
    duplicating.value = false;
  }
}

// A day, and no cap on how many people walk through. A room link is shared to get a conversation
// started now — an eternal one would keep letting strangers in long after that conversation ended,
// and a used-once one breaks the moment somebody forwards it to the person who was actually meant
// to come. Permanent links with limits are what the space's invite settings are for.
const VOICE_INVITE_MINUTES = 24 * 60;
const VOICE_INVITE_MAX_USES = 0;

const creatingVoiceInvite = vueRef(false);

/**
 * Mints a link to this room and puts it on the clipboard.
 *
 * The URL comes from the server rather than being composed here: the invite domain is deployment
 * configuration (Invites:VoiceDomain), and a self-hosted instance whose links all pointed at
 * argon.gl would be handing out invitations to somebody else's server.
 */
async function copyVoiceInvite() {
  if (creatingVoiceInvite.value || !canConnect.value) return;
  creatingVoiceInvite.value = true;
  try {
    const result = await api.channelInteraction.CreateVoiceInviteCode(
      props.channel.spaceId, props.channel.channelId, VOICE_INVITE_MINUTES, VOICE_INVITE_MAX_USES);

    if (!result?.isSuccessCreateVoiceInvite()) {
      const error = result?.isFailedCreateVoiceInvite() ? enumName(VoiceInviteError, result.error) : 'unknown';
      logger.warn('[channel] voice invite refused', error);
      toast({ title: t('voice_invite_failed'), variant: 'destructive' });
      return;
    }

    await navigator.clipboard.writeText(result.url);
    toast({ title: t('voice_invite_copied'), description: result.url });
  } catch (e) {
    logger.error('[channel] failed to create voice invite', e);
    toast({ title: t('voice_invite_failed'), variant: 'destructive' });
  } finally {
    creatingVoiceInvite.value = false;
  }
}

async function copyChannelId() {
  try {
    await navigator.clipboard.writeText(props.channel.channelId);
    toast({ title: t('channel_id_copied') });
  } catch (e) {
    logger.warn('[channel] clipboard write failed', e);
  }
}
</script>

<style scoped>
.channel-item {
  position: relative;
  margin-bottom: 1px;
}

.channel-inner {
  padding: 6px 8px;
  margin: 0 8px;
  border-radius: calc(var(--radius) - 4px);
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.channel-inner:hover {
  background-color: hsl(var(--foreground) / 0.06);
}

/* A voice channel the user may not connect to: visible, plainly not enterable. */
.channel-item[data-locked] .channel-inner {
  cursor: not-allowed;
  opacity: 0.55;
}

.channel-item[data-locked] .channel-inner:hover {
  background-color: transparent;
}

/* "Open in split" button — revealed on row hover. */
.split-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 2px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
}
.channel-inner:hover .split-btn {
  opacity: 0.65;
}
.split-btn:hover {
  opacity: 1;
  color: hsl(var(--foreground));
  background: hsl(var(--foreground) / 0.1);
}

.channel-item[data-active] .channel-inner {
  background-color: hsl(var(--primary) / 0.1);
  color: hsl(var(--foreground));
}

.channel-item[data-connected] .channel-inner {
  background-color: hsl(142 71% 45% / 0.08);
  border-left: 2px solid hsl(142 71% 45%);
}

/* Somebody is on the radio of this broadcast channel. */
.live-pill {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.06em;
  color: hsl(0 84% 60%);
  background-color: hsl(0 84% 60% / 0.14);
  border: 1px solid hsl(0 84% 60% / 0.35);
}

/* Unread announcement channel: accent name and icon, NEW pill in place of the dot. */
.announcement-accent {
  color: hsl(var(--primary));
}

.new-pill {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.06em;
  color: hsl(var(--primary-foreground));
  background-color: hsl(var(--primary));
}

/* Drop indicators */
.channel-item[data-drop-position]::before,
.channel-item[data-drop-position]::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: hsl(var(--primary));
  border-radius: 1px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 100ms ease;
}

.channel-item[data-drop-position]::before {
  top: 0;
}

.channel-item[data-drop-position]::after {
  bottom: 0;
}

.channel-item[data-drop-position="before"]::before {
  opacity: 1;
}

.channel-item[data-drop-position="after"]::after {
  opacity: 1;
}

.channel-row[draggable="true"] {
  cursor: grab;
}

/* A voice member is being dragged: rows that take the drop are outlined, the one under the
   cursor is filled. */
.channel-item[data-member-drop] .channel-inner {
  box-shadow: inset 0 0 0 1px hsl(var(--primary) / 0.35);
  transition: background-color 120ms ease, box-shadow 120ms ease;
}

.channel-item[data-member-drop="over"] .channel-inner {
  background-color: hsl(var(--primary) / 0.16);
  box-shadow: inset 0 0 0 2px hsl(var(--primary) / 0.8);
}

.voice-user-list li[data-movable] {
  cursor: grab;
}

.voice-user-list li[data-movable]:active {
  cursor: grabbing;
}

.channel-row[draggable="true"]:active {
  opacity: 0.5;
  cursor: grabbing;
}

/* Voice user list */
.voice-user-list {
  margin-left: 12px;
  padding: 4px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
}

/* Voice user enter/leave transitions */
.voice-user-enter-active {
  transition: all 200ms ease-out;
}

.voice-user-leave-active {
  transition: all 150ms ease-in;
}

.voice-user-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.voice-user-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.voice-user-move {
  transition: transform 200ms ease;
}
</style>
