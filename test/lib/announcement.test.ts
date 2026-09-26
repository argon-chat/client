import { describe, expect, it } from "vitest";
import {
  ArgonEntitlement,
  type ChannelEntitlementOverwrite,
} from "@argon/glue";
import {
  announcementSettingsOf,
  cardHeader,
  composerLimits,
  publisherRoleIds,
  publishingChange,
} from "@/lib/chat/announcement";

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
