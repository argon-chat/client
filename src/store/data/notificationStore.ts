import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useMe } from "@/store/auth/meStore";
import { useChannelStore } from "@/store/data/channelStore";
import { useTone } from "@/store/media/toneStore";
import {
  type ChannelReadState,
  type MuteSettingsDto,
  type SpaceBadge,
  type NotificationBadges,
  type SystemNotificationDto,
  MuteLevelType,
  MuteTargetKind,
  type ReadStateUpdated,
  type SystemNotificationReceived,
  type MuteSettingsChanged,
  type BatchMentionOccurred,
  type DirectMessageSent,
  type MessageSent,
} from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { DateTimeOffset } from "@argon-chat/ion.webcore";

const NOTIFICATION_TYPES: Record<string, keyof NotificationBadges> = {
  friend_request_received: "friendRequests",
  item_received: "inventory",
  system_announcement: "system",
};

export const useNotificationStore = defineStore("notifications", () => {
  const api = useApi();
  const bus = useBus();
  const me = useMe();
  const channelStore = useChannelStore();
  const tone = useTone();

  // ── State ──────────────────────────────────────────────

  const readStates = ref(new Map<Guid, ChannelReadState>());
  const muteSettings = ref(new Map<Guid, MuteSettingsDto>());
  const spaceBadges = ref(new Map<Guid, SpaceBadge>());
  const unreadDmCount = ref(0);
  const notifications = ref<NotificationBadges>({ friendRequests: 0, inventory: 0, system: 0 });
  const notificationFeed = ref<SystemNotificationDto[]>([]);
  const feedHasMore = ref(true);
  const initialized = ref(false);

  // ACK debounce
  const pendingAck = new Map<Guid, { messageId: bigint; spaceId: Guid | null }>();
  let ackTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Getters ────────────────────────────────────────────

  const totalSystemBadge = computed(
    () => notifications.value.friendRequests + notifications.value.inventory + notifications.value.system,
  );

  function isChannelUnread(channelId: Guid, lastMessageId: bigint): boolean {
    const rs = readStates.value.get(channelId);
    if (!rs) return lastMessageId > BigInt(0);
    return lastMessageId > rs.lastReadMessageId;
  }

  function channelMentionCount(channelId: Guid): number {
    return readStates.value.get(channelId)?.mentionCount ?? 0;
  }

  function effectiveMuteLevel(channelId: Guid, spaceId: Guid): MuteLevelType {
    const channelMute = muteSettings.value.get(channelId);
    if (channelMute) {
      if (channelMute.expiresAt && channelMute.expiresAt.date < new Date()) {
        return MuteLevelType.None;
      }
      return channelMute.muteLevel;
    }
    const spaceMute = muteSettings.value.get(spaceId);
    if (spaceMute) {
      if (spaceMute.expiresAt && spaceMute.expiresAt.date < new Date()) {
        return MuteLevelType.None;
      }
      return spaceMute.muteLevel;
    }
    return MuteLevelType.None;
  }

  function isTargetMuted(targetId: Guid): boolean {
    const s = muteSettings.value.get(targetId);
    if (!s) return false;
    if (s.expiresAt && s.expiresAt.date < new Date()) return false;
    return s.muteLevel !== MuteLevelType.None;
  }

  function suppressesEveryone(channelId: Guid, spaceId: Guid): boolean {
    const channelMute = muteSettings.value.get(channelId);
    if (channelMute?.suppressEveryone) return true;
    const spaceMute = muteSettings.value.get(spaceId);
    return spaceMute?.suppressEveryone ?? false;
  }

  function getSpaceBadge(spaceId: Guid): SpaceBadge | undefined {
    return spaceBadges.value.get(spaceId);
  }

  // ── Init ───────────────────────────────────────────────

  async function initFromGlobalBadges() {
    try {
      const badges = await api.userInteraction.GetGlobalBadges();

      const rs = new Map<Guid, ChannelReadState>();
      for (const r of badges.readStates) rs.set(r.channelId, r);
      readStates.value = rs;

      const ms = new Map<Guid, MuteSettingsDto>();
      for (const m of badges.muteSettings) ms.set(m.targetId, m);
      muteSettings.value = ms;

      const sb = new Map<Guid, SpaceBadge>();
      for (const s of badges.spaces) sb.set(s.spaceId, s);
      spaceBadges.value = sb;

      unreadDmCount.value = badges.unreadDmCount;
      notifications.value = badges.notifications;
      initialized.value = true;

      logger.info("[NotificationStore] Initialized from GlobalBadges", {
        readStates: rs.size,
        muteSettings: ms.size,
        spaces: sb.size,
        unreadDmCount: badges.unreadDmCount,
      });

      // Recalculate space badges client-side from readStates
      // (server may return empty spaces[] if feature is partial)
      const spaceIds = new Set<Guid>();
      for (const r of rs.values()) {
        if (r.spaceId) spaceIds.add(r.spaceId);
      }
      for (const spaceId of spaceIds) {
        await recalcSpaceBadge(spaceId);
      }
    } catch (error) {
      logger.error("[NotificationStore] Failed to load GlobalBadges:", error);
    }
  }

  // ── Event handlers ─────────────────────────────────────

  function handleReadStateUpdated(e: ReadStateUpdated) {
    readStates.value.set(e.channelId, {
      channelId: e.channelId,
      spaceId: e.spaceId,
      lastReadMessageId: e.lastReadMessageId,
      mentionCount: e.mentionCount,
    });
    // Trigger reactivity
    readStates.value = new Map(readStates.value);

    // Recalculate space badge if spaceId is known
    if (e.spaceId) {
      recalcSpaceBadge(e.spaceId);
    }
  }

  function handleSystemNotificationReceived(e: SystemNotificationReceived) {
    notificationFeed.value = [e.notification, ...notificationFeed.value];

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
    const existing = muteSettings.value.get(e.targetId);
    if (e.muteLevel === MuteLevelType.None) {
      muteSettings.value.delete(e.targetId);
    } else if (existing) {
      existing.muteLevel = e.muteLevel;
      muteSettings.value.set(e.targetId, { ...existing });
    }
    muteSettings.value = new Map(muteSettings.value);
  }

  function handleBatchMentionOccurred(e: BatchMentionOccurred) {
    const mute = effectiveMuteLevel(e.channelId, e.spaceId);
    if (mute !== MuteLevelType.All) {
      tone.playNotificationSound();
    }
  }

  function handleDirectMessageSent(e: DirectMessageSent) {
    if (e.receiverId === me.me?.userId) {
      unreadDmCount.value++;
    }
  }

  function handleMessageSent(e: MessageSent) {
    const msg = e.message;

    // Own message — auto-advance readState so channel doesn't flash as unread
    if (msg.sender === me.me?.userId) {
      // Update channel's lastMessageId + readState atomically
      void (async () => {
        const ch = await channelStore.getChannel(msg.channelId);
        if (ch) {
          ch.lastMessageId = msg.messageId;
          await channelStore.trackChannel(ch);
        }
      })();

      const rs = readStates.value.get(msg.channelId);
      if (rs) {
        readStates.value.set(msg.channelId, {
          ...rs,
          lastReadMessageId: msg.messageId,
        });
        readStates.value = new Map(readStates.value);
      }
      return;
    }

    // Other user's message — update lastMessageId, then recalc badge
    void (async () => {
      const ch = await channelStore.getChannel(msg.channelId);
      if (ch) {
        ch.lastMessageId = msg.messageId;
        await channelStore.trackChannel(ch);
      }

      const spaceId = readStates.value.get(msg.channelId)?.spaceId ?? e.spaceId;
      if (spaceId) {
        await recalcSpaceBadge(spaceId);
      }
    })();
  }

  // ── ACK ────────────────────────────────────────────────

  function scheduleAck(channelId: Guid, messageId: bigint, spaceId?: Guid | null) {
    pendingAck.set(channelId, { messageId, spaceId: spaceId ?? null });
    if (!ackTimer) {
      ackTimer = setTimeout(flushAcks, 1500);
    }
  }

  function flushAcks() {
    ackTimer = null;
    for (const [channelId, { messageId, spaceId: ackSpaceId }] of pendingAck) {
      // Optimistic update
      const rs = readStates.value.get(channelId);
      const oldReadState = rs ? { ...rs } : null;
      const resolvedSpaceId = rs?.spaceId ?? ackSpaceId;

      readStates.value.set(channelId, {
        channelId,
        spaceId: resolvedSpaceId,
        lastReadMessageId: messageId,
        mentionCount: 0,
      });
      readStates.value = new Map(readStates.value);

      if (resolvedSpaceId) {
        recalcSpaceBadge(resolvedSpaceId);
      }

      api.userInteraction.AckChannel(channelId, messageId).catch((error) => {
        logger.error("[NotificationStore] AckChannel failed, rolling back:", error);
        if (oldReadState) {
          readStates.value.set(channelId, oldReadState);
          readStates.value = new Map(readStates.value);
          if (oldReadState.spaceId) recalcSpaceBadge(oldReadState.spaceId);
        }
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
    expiresAt: DateTimeOffset | null,
  ) {
    const old = muteSettings.value.get(targetId);
    const dto: MuteSettingsDto = { targetId, targetType, muteLevel, suppressEveryone, expiresAt };
    muteSettings.value.set(targetId, dto);
    muteSettings.value = new Map(muteSettings.value);

    try {
      await api.userInteraction.MuteTarget(targetId, targetType, muteLevel, suppressEveryone, expiresAt);
    } catch (error) {
      logger.error("[NotificationStore] MuteTarget failed, rolling back:", error);
      if (old) muteSettings.value.set(targetId, old);
      else muteSettings.value.delete(targetId);
      muteSettings.value = new Map(muteSettings.value);
    }
  }

  async function unmuteTarget(targetId: Guid) {
    const old = muteSettings.value.get(targetId);
    muteSettings.value.delete(targetId);
    muteSettings.value = new Map(muteSettings.value);

    try {
      await api.userInteraction.UnmuteTarget(targetId);
    } catch (error) {
      logger.error("[NotificationStore] UnmuteTarget failed, rolling back:", error);
      if (old) {
        muteSettings.value.set(targetId, old);
        muteSettings.value = new Map(muteSettings.value);
      }
    }
  }

  // ── Notification feed ──────────────────────────────────

  async function loadNotificationFeed(limit: number = 25, before?: DateTimeOffset) {
    try {
      const items = await api.userInteraction.GetNotificationFeed(limit, before ?? null);
      if (before) {
        notificationFeed.value = [...notificationFeed.value, ...items];
      } else {
        notificationFeed.value = [...items];
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

    // Optimistic
    const updated = [...notificationFeed.value];
    updated[idx] = { ...old, isRead: true };
    notificationFeed.value = updated;

    const key = NOTIFICATION_TYPES[old.type];
    if (key && notifications.value[key] > 0) {
      notifications.value = { ...notifications.value, [key]: notifications.value[key] - 1 };
    }

    try {
      await api.userInteraction.MarkNotificationRead(notificationId);
    } catch (error) {
      logger.error("[NotificationStore] MarkNotificationRead failed:", error);
      notificationFeed.value[idx] = old;
      notificationFeed.value = [...notificationFeed.value];
      if (key) {
        notifications.value = { ...notifications.value, [key]: notifications.value[key] + 1 };
      }
    }
  }

  async function markAllNotificationsRead(type?: string) {
    const oldFeed = [...notificationFeed.value];
    const oldNotifications = { ...notifications.value };

    // Optimistic
    notificationFeed.value = notificationFeed.value.map((n) =>
      !type || n.type === type ? { ...n, isRead: true } : n,
    );
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

  // ── Helpers ────────────────────────────────────────────

  async function recalcSpaceBadge(spaceId: Guid) {
    // Recalculate from readStates + channel lastMessageIds
    let unreadCount = 0;
    let totalMentions = 0;

    for (const [channelId, rs] of readStates.value) {
      if (rs.spaceId !== spaceId) continue;

      const mute = effectiveMuteLevel(channelId, spaceId);

      const ch = await channelStore.getChannel(channelId);
      const lastMsgId = ch?.lastMessageId ?? BigInt(0);

      if (mute === MuteLevelType.All) continue;

      if (lastMsgId > rs.lastReadMessageId) {
        if (mute === MuteLevelType.None) unreadCount++;
      }

      if (mute === MuteLevelType.None || mute === MuteLevelType.OnlyMentions) {
        totalMentions += rs.mentionCount;
      }
    }

    spaceBadges.value.set(spaceId, { spaceId, unreadChannelCount: unreadCount, totalMentions });
    spaceBadges.value = new Map(spaceBadges.value);
  }

  function decrementDmUnread() {
    if (unreadDmCount.value > 0) {
      unreadDmCount.value--;
    }
  }

  // ── Subscribe ──────────────────────────────────────────

  function subscribeToEvents() {
    bus.onServerEvent<ReadStateUpdated>("ReadStateUpdated", handleReadStateUpdated);
    bus.onServerEvent<SystemNotificationReceived>("SystemNotificationReceived", handleSystemNotificationReceived);
    bus.onServerEvent<MuteSettingsChanged>("MuteSettingsChanged", handleMuteSettingsChanged);
    bus.onServerEvent<BatchMentionOccurred>("BatchMentionOccurred", handleBatchMentionOccurred);
    bus.onServerEvent<DirectMessageSent>("DirectMessageSent", handleDirectMessageSent);
    bus.onServerEvent<MessageSent>("MessageSent", handleMessageSent);
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
    isChannelUnread,
    channelMentionCount,
    effectiveMuteLevel,
    isTargetMuted,
    suppressesEveryone,
    getSpaceBadge,

    // Actions
    initFromGlobalBadges,
    subscribeToEvents,
    scheduleAck,
    flushAcksImmediate,
    muteTarget,
    unmuteTarget,
    loadNotificationFeed,
    markNotificationRead,
    markAllNotificationsRead,
    decrementDmUnread,
  };
});
