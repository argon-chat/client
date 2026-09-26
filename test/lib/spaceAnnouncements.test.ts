import { describe, expect, it } from "vitest";
import { ChannelType, MuteLevelType } from "@argon/glue";
import {
  bannerTime,
  dismissUpTo,
  isAnnouncementUnread,
  isBannerDue,
  newestMessage,
  previewText,
  spacesWithUnreadAnnouncements,
  type UnreadProbe,
} from "@/lib/announcements/spaceAnnouncements";

/**
 * The rules behind the latest-announcement banner and the stronger unread markers. The read state is
 * the notification store's, stood in for here by a probe with the same semantics: no read state at
 * all counts as unread once the channel has any message, which is what a member who just joined has.
 */
function probe(read: Record<string, bigint> = {}, mutes: Record<string, MuteLevelType> = {}): UnreadProbe {
  return {
    isChannelUnread: (channelId, lastMessageId) =>
      channelId in read ? lastMessageId > read[channelId] : lastMessageId > 0n,
    effectiveMuteLevel: (channelId, spaceId) => mutes[channelId] ?? mutes[spaceId] ?? MuteLevelType.None,
  };
}

const news = (over: Partial<{ channelId: string; spaceId: string; type: ChannelType; lastMessageId: bigint }> = {}) => ({
  channelId: "news",
  spaceId: "s1",
  type: ChannelType.Announcement,
  lastMessageId: 10n,
  ...over,
});

describe("isAnnouncementUnread", () => {
  it("is an announcement channel whose newest post is past the read mark", () => {
    expect(isAnnouncementUnread(news(), probe({ news: 9n }))).toBe(true);
    expect(isAnnouncementUnread(news(), probe({ news: 10n }))).toBe(false);
  });

  it("counts a channel the member never read as unread, and an empty one as read", () => {
    expect(isAnnouncementUnread(news(), probe())).toBe(true);
    expect(isAnnouncementUnread(news({ lastMessageId: 0n }), probe())).toBe(false);
  });

  it("never marks a text or voice channel", () => {
    expect(isAnnouncementUnread(news({ type: ChannelType.Text }), probe())).toBe(false);
    expect(isAnnouncementUnread(news({ type: ChannelType.Voice }), probe())).toBe(false);
  });

  it("stays quiet in a muted channel or space, at either level", () => {
    expect(isAnnouncementUnread(news(), probe({}, { news: MuteLevelType.All }))).toBe(false);
    expect(isAnnouncementUnread(news(), probe({}, { news: MuteLevelType.OnlyMentions }))).toBe(false);
    expect(isAnnouncementUnread(news(), probe({}, { s1: MuteLevelType.All }))).toBe(false);
  });
});

describe("spacesWithUnreadAnnouncements", () => {
  it("names each space with at least one unread announcement channel", () => {
    const channels = [
      news(),
      news({ channelId: "news2", spaceId: "s1" }),
      news({ channelId: "read", spaceId: "s2" }),
      news({ channelId: "chat", spaceId: "s3", type: ChannelType.Text }),
    ];
    const spaces = spacesWithUnreadAnnouncements(channels, probe({ read: 10n }));
    expect([...spaces]).toEqual(["s1"]);
  });
});

describe("isBannerDue", () => {
  const base = { spaceId: "s1", mainChannelId: "news", channel: news(), openChannelId: "general" };

  it("is due while the main channel's newest post is unread", () => {
    expect(isBannerDue(base, probe({ news: 9n }))).toBe(true);
  });

  it("is not due once the post is read — which is what Dismiss does", () => {
    expect(isBannerDue(base, probe({ news: 10n }))).toBe(false);
  });

  it("is not due when the space has no main announcement channel", () => {
    expect(isBannerDue({ ...base, mainChannelId: null }, probe())).toBe(false);
    expect(isBannerDue({ ...base, mainChannelId: undefined }, probe())).toBe(false);
  });

  it("is due for a member who just joined and has no read state for it", () => {
    expect(isBannerDue(base, probe())).toBe(true);
  });

  it("stays out of the way while the channel itself is open", () => {
    expect(isBannerDue({ ...base, openChannelId: "news" }, probe())).toBe(false);
  });

  it("is not due for a channel the client does not have, of another space, or no longer an announcement channel", () => {
    expect(isBannerDue({ ...base, channel: undefined }, probe())).toBe(false);
    expect(isBannerDue({ ...base, channel: news({ spaceId: "s2" }) }, probe())).toBe(false);
    expect(isBannerDue({ ...base, channel: news({ type: ChannelType.Text }) }, probe())).toBe(false);
    expect(isBannerDue({ ...base, spaceId: null }, probe())).toBe(false);
  });

  it("is not due when the member muted the channel", () => {
    expect(isBannerDue(base, probe({}, { news: MuteLevelType.All }))).toBe(false);
  });
});

describe("the post and how far Dismiss acks", () => {
  const message = (messageId: bigint) => ({ messageId }) as any;

  it("takes the newest message of a page, whatever its order", () => {
    expect(newestMessage([message(3n), message(9n), message(5n)])?.messageId).toBe(9n);
    expect(newestMessage([])).toBeNull();
  });

  it("acks to the channel's high-water mark when it is past the shown post", () => {
    expect(dismissUpTo(message(8n), { lastMessageId: 10n })).toBe(10n);
    expect(dismissUpTo(message(10n), { lastMessageId: 10n })).toBe(10n);
    expect(dismissUpTo(message(12n), { lastMessageId: 10n })).toBe(12n);
  });
});

describe("previewText", () => {
  it("keeps the first two non-empty lines", () => {
    expect(previewText("Patch 1.2\n\n  is out  \nwith fixes\nand more")).toBe("Patch 1.2\nis out");
  });

  it("caps a long line", () => {
    const text = previewText("x".repeat(500));
    expect(text.length).toBe(280);
    expect(text.endsWith("…")).toBe(true);
  });

  it("is empty for a post with no text", () => {
    expect(previewText("   \n ")).toBe("");
  });
});

describe("bannerTime", () => {
  const now = new Date(2026, 8, 26, 18, 30);

  it("shows only the time for a post from today", () => {
    const text = bannerTime(new Date(2026, 8, 26, 9, 5), now, "en-GB");
    expect(text).toBe("09:05");
  });

  it("adds the date for an older post, and the year only when it differs", () => {
    expect(bannerTime(new Date(2026, 8, 20, 9, 5), now, "en-GB")).toContain("20 Sept");
    expect(bannerTime(new Date(2026, 8, 20, 9, 5), now, "en-GB")).not.toContain("2026");
    expect(bannerTime(new Date(2025, 11, 31, 9, 5), now, "en-GB")).toContain("2025");
  });

  it("falls back to the default locale for an app code that is not a language tag", () => {
    expect(() => bannerTime(new Date(2026, 8, 26, 9, 5), now, "ru_pt")).not.toThrow();
  });
});
