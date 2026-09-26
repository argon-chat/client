/**
 * What the chat view learns about an announcement channel: its settings (the server's defaults when
 * the row carries none), whether reactions are off, and the space a post can be shown under. A text
 * channel yields nothing, which is what keeps its messages out of the card view.
 */

import { describe, test, expect, vi } from "vitest";
import { effectScope, nextTick } from "vue";

const h = vi.hoisted(() => ({
  channels: new Map<string, any>(),
  space: null as any,
}));

vi.mock("@argon/core", () => ({ logger: { error() {} } }));
vi.mock("dexie", () => ({
  liveQuery: (query: () => Promise<unknown>) => ({
    subscribe: ({ next }: { next: (v: unknown) => void }) => {
      void query().then(next);
      return { unsubscribe() {} };
    },
  }),
}));
vi.mock("@/store/db/dexie", () => ({
  db: {
    channels: { get: async (id: string) => h.channels.get(id) },
    servers: { where: () => ({ equals: () => ({ first: async () => h.space }) }) },
  },
}));

import { ChannelType } from "@argon/glue";
import { useAnnouncementChannel } from "@/composables/useAnnouncementChannel";

async function use(channelId: string) {
  const scope = effectScope();
  const result = scope.run(() => useAnnouncementChannel(() => channelId, () => "s1"))!;
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  return result;
}

describe("useAnnouncementChannel", () => {
  test("a text channel has no announcement settings and no card", async () => {
    h.channels.set("text", { channelId: "text", type: ChannelType.Text, announcement: null });
    const a = await use("text");
    expect(a.settings.value).toBeNull();
    expect(a.card.value).toBeNull();
    expect(a.reactionsOff.value).toBe(false);
  });

  test("an announcement channel without stored settings gets the defaults", async () => {
    h.channels.set("news", { channelId: "news", type: ChannelType.Announcement, announcement: null });
    h.space = { spaceId: "s1", name: "Guild", avatarFieldId: "guild.png" };
    const a = await use("news");
    expect(a.settings.value).toEqual({ reactions: true, postAsSpace: false, showAuthor: true });
    expect(a.card.value?.space).toEqual({ name: "Guild", avatarFileId: "guild.png" });
  });

  test("reactions off is read from the row", async () => {
    h.channels.set("quiet", {
      channelId: "quiet",
      type: ChannelType.Announcement,
      announcement: { reactions: false, postAsSpace: true, showAuthor: false },
    });
    const a = await use("quiet");
    expect(a.reactionsOff.value).toBe(true);
    expect(a.card.value?.settings.postAsSpace).toBe(true);
  });
});
