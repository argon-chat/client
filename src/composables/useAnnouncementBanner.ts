import { computed, shallowRef, watch, type Ref } from "vue";
import { logger } from "@argon/core";
import type { ArgonMessage } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { db } from "@/store/db/dexie";
import { useApi } from "@/store/system/apiStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { setLastChannel } from "@/lib/recentSpaces";
import { dismissUpTo, isBannerDue, newestMessage } from "@/lib/announcements/spaceAnnouncements";

/**
 * The latest post of the space's main announcement channel, while it is unread.
 *
 * "Unread" is the read state the sidebar uses, and there is no dismissed flag of its own: Dismiss
 * acks the channel through the ordinary ack path, so the banner, the unread marker and every other
 * device agree. A member who just joined has no read state for the channel at all, which the
 * notification store already counts as unread — so they get the banner without a special case.
 */
export function useAnnouncementBanner(spaceId: Ref<Guid | null | undefined>, openChannelId: Ref<Guid | null | undefined>) {
  const api = useApi();
  const ntf = useNotificationStore();
  const pool = usePoolStore();

  const space = useLiveQuery(() => (spaceId.value ? db.servers.get(spaceId.value) : undefined));
  const mainChannelId = computed(() => space.value?.mainAnnouncementChannelId ?? null);
  const channel = useLiveQuery(() => (mainChannelId.value ? db.channels.get(mainChannelId.value) : undefined));

  const due = computed(() =>
    isBannerDue(
      { spaceId: spaceId.value, mainChannelId: mainChannelId.value, channel: channel.value, openChannelId: openChannelId.value },
      ntf,
    ),
  );

  const message = shallowRef<ArgonMessage | null>(null);

  async function loadNewest(sid: Guid, cid: Guid, last: bigint): Promise<ArgonMessage | null> {
    try {
      const cached = last > 0n ? await pool.getMessageById(last) : undefined;
      if (cached && cached.channelId === cid) return cached;
      return newestMessage((await api.channelInteraction.QueryMessages(sid, cid, null, 1)) ?? []);
    } catch (e) {
      logger.warn("[AnnouncementBanner] could not load the latest announcement", e);
      return null;
    }
  }

  // Reloaded whenever the channel's high-water mark moves, and only while the banner is due.
  let loads = 0;
  watch(
    () => (due.value && channel.value ? `${channel.value.channelId}:${channel.value.lastMessageId}` : null),
    async (key) => {
      const seq = ++loads;
      const ch = channel.value;
      if (!key || !ch) return;
      if (message.value?.channelId === ch.channelId && message.value.messageId === ch.lastMessageId) return;
      const loaded = await loadNewest(ch.spaceId, ch.channelId, ch.lastMessageId);
      if (seq === loads) message.value = loaded;
    },
    { immediate: true },
  );

  const senderId = computed(() => message.value?.sender);
  const author = pool.getUserReactive(senderId);

  // Space members are in the local cache already; an author who has since left may not be.
  watch(senderId, async (id) => {
    const sid = spaceId.value;
    if (!id || !sid || (await pool.getUser(id))) return;
    try {
      await pool.trackUser(await api.serverInteraction.PrefetchUser(sid, id));
    } catch (e) {
      logger.warn("[AnnouncementBanner] could not load the author", e);
    }
  });

  const visible = computed(
    () => due.value && !!message.value && message.value.channelId === channel.value?.channelId,
  );

  /** Acks the channel up to the shown post, which is what makes the banner go away. */
  function dismiss() {
    const ch = channel.value;
    const m = message.value;
    if (!ch || !m) return;
    ntf.scheduleAck(ch.channelId, dismissUpTo(m, ch), ch.spaceId);
    ntf.flushAcksImmediate();
  }

  /** Remembers the channel the way picking it in the sidebar does; the caller navigates. */
  function open(): Guid | null {
    const ch = channel.value;
    if (!ch) return null;
    setLastChannel(ch.spaceId, ch.channelId);
    pool.selectedTextChannel = ch.channelId;
    return ch.channelId;
  }

  return { channel, message, author, visible, dismiss, open };
}
