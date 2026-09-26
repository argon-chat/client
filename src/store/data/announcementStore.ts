import { logger } from "@argon/core";
import { liveQuery, type Subscription } from "dexie";
import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import { ChannelType, type ArgonChannel } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { db } from "@/store/db/dexie";
import { useNotificationStore } from "@/store/data/notificationStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { spacesWithUnreadAnnouncements } from "@/lib/announcements/spaceAnnouncements";

/**
 * Which spaces have an unread announcement channel, for the accent ring in the spaces rail.
 *
 * One live query over every announcement channel the client holds, across all spaces, started by
 * the first reader. The unread rule itself is the sidebar's (read state vs. the channel's
 * high-water mark, mute respected), so the rail and the channel list never disagree.
 */
export const useAnnouncementStore = defineStore("announcements", () => {
  const ntf = useNotificationStore();

  const channels = shallowRef<ArgonChannel[]>([]);
  let sub: Subscription | null = null;

  function ensureWatching() {
    if (sub) return;
    sub = liveQuery(() => db.channels.filter((c) => c.type === ChannelType.Announcement).toArray()).subscribe({
      next: (rows) => {
        channels.value = rows;
      },
      error: (err) => logger.error("[AnnouncementStore] liveQuery failed:", err),
    });
  }

  const unreadSpaces = computed(() => spacesWithUnreadAnnouncements(channels.value, ntf));

  function hasUnreadIn(spaceId: Guid): boolean {
    ensureWatching();
    return unreadSpaces.value.has(spaceId);
  }

  // The query is bound to the previous account's database.
  onSessionReset(() => {
    sub?.unsubscribe();
    sub = null;
    channels.value = [];
  });

  return { channels, unreadSpaces, hasUnreadIn };
});
