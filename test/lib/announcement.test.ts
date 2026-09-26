import { describe, expect, it } from "vitest";
import {
  ArgonEntitlement,
  EntityType,
  MessageEntityAttachment,
  MessageEntityBold,
  type ChannelEntitlementOverwrite,
} from "@argon/glue";
import {
  COLLAPSE_CHARS,
  COLLAPSE_LINES,
  announcementSettingsOf,
  cardHeader,
  cardMedia,
  composerLimits,
  formatCardDate,
  publisherRoleIds,
  publishingChange,
  shouldCollapse,
} from "@/lib/chat/announcement";

const file = (id: string, name: string, contentType: string) =>
  new MessageEntityAttachment(EntityType.Attachment, 0, 0, 1, id, name, 1024n, contentType, 640, 360, null, null);

const SEND = BigInt(ArgonEntitlement.SendMessages);
const ATTACH = BigInt(ArgonEntitlement.AttachFiles);

const overwrite = (archetypeId: string | null, allow: bigint, deny: bigint, id = `ow-${archetypeId}`): ChannelEntitlementOverwrite => ({
  channelId: "c1",
  archetypeId,
  serverMemberId: null,
  allow: allow as unknown as ArgonEntitlement,
  deny: deny as unknown as ArgonEntitlement,
  creatorId: "u1",
  id,
});

/** "Read more": a post starts collapsed past ~800 characters or ~12 lines, not a character earlier. */
describe("shouldCollapse", () => {
  it("leaves short posts open", () => {
    expect(shouldCollapse("")).toBe(false);
    expect(shouldCollapse(null)).toBe(false);
    expect(shouldCollapse("Raid tonight at 20:00")).toBe(false);
  });

  it("collapses past the character threshold", () => {
    expect(shouldCollapse("a".repeat(COLLAPSE_CHARS))).toBe(false);
    expect(shouldCollapse("a".repeat(COLLAPSE_CHARS + 1))).toBe(true);
  });

  it("collapses past the line threshold even when the text is short", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `${i}`).join("\n");
    expect(shouldCollapse(lines(COLLAPSE_LINES))).toBe(false);
    expect(shouldCollapse(lines(COLLAPSE_LINES + 1))).toBe(true);
  });
});

/** The cover is the first image; everything else keeps rendering the way chat renders it. */
describe("cardMedia", () => {
  it("takes the first image as the cover and keeps the rest in order", () => {
    const a = file("a", "a.png", "image/png");
    const b = file("b", "b.jpg", "image/jpeg");
    const c = file("c", "c.webp", "application/octet-stream");
    const doc = file("d", "notes.pdf", "application/pdf");

    const media = cardMedia([doc, new MessageEntityBold(EntityType.Bold, 0, 1, 1), a, b, c]);

    expect(media.cover?.fileId).toBe("a");
    expect(media.images.map((i) => i.fileId)).toEqual(["b", "c"]);
    expect(media.files.map((f) => f.fileId)).toEqual(["d"]);
  });

  it("has no cover when the post has no image", () => {
    const media = cardMedia([file("d", "notes.pdf", "application/pdf")]);
    expect(media.cover).toBeNull();
    expect(media.images).toEqual([]);
    expect(cardMedia(null).cover).toBeNull();
  });
});

describe("cardHeader", () => {
  const author = { name: "Alice", avatarFileId: "alice.png" };
  const space = { name: "Guild", avatarFileId: "guild.png" };

  it("shows the author by default", () => {
    expect(cardHeader({ reactions: true, postAsSpace: false, showAuthor: true }, author, space)).toEqual({
      asSpace: false, title: "Alice", avatarFileId: "alice.png", byline: null,
    });
  });

  it("shows the space with a byline when post as space and show author are on", () => {
    expect(cardHeader({ reactions: true, postAsSpace: true, showAuthor: true }, author, space)).toEqual({
      asSpace: true, title: "Guild", avatarFileId: "guild.png", byline: "Alice",
    });
  });

  it("hides the author entirely when show author is off", () => {
    const header = cardHeader({ reactions: true, postAsSpace: true, showAuthor: false }, author, space);
    expect(header.title).toBe("Guild");
    expect(header.byline).toBeNull();
  });

  it("falls back to the author while the space is not known yet", () => {
    expect(cardHeader({ reactions: true, postAsSpace: true, showAuthor: true }, author, null).title).toBe("Alice");
  });
});

describe("composerLimits", () => {
  it("is 2000, or 4000 with premium", () => {
    expect(composerLimits(false).limit).toBe(2000);
    expect(composerLimits(true).limit).toBe(4000);
  });

  it("orders its thresholds below the limit", () => {
    for (const l of [composerLimits(false), composerLimits(true)]) {
      expect(l.counterFrom).toBeLessThan(l.warn);
      expect(l.warn).toBeLessThan(l.danger);
      expect(l.danger).toBeLessThan(l.limit);
    }
  });
});

describe("announcementSettingsOf", () => {
  it("defaults like the server when a channel carries none", () => {
    expect(announcementSettingsOf(null)).toEqual({ reactions: true, postAsSpace: false, showAuthor: true });
  });
});

describe("formatCardDate", () => {
  const at = new Date(2026, 8, 26, 14, 5);

  it("uses the 24h clock unless asked otherwise", () => {
    expect(formatCardDate(at, false, "en-GB")).toBe("26 September 2026 · 14:05");
    expect(formatCardDate(at, true, "en-GB")).toBe("26 September 2026 · 2:05 PM");
  });
});

/** Publishers are roles whose overwrite allows SendMessages; the tab adds and removes only that bit. */
describe("publishers", () => {
  it("lists roles whose overwrite allows posting and does not deny it", () => {
    const ids = publisherRoleIds([
      overwrite("herald", SEND, 0n),
      overwrite("everyone", 0n, SEND),
      overwrite("muted", SEND, SEND),
      overwrite("files", ATTACH, 0n),
      overwrite(null, SEND, 0n),
    ]);
    expect([...ids]).toEqual(["herald"]);
  });

  it("allows posting on a new overwrite", () => {
    expect(publishingChange(undefined, true)).toEqual({ allow: SEND, deny: 0n, remove: false });
  });

  it("keeps the other bits and lifts a deny when a role is let through", () => {
    expect(publishingChange(overwrite("r", ATTACH, SEND), true)).toEqual({ allow: ATTACH | SEND, deny: 0n, remove: false });
  });

  it("deletes an overwrite that only allowed posting", () => {
    expect(publishingChange(overwrite("r", SEND, 0n), false)).toEqual({ allow: 0n, deny: 0n, remove: true });
  });

  it("keeps an overwrite that still says something else", () => {
    expect(publishingChange(overwrite("r", SEND | ATTACH, 0n), false)).toEqual({ allow: ATTACH, deny: 0n, remove: false });
  });
});
