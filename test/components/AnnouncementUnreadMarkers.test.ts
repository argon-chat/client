/**
 * The stronger unread markers for announcement channels.
 *
 * In the channel list an unread announcement channel gets an accent name and a NEW pill where a
 * plain channel gets a dot; a mention badge still wins the slot. In the spaces rail a space with an
 * unread announcement channel gets an accent ring around its icon, next to (not instead of) the
 * mention badge. A muted channel or space shows neither, like the plain dot.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const h = await vi.hoisted(async () => {
  const { reactive, ref } = await import("vue");
  return {
    readStates: reactive(new Map<string, bigint>()),
    mentions: reactive(new Map<string, number>()),
    mutes: reactive(new Map<string, number>()),
    badges: reactive(new Map<string, { totalMentions: number; unreadChannelCount: number }>()),
    rows: [] as any[],
    splitButton: ref(false),
  };
});

const ntf = {
  isChannelUnread: (channelId: string, last: bigint) =>
    h.readStates.has(channelId) ? last > h.readStates.get(channelId)! : last > 0n,
  effectiveMuteLevel: (channelId: string, spaceId: string) => h.mutes.get(channelId) ?? h.mutes.get(spaceId) ?? 0,
  channelMentionCount: (channelId: string) => h.mentions.get(channelId) ?? 0,
  isTargetMuted: (id: string) => (h.mutes.get(id) ?? 0) !== 0,
  getSpaceBadge: (spaceId: string) => h.badges.get(spaceId),
  muteTarget: async () => {},
  unmuteTarget: async () => {},
};

vi.mock("@/store/data/notificationStore", () => ({ useNotificationStore: () => ntf }));
vi.mock("dexie", () => ({
  liveQuery: (fn: () => unknown) => ({
    subscribe: ({ next }: { next: (v: unknown) => void }) => {
      void Promise.resolve(fn()).then(next);
      return { unsubscribe() {} };
    },
  }),
}));
vi.mock("@/store/db/dexie", () => ({
  db: { channels: { filter: (fn: (c: any) => boolean) => ({ toArray: async () => h.rows.filter(fn) }) } },
}));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    has: () => false,
    hasIn: () => true,
    hasInSpace: () => false,
    gate: () => "hidden",
  }),
}));
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ channelInteraction: {} }) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/media/unifiedCallStore", () => ({
  useUnifiedCall: () => ({ connectedVoiceChannelId: null, isConnected: false, participants: {}, radio: { onAir: [], transmitting: false, busyBy: null } }),
}));
vi.mock("@/store/data/serverStore", () => ({ useSpaceStore: () => ({ duplicateChannel: async () => null }) }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openChannelSettings: () => {} }) }));
vi.mock("@/composables/useSplitView", () => ({ canButton: h.splitButton, canCtrlClick: h.splitButton, splitEnabled: h.splitButton }));
vi.mock("@/composables/useVoiceModeration", () => ({ useVoiceModeration: () => ({}) }));
vi.mock("@/lib/telemetry/metrics", () => ({ enumName: () => "x" }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} }, cn: (...c: unknown[]) => c.filter(Boolean).join(" ") }));
vi.mock("@/components/channels/VoiceChannelUser.vue", () => ({ default: { name: "VoiceChannelUser", setup: () => () => null } }));
vi.mock("@/components/audio/VolumeSlider.vue", () => ({ default: { name: "VolumeSlider", setup: () => () => null } }));
vi.mock("@/components/ArgonAvatar.vue", () => ({ default: { name: "ArgonAvatar", setup: () => () => null } }));
vi.mock("@argon/ui/tooltip", async () => {
  const { h: hh, defineComponent } = await import("vue");
  const pass = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => hh("div", slots.default?.()) });
  return { Tooltip: pass("Tooltip"), TooltipTrigger: pass("TooltipTrigger"), TooltipContent: pass("TooltipContent") };
});
vi.mock("@argon/ui/context-menu", async () => {
  const { h: hh, defineComponent } = await import("vue");
  const pass = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => hh("div", slots.default?.()) });
  return {
    ContextMenu: pass("ContextMenu"),
    ContextMenuTrigger: pass("ContextMenuTrigger"),
    ContextMenuContent: pass("ContextMenuContent"),
    ContextMenuItem: pass("ContextMenuItem"),
    ContextMenuSeparator: pass("ContextMenuSeparator"),
    ContextMenuShortcut: pass("ContextMenuShortcut"),
    ContextMenuLabel: pass("ContextMenuLabel"),
    ContextMenuSub: pass("ContextMenuSub"),
    ContextMenuSubTrigger: pass("ContextMenuSubTrigger"),
    ContextMenuSubContent: pass("ContextMenuSubContent"),
  };
});

import { ChannelType } from "@argon/glue";
import ChannelItem from "@/components/ChannelItem.vue";
import ServerRailIcon from "@/components/ServerRailIcon.vue";
import { useAnnouncementStore } from "@/store/data/announcementStore";

const channel = (channelId: string, type: ChannelType, lastMessageId = 10n, spaceId = "s1") =>
  ({ channelId, spaceId, name: channelId, type, groupId: null, lastMessageId, broadcast: null }) as any;

const row = (ch: any) =>
  mount(ChannelItem, { props: { channel: ch, groupId: null, index: 0, isActive: false, isDragOver: false } });

beforeEach(() => {
  setActivePinia(createPinia());
  h.readStates.clear();
  h.mentions.clear();
  h.mutes.clear();
  h.badges.clear();
  h.rows = [];
});

describe("an announcement channel in the sidebar", () => {
  test("unread: accent name and a NEW pill instead of the dot", () => {
    h.readStates.set("news", 5n);
    const w = row(channel("news", ChannelType.Announcement));

    expect(w.find('[data-testid="announcement-new"]').text()).toBe("announcement_new");
    expect(w.find(".unread-dot").exists()).toBe(false);
    expect(w.find("span.announcement-accent").text()).toBe("news");
  });

  test("read: no pill, no accent", () => {
    h.readStates.set("news", 10n);
    const w = row(channel("news", ChannelType.Announcement));

    expect(w.find('[data-testid="announcement-new"]').exists()).toBe(false);
    expect(w.find(".announcement-accent").exists()).toBe(false);
  });

  test("a mention badge keeps its look and its place over the pill", () => {
    h.readStates.set("news", 5n);
    h.mentions.set("news", 3);
    const w = row(channel("news", ChannelType.Announcement));

    expect(w.find(".bg-destructive").text()).toBe("3");
    expect(w.find('[data-testid="announcement-new"]').exists()).toBe(false);
  });

  test("muted: nothing", () => {
    h.mutes.set("news", 2);
    const w = row(channel("news", ChannelType.Announcement));

    expect(w.find('[data-testid="announcement-new"]').exists()).toBe(false);
    expect(w.find(".announcement-accent").exists()).toBe(false);
  });

  test("an unread text channel keeps the plain dot", () => {
    const w = row(channel("general", ChannelType.Text));

    expect(w.find(".unread-dot").exists()).toBe(true);
    expect(w.find('[data-testid="announcement-new"]').exists()).toBe(false);
  });
});

describe("the spaces rail", () => {
  const icon = async (spaceId: string) => {
    const w = mount(ServerRailIcon, { props: { server: { spaceId, name: "Space", avatarFieldId: null } as any } });
    await flushPromises();
    return w;
  };
  const ringed = (w: ReturnType<typeof mount>) => w.find(".rail-avatar").attributes("data-announcement") !== undefined;

  test("rings a space with an unread announcement channel", async () => {
    h.rows = [channel("news", ChannelType.Announcement, 10n, "s1")];

    expect(ringed(await icon("s1"))).toBe(true);
  });

  test("no ring when the announcements are read or the unread channel is not one", async () => {
    h.rows = [channel("news", ChannelType.Announcement, 10n, "s1"), channel("general", ChannelType.Text, 10n, "s1")];
    h.readStates.set("news", 10n);

    expect(ringed(await icon("s1"))).toBe(false);
  });

  test("no ring for a muted space", async () => {
    h.rows = [channel("news", ChannelType.Announcement, 10n, "s1")];
    h.mutes.set("s1", 2);

    expect(ringed(await icon("s1"))).toBe(false);
  });

  test("the mention badge stays alongside the ring", async () => {
    h.rows = [channel("news", ChannelType.Announcement, 10n, "s1")];
    h.badges.set("s1", { totalMentions: 2, unreadChannelCount: 1 });
    const w = await icon("s1");

    expect(ringed(w)).toBe(true);
    expect(w.find(".rail-badge").text()).toBe("2");
  });

  test("the store tells spaces apart", async () => {
    h.rows = [
      channel("news", ChannelType.Announcement, 10n, "s1"),
      channel("read", ChannelType.Announcement, 10n, "s2"),
    ];
    h.readStates.set("read", 10n);
    const store = useAnnouncementStore();
    store.hasUnreadIn("s1");
    await flushPromises();

    expect(store.hasUnreadIn("s1")).toBe(true);
    expect(store.hasUnreadIn("s2")).toBe(false);

    h.readStates.set("news", 10n);
    expect(store.hasUnreadIn("s1")).toBe(false);
  });
});
