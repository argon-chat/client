import { logger } from "@argon/core";
import { liveQuery, type Subscription } from "dexie";
import { defineStore } from "pinia";
import { computed, shallowRef, watch } from "vue";
import { ChannelType, type ArgonChannel } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { db } from "@/store/db/dexie";
import { useNotificationStore } from "@/store/data/notificationStore";
import { onSessionReset, sessionEpoch } from "@/store/system/sessionLifecycle";
import { spacesWithUnreadAnnouncements } from "@/lib/announcements/spaceAnnouncements";

/**
 * Which spaces have an unread announcement channel, for the accent ring in the spaces rail.
 *
 * One live query over every announcement channel the client holds, across all spaces, started by
 * the first reader. The unread rule itself is the sidebar's (read state vs. the channel's
 * high-water mark, mute respected), so the rail and the channel list never disagree.
 *
 * The query goes through the `type` index. Every received message writes its channel row
 * (`lastMessageId`), and a live query observes only the index range it read: a write to a text
 * channel does not touch the Announcement range, so it no longer re-runs the query.
 */
export const useAnnouncementStore = defineStore("announcements", () => {
  const ntf = useNotificationStore();

  const channels = shallowRef<ArgonChannel[]>([]);
  let sub: Subscription | null = null;
  let generation = 0;
  /** The session the subscription was made in; a switch swaps the database under it. */
  let boundEpoch = -1;
  let wanted = false;

  function ensureWatching() {
    wanted = true;
    if (sub && boundEpoch === sessionEpoch.value) return;
    sub?.unsubscribe();
    sub = null;
    boundEpoch = sessionEpoch.value;
    const gen = ++generation;
    let failed = false;
    const started = liveQuery(() =>
      db.channels.where("type").equals(ChannelType.Announcement).toArray(),
    ).subscribe({
      next: (rows) => {
        channels.value = rows;
      },
      error: (err) => {
        logger.error("[AnnouncementStore] liveQuery failed:", err);
        // A failed query is finished for good; the next reader subscribes again.
        failed = true;
        if (gen === generation) sub = null;
      },
    });
    if (!failed) sub = started;
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
    generation++;
    channels.value = [];
  });

  // The epoch moves once the next account's database is open: bind to it then, whether or not a
  // reader asks again (the rail may not re-render until something it reads changes).
  watch(sessionEpoch, () => {
    if (wanted) ensureWatching();
  });

  return { channels, unreadSpaces, hasUnreadIn };
});
