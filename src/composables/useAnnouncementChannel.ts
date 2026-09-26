import { computed, onScopeDispose, ref, watch } from "vue";
import { liveQuery, type Subscription } from "dexie";
import { logger } from "@argon/core";
import { ChannelType, type AnnouncementSettings, type ArgonChannel, type ArgonSpaceBase } from "@argon/glue";
import { db } from "@/store/db/dexie";
import { announcementSettingsOf, type CardIdentity } from "@/lib/chat/announcement";

/** What a message needs to render as an announcement card: the channel's settings and the space it posts as. */
export interface AnnouncementCardContext {
  settings: AnnouncementSettings;
  space: CardIdentity | null;
}

/**
 * The announcement settings of a channel, followed live from the local database (ChannelModifiedV2
 * lands there), and the space's name and avatar for "post as space". Null settings: not an
 * announcement channel.
 */
export function useAnnouncementChannel(channelId: () => string | null | undefined, spaceId: () => string | null | undefined) {
  const channel = ref<ArgonChannel | null>(null);
  const space = ref<ArgonSpaceBase | null>(null);
  let channelSub: Subscription | null = null;
  let spaceSub: Subscription | null = null;

  watch(
    channelId,
    (id) => {
      channelSub?.unsubscribe();
      channelSub = null;
      channel.value = null;
      if (!id) return;
      channelSub = liveQuery(() => db.channels.get(id)).subscribe({
        next: (row) => {
          channel.value = row ?? null;
        },
        error: (e) => logger.error("[Announcement] channel query failed", e),
      });
    },
    { immediate: true },
  );

  watch(
    spaceId,
    (id) => {
      spaceSub?.unsubscribe();
      spaceSub = null;
      space.value = null;
      if (!id) return;
      spaceSub = liveQuery(() => db.servers.where("spaceId").equals(id).first()).subscribe({
        next: (row) => {
          space.value = row ?? null;
        },
        error: (e) => logger.error("[Announcement] space query failed", e),
      });
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    channelSub?.unsubscribe();
    spaceSub?.unsubscribe();
  });

  const settings = computed<AnnouncementSettings | null>(() =>
    channel.value?.type === ChannelType.Announcement ? announcementSettingsOf(channel.value.announcement) : null,
  );

  const card = computed<AnnouncementCardContext | null>(() => {
    if (!settings.value) return null;
    const s = space.value;
    return {
      settings: settings.value,
      space: s ? { name: s.name, avatarFileId: s.avatarFieldId || null } : null,
    };
  });

  /** Reactions are turned off here: nobody adds one, taking yours back still works. */
  const reactionsOff = computed(() => settings.value?.reactions === false);

  return { settings, card, reactionsOff };
}
