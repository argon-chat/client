import { defineStore } from "pinia";
import { ref, computed, shallowRef, triggerRef, watch } from "vue";
import { logger } from "@argon/core";
import { native } from "@argon/glue/native";
import { renderOverlayBadge } from "@/lib/taskbarBadge";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useMe } from "@/store/auth/meStore";
import { useChannelStore } from "@/store/data/channelStore";
import { useFriendsStore } from "@/store/data/friendsStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useRecentChatsStore } from "@/store/chat/useRecentChatsStore";
import { useTone } from "@/store/media/toneStore";
import { useLocale } from "@/store/system/localeStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { db } from "@/store/db/dexie";
import { toast } from "@argon/ui/toast";
import {
  type ArgonMessage,
  type ChannelReadState,
  type MuteSettingsDto,
  type SpaceBadge,
  type NotificationBadges,
  type SystemNotificationDto,
  type MessageEntityMention,
  type MessageEntityMentionRole,
  EntityType,
  MuteLevelType,
  MuteTargetKind,
  type ReadStateUpdated,
  type SystemNotificationReceived,
  type MuteSettingsChanged,
  type DirectMessageSent,
  type MessageSent,
  type ChannelMarkRetracted,
  type FriendRequestReceivedEvent,
  type FriendRequestCanceledEvent,
} from "@argon/glue";
import type { Guid, IonDateTime } from "@argon-chat/ion.webcore";

const NOTIFICATION_TYPES: Record<string, keyof NotificationBadges> = {
  friend_request_received: "friendRequests",
  item_received: "inventory",
  system_announcement: "system",
};

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Unread state, one rule everywhere: a channel is unread while its newest message id is above the
 * user's read cursor. The channel list, the space icon, the titlebar and the taskbar all read it
 * through {@link channelBadge}, so they cannot disagree.
 *
 * The cursor comes from the server (GetGlobalBadges, ReadStateUpdated) and moves locally when the
 * user reads, sends, or has the channel open at its newest message. The newest id per channel is
 * mirrored in memory from the channels table and moved by MessageSent and ChannelMarkRetracted.
 */
export const useNotificationStore = defineStore("notifications", () => {
  const api = useApi();
  const bus = useBus();
  const me = useMe();
  const channelStore = useChannelStore();
  const recentChats = useRecentChatsStore();
  const tone = useTone();

  // ── State ──────────────────────────────────────────────

  const readStates = shallowRef(new Map<Guid, ChannelReadState>());
  const muteSettings = shallowRef(new Map<Guid, MuteSettingsDto>());
  const spaceBadges = shallowRef(new Map<Guid, SpaceBadge>());
  const serverDmCount = ref(0);
  const notifications = ref<NotificationBadges>({ friendRequests: 0, inventory: 0, system: 0 });
  const notificationFeed = shallowRef<SystemNotificationDto[]>([]);
  const MAX_NOTIFICATION_FEED = 200;
  const feedHasMore = ref(true);
  const initialized = ref(false);

  /** Each visible channel's newest message id and space. */
  const channels = new Map<Guid, { spaceId: Guid; lastMessageId: bigint }>();
  const spaceChannels = new Map<Guid, Set<Guid>>();

  /** The newest id the server has been told each channel is read up to. */
  const acked = new Map<Guid, bigint>();

  /** The channel on screen with its newest message in view: what arrives there is read on arrival. */
  let viewing: { channelId: Guid; spaceId: Guid | null } | null = null;

  // ACK debounce
  const pendingAck = new Map<Guid, bigint>();
  let ackTimer: ReturnType<typeof setTimeout> | null = null;

  // Seamless account switch: flush any pending read-acks for the OLD account, then clear all badges
  // and counters. initFromGlobalBadges() repopulates for the incoming account.
  onSessionReset(() => {
    try { flushAcksImmediate(); } catch { /* ignore */ }
    readStates.value = new Map();
    muteSettings.value = new Map();
    spaceBadges.value = new Map();
    serverDmCount.value = 0;
    notifications.value = { friendRequests: 0, inventory: 0, system: 0 };
    notificationFeed.value = [];
    channels.clear();
    spaceChannels.clear();
    acked.clear();
    viewing = null;
    pendingAck.clear();
    if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; }
    initialized.value = false;
  });

  // ── Getters ────────────────────────────────────────────

  const totalSystemBadge = computed(
    () => notifications.value.friendRequests + notifications.value.inventory + notifications.value.system,
  );

  // Conversations with something unread. The list is the one source once it has loaded; the
  // server's count only stands in until then.
  const unreadDmCount = computed(() => (recentChats.loaded ? recentChats.unreadConversations : serverDmCount.value));

  // What the home button stands for: direct messages and the notification feed. Spaces have their
  // own icons, so an unread channel lights its space, not home.
  const hasHomeUnread = computed(() => totalSystemBadge.value > 0 || unreadDmCount.value > 0);

  // Single "the user has something unread right now" signal — system notifications,
  // unread DMs, or any unread channel / mention across spaces.
  const hasAnyUnread = computed(() => {
    if (hasHomeUnread.value) return true;
    for (const sb of spaceBadges.value.values()) {
      if (sb.unreadChannelCount > 0 || sb.totalMentions > 0) return true;
    }
    return false;
  });

  // The number of things actively demanding attention — DMs, mentions, and system
  // notifications. Drives the numeric taskbar/dock badge (plain unread channels don't count,
  // matching how other chat apps badge only "pings").
  const pingCount = computed(() => {
    let total = unreadDmCount.value + totalSystemBadge.value;
    for (const sb of spaceBadges.value.values()) total += sb.totalMentions;
    return total;
  });

  // Reflect unread state onto the desktop tray icon + taskbar overlay / dock badge (native host only).
  watch(
    [hasAnyUnread, pingCount],
    ([has, pings]) => {
      if (!argon?.isArgonHost) return;
      try {
        // @ts-ignore — dynamic HostProc RPC method
        native?.hostProc.setTrayNotificationIndicator(has);

        if (navigator.userAgent.includes("Win")) {
          const icon = renderOverlayBadge(pings, has);
          const desc = pings > 0 ? `${pings} new` : has ? "New" : "";
          // @ts-ignore — dynamic HostProc RPC method
          native?.hostProc.setOverlayBadge(icon, desc, pings);
        } else {
          // macOS dock / Linux Unity badge — count only (no overlay image).
          // @ts-ignore — dynamic HostProc RPC method
          native?.hostProc.setOverlayBadge(null, "", pings);
        }
      } catch (e) {
        logger.error("[NotificationStore] Failed to update tray/taskbar badge:", e);
      }
    },
    { immediate: true },
  );

  // Pulse the taskbar button (Windows) / bounce the dock (macOS) on a real ping when the window
  // isn't focused — the host decides whether to actually flash based on focus.
  function flashForAttention() {
    if (!argon?.isArgonHost) return;
    try {
      // @ts-ignore — dynamic HostProc RPC method
      native?.hostProc.flashTaskbar();
    } catch (e) {
      logger.error("[NotificationStore] Failed to flash taskbar:", e);
    }
  }

  function isChannelUnread(channelId: Guid, lastMessageId: bigint): boolean {
    const rs = readStates.value.get(channelId);
    if (!rs) return lastMessageId > BigInt(0);
    return lastMessageId > rs.lastReadMessageId;
  }

  /**
   * Mentions waiting in a channel. Given the channel's newest id, a read channel shows none: a count
   * left there came from deleted messages and would otherwise resurface with the next message.
   */
  function channelMentionCount(channelId: Guid, lastMessageId?: bigint): number {
    const rs = readStates.value.get(channelId);
    if (!rs) return 0;
    if (lastMessageId !== undefined && lastMessageId <= rs.lastReadMessageId) return 0;
    return rs.mentionCount;
  }

  function effectiveMuteLevel(channelId: Guid, spaceId: Guid): MuteLevelType {
    const channelMute = muteSettings.value.get(channelId);
    if (channelMute) {
      if (channelMute.expiresAt && channelMute.expiresAt.toDate() < new Date()) {
        return MuteLevelType.None;
      }
      return channelMute.muteLevel;
    }
    const spaceMute = muteSettings.value.get(spaceId);
    if (spaceMute) {
      if (spaceMute.expiresAt && spaceMute.expiresAt.toDate() < new Date()) {
        return MuteLevelType.None;
      }
      return spaceMute.muteLevel;
    }
    return MuteLevelType.None;
  }

  function isTargetMuted(targetId: Guid): boolean {
    const s = muteSettings.value.get(targetId);
    if (!s) return false;
    if (s.expiresAt && s.expiresAt.toDate() < new Date()) return false;
    return s.muteLevel !== MuteLevelType.None;
  }

  function suppressesEveryone(channelId: Guid, spaceId: Guid): boolean {
    const channelMute = muteSettings.value.get(channelId);
    if (channelMute?.suppressEveryone) return true;
    const spaceMute = muteSettings.value.get(spaceId);
    return spaceMute?.suppressEveryone ?? false;
  }

  /** What one channel contributes to its space: the same answer the channel list shows. */
  function channelBadge(channelId: Guid, spaceId: Guid, lastMessageId: bigint): { unread: boolean; mentions: number } {
    const mute = effectiveMuteLevel(channelId, spaceId);
    if (mute === MuteLevelType.All) return { unread: false, mentions: 0 };
    const unread = isChannelUnread(channelId, lastMessageId);
    return {
      unread: unread && mute === MuteLevelType.None,
      mentions: unread ? readStates.value.get(channelId)?.mentionCount ?? 0 : 0,
    };
  }

  function getSpaceBadge(spaceId: Guid): SpaceBadge | undefined {
    return spaceBadges.value.get(spaceId);
  }

  // ── Channel marks ──────────────────────────────────────

  function noteChannel(channelId: Guid, spaceId: Guid, lastMessageId: bigint) {
    channels.set(channelId, { spaceId, lastMessageId });
    let set = spaceChannels.get(spaceId);
    if (!set) spaceChannels.set(spaceId, (set = new Set()));
    set.add(channelId);
  }

  /** The channel went away: it no longer counts toward its space. */
  function forgetChannel(channelId: Guid) {
    const ch = channels.get(channelId);
    if (!ch) return;
    channels.delete(channelId);
    spaceChannels.get(ch.spaceId)?.delete(channelId);
    recalcSpaceBadge(ch.spaceId);
  }

  async function loadChannelMarks() {
    const rows = await db.channels.toArray();
    channels.clear();
    spaceChannels.clear();
    for (const c of rows) noteChannel(c.channelId, c.spaceId, c.lastMessageId ?? 0n);
  }

  function computeSpaceBadge(spaceId: Guid): SpaceBadge {
    let unreadChannelCount = 0;
    let totalMentions = 0;
    for (const channelId of spaceChannels.get(spaceId) ?? []) {
      const ch = channels.get(channelId);
      if (!ch) continue;
      const b = channelBadge(channelId, spaceId, ch.lastMessageId);
      if (b.unread) unreadChannelCount++;
      totalMentions += b.mentions;
    }
    return { spaceId, unreadChannelCount, totalMentions };
  }

  function recalcSpaceBadge(spaceId: Guid) {
    // A space whose channels are not here yet keeps what the server said about it.
    if (!spaceChannels.has(spaceId)) return;
    spaceBadges.value.set(spaceId, computeSpaceBadge(spaceId));
    triggerRef(spaceBadges);
  }

  function recalcKnownSpaces() {
    const next = new Map(spaceBadges.value);
    for (const spaceId of spaceChannels.keys()) next.set(spaceId, computeSpaceBadge(spaceId));
    spaceBadges.value = next;
  }

  /**
   * Every space's badge from the channels on this device. The server's per-space counts are only
   * the fallback for a space whose channels have not loaded: it counts channels the user cannot see.
   */
  async function recalcAllSpaceBadges(serverBadges: Iterable<SpaceBadge> = spaceBadges.value.values()) {
    const fallback = [...serverBadges];
    try {
      await loadChannelMarks();
    } catch (error) {
      logger.error("[NotificationStore] Failed to read channel marks:", error);
    }
    const next = new Map<Guid, SpaceBadge>();
    for (const sb of fallback) if (!spaceChannels.has(sb.spaceId)) next.set(sb.spaceId, sb);
    for (const spaceId of spaceChannels.keys()) next.set(spaceId, computeSpaceBadge(spaceId));
    spaceBadges.value = next;
  }

  /** Moves a channel's newest id up, here and in the channels table the list renders from. */
  function raiseMark(channelId: Guid, spaceId: Guid, messageId: bigint) {
    const ch = channels.get(channelId);
    if (ch && ch.lastMessageId < messageId) ch.lastMessageId = messageId;

    void (async () => {
      try {
        await db.channels.where("channelId").equals(channelId).modify((c) => {
          if ((c.lastMessageId ?? 0n) < messageId) c.lastMessageId = messageId;
        });
        // Created after the last full read: counted from its first message on.
        if (!ch) {
          const row = await db.channels.get(channelId);
          if (row) {
            noteChannel(channelId, row.spaceId, row.lastMessageId ?? messageId);
            recalcSpaceBadge(row.spaceId);
          }
        }
      } catch (error) {
        logger.error("[NotificationStore] Failed to store a channel's newest message:", error);
      }
    })();

    return !!ch;
  }

  // ── Read cursor ────────────────────────────────────────

  /** Read up to messageId on screen; the mentions went with it. False when it was already. */
  function markReadLocally(channelId: Guid, spaceId: Guid | null, messageId: bigint): boolean {
    const rs = readStates.value.get(channelId);
    if (rs && rs.lastReadMessageId >= messageId) return false;
    const sid = rs?.spaceId ?? spaceId ?? channels.get(channelId)?.spaceId ?? null;
    readStates.value.set(channelId, { channelId, spaceId: sid, lastReadMessageId: messageId, mentionCount: 0 });
    triggerRef(readStates);
    if (sid) recalcSpaceBadge(sid);
    return true;
  }

  function noteAcked(channelId: Guid, messageId: bigint) {
    if ((acked.get(channelId) ?? 0n) < messageId) acked.set(channelId, messageId);
  }

  function isViewing(channelId: Guid) {
    return viewing?.channelId === channelId && isVisible();
  }

  /**
   * The channel on screen with its newest message in view, or null when none is. New messages
   * there are read on arrival instead of lighting the channel for the length of the ack delay.
   */
  function setViewing(channelId: Guid | null, spaceId: Guid | null = null) {
    viewing = channelId ? { channelId, spaceId } : null;
  }

  /** Only this channel's view lets go: a second view (split) may hold it by now. */
  function stopViewing(channelId: Guid) {
    if (viewing?.channelId === channelId) viewing = null;
  }

  /**
   * The chat view is at the bottom of what it shows, up to messageId. atLatest: that is the channel's
   * newest message, so the channel is read to its mark and whatever arrives next is read on arrival.
   * A minimised window reads nothing; coming back reads it then.
   */
  function readOnScreen(channelId: Guid, messageId: bigint, spaceId: Guid | null, atLatest: boolean) {
    setViewing(atLatest ? channelId : null, spaceId);
    if (isVisible()) scheduleAck(channelId, messageId, spaceId, atLatest);
  }

  // ── Init ───────────────────────────────────────────────

  async function initFromGlobalBadges() {
    try {
      const badges = await api.userInteraction.GetGlobalBadges();

      // A cursor this device already moved further — a read or a send still on its way — is not
      // taken back by an answer from before it.
      const rs = new Map<Guid, ChannelReadState>(readStates.value);
      for (const r of badges.readStates) {
        const local = readStates.value.get(r.channelId);
        rs.set(r.channelId, local && local.lastReadMessageId > r.lastReadMessageId ? local : r);
      }
      readStates.value = rs;

      for (const r of badges.readStates) noteAcked(r.channelId, r.lastReadMessageId);

      const ms = new Map<Guid, MuteSettingsDto>();
      for (const m of badges.muteSettings) ms.set(m.targetId, m);
      muteSettings.value = ms;

      serverDmCount.value = badges.unreadDmCount;
      notifications.value = badges.notifications;

      await recalcAllSpaceBadges(badges.spaces);
      initialized.value = true;

      logger.info("[NotificationStore] Initialized from GlobalBadges", {
        readStates: rs.size,
        muteSettings: ms.size,
        spaces: spaceBadges.value.size,
        unreadDmCount: badges.unreadDmCount,
      });
    } catch (error) {
      logger.error("[NotificationStore] Failed to load GlobalBadges:", error);
    }

    // The per-conversation counts behind the DM badge.
    recentChats.load().catch((error) => logger.error("[NotificationStore] Failed to load recent chats:", error));
  }

  // ── Event handlers ─────────────────────────────────────

  // Another window or device read the channel.
  function handleReadStateUpdated(e: ReadStateUpdated) {
    if (e.userId !== me.me?.userId) return;
    noteAcked(e.channelId, e.lastReadMessageId);
    const rs = readStates.value.get(e.channelId);
    if (rs && rs.lastReadMessageId > e.lastReadMessageId) return;
    const spaceId = e.spaceId ?? rs?.spaceId ?? null;
    readStates.value.set(e.channelId, {
      channelId: e.channelId,
      spaceId,
      lastReadMessageId: e.lastReadMessageId,
      mentionCount: e.mentionCount,
    });
    triggerRef(readStates);
    if (spaceId) recalcSpaceBadge(spaceId);
  }

  function handleSystemNotificationReceived(e: SystemNotificationReceived) {
    const feed = [e.notification, ...notificationFeed.value];
    notificationFeed.value = feed.length > MAX_NOTIFICATION_FEED ? feed.slice(0, MAX_NOTIFICATION_FEED) : feed;

    const key = NOTIFICATION_TYPES[e.notification.type];
    if (key) {
      notifications.value = {
        ...notifications.value,
        [key]: notifications.value[key] + 1,
      };
    }

    // Play notification sound
    tone.playNotificationSound();
  }

  function handleMuteSettingsChanged(e: MuteSettingsChanged) {
    if (e.muteLevel === MuteLevelType.None) {
      muteSettings.value.delete(e.targetId);
    } else {
      const existing = muteSettings.value.get(e.targetId);
      muteSettings.value.set(e.targetId, existing
        ? { ...existing, muteLevel: e.muteLevel }
        : {
            targetId: e.targetId,
            targetType: spaceChannels.has(e.targetId) ? MuteTargetKind.Space : MuteTargetKind.Channel,
            muteLevel: e.muteLevel,
            suppressEveryone: false,
            expiresAt: null,
          });
    }
    triggerRef(muteSettings);
    recalcKnownSpaces();
  }

  // The server files no system notification for a friend request — the event is all there is —
  // so the badge, the sound and the toast are raised here. The count is reconciled from the
  // server's own tally of pending requests on the next load.
  function handleFriendRequestReceived(e: FriendRequestReceivedEvent) {
    notifications.value = { ...notifications.value, friendRequests: notifications.value.friendRequests + 1 };
    tone.playNotificationSound();
    flashForAttention();
    void (async () => {
      const user = await usePoolStore().getUser(e.requesterId);
      const { t } = useLocale();
      toast({ title: t("friend_request_from", { name: user?.displayName ?? t("unknown_display_name") }) });
    })();
  }

  function handleFriendRequestCanceled(_e: FriendRequestCanceledEvent) {
    if (notifications.value.friendRequests > 0) {
      notifications.value = { ...notifications.value, friendRequests: notifications.value.friendRequests - 1 };
    }
  }

  // The count itself lives with the conversation list (useRecentChatsStore).
  function handleDirectMessageSent(e: DirectMessageSent) {
    if (e.receiverId !== me.me?.userId) return;
    if (useFriendsStore().isIgnored(e.senderId)) return;
    if (recentChats.viewingPeer === e.senderId && isVisible()) return;
    flashForAttention();
  }

  /** Whether a message pings this user: by name, @everyone, a role they hold, or a reply to them. */
  async function mentionsMe(msg: ArgonMessage, spaceId: Guid): Promise<boolean> {
    const myId = me.me?.userId;
    if (!myId) return false;

    const roles: Guid[] = [];
    for (const e of msg.entities ?? []) {
      if (e.type === EntityType.Mention && (e as MessageEntityMention).userId === myId) return true;
      if (e.type === EntityType.MentionEveryone && !suppressesEveryone(msg.channelId, spaceId)) return true;
      if (e.type === EntityType.MentionRole) roles.push((e as MessageEntityMentionRole).archetypeId);
    }

    if (roles.length > 0) {
      const member = await db.members.where("[userId+spaceId]").equals([myId, spaceId]).first();
      if (member?.archetypes?.some((a) => roles.includes(a.archetypeId))) return true;
    }

    if (msg.replyId != null) {
      const replied = await db.messages.get(Number(msg.replyId));
      if (replied?.messageId === msg.replyId && replied.sender === myId && !replied.crosspost) return true;
    }

    return false;
  }

  async function countMention(msg: ArgonMessage, spaceId: Guid) {
    try {
      if (!(await mentionsMe(msg, spaceId))) return;
      if (effectiveMuteLevel(msg.channelId, spaceId) === MuteLevelType.All) return;

      const rs = readStates.value.get(msg.channelId);
      // Read while this was being worked out.
      if (rs && rs.lastReadMessageId >= msg.messageId) return;

      readStates.value.set(msg.channelId, {
        channelId: msg.channelId,
        spaceId: rs?.spaceId ?? spaceId,
        lastReadMessageId: rs?.lastReadMessageId ?? 0n,
        mentionCount: (rs?.mentionCount ?? 0) + 1,
      });
      triggerRef(readStates);
      recalcSpaceBadge(spaceId);

      // The open channel plays its own sound (useChatMessages).
      if (channelStore.selectedTextChannel !== msg.channelId) tone.playNotificationSound();
      flashForAttention();
    } catch (error) {
      logger.error("[NotificationStore] Failed to count a mention:", error);
    }
  }

  function handleMessageSent(e: MessageSent) {
    const msg = e.message;
    const spaceId = e.spaceId;

    const known = raiseMark(msg.channelId, spaceId, msg.messageId);

    if (msg.sender === me.me?.userId) {
      // What you wrote is read. The server moves your cursor the same way on its own.
      noteAcked(msg.channelId, msg.messageId);
      markReadLocally(msg.channelId, spaceId, msg.messageId);
      return;
    }

    // Not a channel on this device (yet): raiseMark picks it up if it turns out to be one.
    if (!known) return;

    if (isViewing(msg.channelId)) {
      scheduleAck(msg.channelId, msg.messageId, spaceId);
      return;
    }

    recalcSpaceBadge(spaceId);
    void countMention(msg, spaceId);
  }

  /**
   * The newest message of a channel was deleted and its mark went back. Lowered only while the mark
   * here still points at or below the deleted one — a newer message may have overtaken this event.
   */
  function handleChannelMarkRetracted(e: ChannelMarkRetracted) {
    const ch = channels.get(e.channelId);
    if (ch && ch.lastMessageId <= e.messageId) ch.lastMessageId = e.lastMessageId;

    void db.channels.where("channelId").equals(e.channelId).modify((c) => {
      if ((c.lastMessageId ?? 0n) <= e.messageId) c.lastMessageId = e.lastMessageId;
    }).catch((error) => logger.error("[NotificationStore] Failed to retract a channel mark:", error));

    // Caught up now: any mention left came from what was deleted (the server clears it the same way).
    const rs = readStates.value.get(e.channelId);
    if (rs && rs.mentionCount > 0 && rs.lastReadMessageId >= e.lastMessageId) {
      readStates.value.set(e.channelId, { ...rs, mentionCount: 0 });
      triggerRef(readStates);
    }

    recalcSpaceBadge(e.spaceId);
  }

  // ── ACK ────────────────────────────────────────────────

  /**
   * The user has read the channel up to messageId. With toLatest the view is at the channel's newest
   * message, so everything up to the channel's mark is read — including a deleted tail no message
   * on screen stands for, which would otherwise keep the channel unread for good.
   */
  function scheduleAck(channelId: Guid, messageId: bigint, spaceId?: Guid | null, toLatest = false) {
    let target = messageId;
    if (toLatest) {
      const mark = channels.get(channelId)?.lastMessageId ?? 0n;
      if (mark > target) target = mark;
    }
    if (target <= 0n) return;

    // On screen at once; the server hears about it after the debounce.
    markReadLocally(channelId, spaceId ?? null, target);

    // The scroller reports "at bottom" on every render pass, not only on user scrolls; without this
    // check the same message was re-acked every 1.5 s for as long as the user sat at the bottom.
    if ((acked.get(channelId) ?? 0n) >= target) return;
    if ((pendingAck.get(channelId) ?? 0n) >= target) return;
    pendingAck.set(channelId, target);
    if (!ackTimer) {
      ackTimer = setTimeout(flushAcks, 1500);
    }
  }

  function flushAcks() {
    ackTimer = null;
    for (const [channelId, messageId] of pendingAck) {
      const previous = acked.get(channelId);
      acked.set(channelId, messageId);

      api.userInteraction.AckChannel(channelId, messageId).catch((error) => {
        // Not rolled back on screen — the user did read it. The next pass at the bottom asks again.
        logger.error("[NotificationStore] AckChannel failed:", error);
        if (acked.get(channelId) !== messageId) return;
        if (previous === undefined) acked.delete(channelId);
        else acked.set(channelId, previous);
      });
    }
    pendingAck.clear();
  }

  function flushAcksImmediate() {
    if (ackTimer) {
      clearTimeout(ackTimer);
      ackTimer = null;
    }
    if (pendingAck.size > 0) {
      flushAcks();
    }
  }

  // ── Mute actions ───────────────────────────────────────

  async function muteTarget(
    targetId: Guid,
    targetType: MuteTargetKind,
    muteLevel: MuteLevelType,
    suppressEveryone: boolean,
    expiresAt: IonDateTime | null,
  ) {
    const old = muteSettings.value.get(targetId);
    const dto: MuteSettingsDto = { targetId, targetType, muteLevel, suppressEveryone, expiresAt };
    muteSettings.value.set(targetId, dto);
    triggerRef(muteSettings);
    recalcKnownSpaces();

    try {
      await api.userInteraction.MuteTarget(targetId, targetType, muteLevel, suppressEveryone, expiresAt);
    } catch (error) {
      logger.error("[NotificationStore] MuteTarget failed, rolling back:", error);
      if (old) muteSettings.value.set(targetId, old);
      else muteSettings.value.delete(targetId);
      triggerRef(muteSettings);
      recalcKnownSpaces();
    }
  }

  async function unmuteTarget(targetId: Guid) {
    const old = muteSettings.value.get(targetId);
    muteSettings.value.delete(targetId);
    triggerRef(muteSettings);
    recalcKnownSpaces();

    try {
      await api.userInteraction.UnmuteTarget(targetId);
    } catch (error) {
      logger.error("[NotificationStore] UnmuteTarget failed, rolling back:", error);
      if (old) {
        muteSettings.value.set(targetId, old);
        triggerRef(muteSettings);
        recalcKnownSpaces();
      }
    }
  }

  // ── Notification feed ──────────────────────────────────

  async function loadNotificationFeed(limit: number = 25, before?: IonDateTime) {
    try {
      const items = await api.userInteraction.GetNotificationFeed(limit, before ?? null);
      if (before) {
        const combined = [...notificationFeed.value, ...items];
        notificationFeed.value = combined.length > MAX_NOTIFICATION_FEED ? combined.slice(0, MAX_NOTIFICATION_FEED) : combined;
      } else {
        notificationFeed.value = items.length > MAX_NOTIFICATION_FEED ? items.slice(0, MAX_NOTIFICATION_FEED) : [...items];
      }
      feedHasMore.value = items.length >= limit;
    } catch (error) {
      logger.error("[NotificationStore] Failed to load notification feed:", error);
    }
  }

  async function markNotificationRead(notificationId: Guid) {
    const idx = notificationFeed.value.findIndex((n) => n.id === notificationId);
    if (idx === -1) return;

    const old = notificationFeed.value[idx];
    if (old.isRead) return;

    // Optimistic - mutate in place
    notificationFeed.value[idx] = { ...old, isRead: true };
    triggerRef(notificationFeed);

    const key = NOTIFICATION_TYPES[old.type];
    if (key && notifications.value[key] > 0) {
      notifications.value = { ...notifications.value, [key]: notifications.value[key] - 1 };
    }

    try {
      await api.userInteraction.MarkNotificationRead(notificationId);
    } catch (error) {
      logger.error("[NotificationStore] MarkNotificationRead failed:", error);
      notificationFeed.value[idx] = old;
      triggerRef(notificationFeed);
      if (key) {
        notifications.value = { ...notifications.value, [key]: notifications.value[key] + 1 };
      }
    }
  }

  async function markAllNotificationsRead(type?: string) {
    const oldFeed = [...notificationFeed.value];
    const oldNotifications = { ...notifications.value };

    // Optimistic - mutate in place
    for (let i = 0; i < notificationFeed.value.length; i++) {
      const n = notificationFeed.value[i];
      if (!type || n.type === type) {
        notificationFeed.value[i] = { ...n, isRead: true };
      }
    }
    triggerRef(notificationFeed);

    if (type) {
      const key = NOTIFICATION_TYPES[type];
      if (key) notifications.value = { ...notifications.value, [key]: 0 };
    } else {
      notifications.value = { friendRequests: 0, inventory: 0, system: 0 };
    }

    try {
      await api.userInteraction.MarkAllNotificationsRead(type ?? null);
    } catch (error) {
      logger.error("[NotificationStore] MarkAllNotificationsRead failed:", error);
      notificationFeed.value = oldFeed;
      notifications.value = oldNotifications;
    }
  }

  // ── Subscribe ──────────────────────────────────────────

  let subscribed = false;

  function subscribeToEvents() {
    if (subscribed) return;
    subscribed = true;
    bus.onServerEvent<ReadStateUpdated>("ReadStateUpdated", handleReadStateUpdated);
    bus.onServerEvent<SystemNotificationReceived>("SystemNotificationReceived", handleSystemNotificationReceived);
    bus.onServerEvent<MuteSettingsChanged>("MuteSettingsChanged", handleMuteSettingsChanged);
    bus.onServerEvent<DirectMessageSent>("DirectMessageSent", handleDirectMessageSent);
    bus.onServerEvent<MessageSent>("MessageSent", handleMessageSent);
    bus.onServerEvent<ChannelMarkRetracted>("ChannelMarkRetracted", handleChannelMarkRetracted);
    bus.onServerEvent<FriendRequestReceivedEvent>("FriendRequestReceivedEvent", handleFriendRequestReceived);
    bus.onServerEvent<FriendRequestCanceledEvent>("FriendRequestCanceledEvent", handleFriendRequestCanceled);
    recentChats.listen();

    // Back from a minimised window: the channel on screen is read now, not when its messages arrived.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (isVisible() && viewing) scheduleAck(viewing.channelId, 0n, viewing.spaceId, true);
      });
    }
  }

  return {
    // State
    readStates,
    muteSettings,
    spaceBadges,
    unreadDmCount,
    notifications,
    notificationFeed,
    feedHasMore,
    initialized,

    // Getters
    totalSystemBadge,
    hasAnyUnread,
    hasHomeUnread,
    pingCount,
    isChannelUnread,
    channelMentionCount,
    channelBadge,
    effectiveMuteLevel,
    isTargetMuted,
    suppressesEveryone,
    getSpaceBadge,

    // Actions
    initFromGlobalBadges,
    recalcAllSpaceBadges,
    forgetChannel,
    subscribeToEvents,
    stopViewing,
    readOnScreen,
    scheduleAck,
    flushAcksImmediate,
    muteTarget,
    unmuteTarget,
    loadNotificationFeed,
    markNotificationRead,
    markAllNotificationsRead,
  };
});
