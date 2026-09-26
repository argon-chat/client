import { ChannelType, MuteLevelType, type ArgonChannel, type ArgonMessage } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

/** What the unread rules need from the notification store. */
export interface UnreadProbe {
  isChannelUnread(channelId: Guid, lastMessageId: bigint): boolean;
  effectiveMuteLevel(channelId: Guid, spaceId: Guid): MuteLevelType;
}

type ChannelRef = Pick<ArgonChannel, "type" | "channelId" | "spaceId" | "lastMessageId">;

/**
 * An announcement channel with a post the user has not read. A muted channel (or space) never
 * counts, at either mute level, matching the plain unread dot in the sidebar.
 */
export function isAnnouncementUnread(channel: ChannelRef, probe: UnreadProbe): boolean {
  if (channel.type !== ChannelType.Announcement) return false;
  if (probe.effectiveMuteLevel(channel.channelId, channel.spaceId) !== MuteLevelType.None) return false;
  return probe.isChannelUnread(channel.channelId, channel.lastMessageId);
}

/** The spaces holding at least one unread announcement channel. */
export function spacesWithUnreadAnnouncements(channels: readonly ChannelRef[], probe: UnreadProbe): Set<Guid> {
  const spaces = new Set<Guid>();
  for (const channel of channels) {
    if (!spaces.has(channel.spaceId) && isAnnouncementUnread(channel, probe)) spaces.add(channel.spaceId);
  }
  return spaces;
}

export interface BannerInput {
  spaceId: Guid | null | undefined;
  /** `ArgonSpaceBase.mainAnnouncementChannelId` of that space. */
  mainChannelId: Guid | null | undefined;
  /** The stored row of the main channel, if the client has it. */
  channel: ChannelRef | null | undefined;
  /** The channel open in the primary pane: reading it there is what the banner asks for. */
  openChannelId: Guid | null | undefined;
}

/**
 * Whether the banner is due: a main announcement channel is set, is still an announcement channel
 * of this space the client knows, is not the one being read right now, and has an unread post.
 *
 * There is no separate "dismissed" state: Dismiss acks the channel, which makes it read.
 */
export function isBannerDue(input: BannerInput, probe: UnreadProbe): boolean {
  const { spaceId, mainChannelId, channel, openChannelId } = input;
  if (!spaceId || !mainChannelId || !channel) return false;
  if (channel.channelId !== mainChannelId || channel.spaceId !== spaceId) return false;
  if (openChannelId === mainChannelId) return false;
  return isAnnouncementUnread(channel, probe);
}

/** The newest message of a page, whatever order it came in. */
export function newestMessage(messages: Iterable<ArgonMessage>): ArgonMessage | null {
  let newest: ArgonMessage | null = null;
  for (const m of messages) if (!newest || m.messageId > newest.messageId) newest = m;
  return newest;
}

/**
 * How far Dismiss acks: the shown post, or the channel's high-water mark when that is further on
 * (the newest post was deleted, or one arrived since). Acking less would leave the channel unread
 * and the banner up.
 */
export function dismissUpTo(message: Pick<ArgonMessage, "messageId">, channel: Pick<ArgonChannel, "lastMessageId">): bigint {
  return message.messageId > channel.lastMessageId ? message.messageId : channel.lastMessageId;
}

const PREVIEW_LINES = 2;
const PREVIEW_CHARS = 280;

/** The first two non-empty lines of a post, capped; the card clamps visually as well. */
export function previewText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, PREVIEW_LINES)
    .join("\n");
  return lines.length > PREVIEW_CHARS ? `${lines.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : lines;
}

/** Time of day for a post from today, date and time otherwise (year only when it differs). */
export function bannerTime(sent: Date, now: Date = new Date(), locale?: string): string {
  const sameDay = sent.toDateString() === now.toDateString();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        ...(sent.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
      };
  try {
    return new Intl.DateTimeFormat(locale, options).format(sent);
  } catch {
    // App locale codes such as "ru_pt" are not BCP 47 tags.
    return new Intl.DateTimeFormat(undefined, options).format(sent);
  }
}
