/**
 * The sidebar's broadcast marks.
 *
 * A broadcast channel (voice with a `broadcast` object) shows a radio tower instead of the speaker
 * icon and a LIVE pill while anyone is on its radio — heard from a target room, or, when I sit in
 * it myself, while I or another member transmits. A channel some broadcast channel lists as a target
 * gets a small glyph naming whose radio it hears. Nothing of this touches an ordinary voice channel.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

const h = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  return {
    voice: reactive({
      connectedVoiceChannelId: null as string | null,
      isConnected: false,
      participants: {},
      radio: {
        onAir: [] as { userId: string; hqChannelId: string | null }[],
        transmitting: false,
        busyBy: null as string | null,
      },
    }),
  };
});

vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    has: () => true,
    hasIn: () => true,
    hasInSpace: () => true,
    gate: () => "allowed",
  }),
}));
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ channelInteraction: {} }) }));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => h.voice }));
vi.mock("@/store/data/notificationStore", () => ({
  useNotificationStore: () => ({
    effectiveMuteLevel: () => 0,
    isChannelUnread: () => false,
    channelMentionCount: () => 0,
    isTargetMuted: () => false,
    muteTarget: async () => {},
    unmuteTarget: async () => {},
  }),
}));
vi.mock("@/store/data/serverStore", () => ({ useSpaceStore: () => ({ duplicateChannel: async () => null }) }));
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openChannelSettings: () => {} }) }));
vi.mock("@/composables/useSplitView", async () => {
  const { ref } = await import("vue");
  return { canButton: ref(false), canCtrlClick: ref(false), splitEnabled: ref(false) };
});
vi.mock("@/composables/useVoiceModeration", () => ({
  useVoiceModeration: () => ({ moveMember: async () => true, setServerMuted: async () => true, setServerDeafened: async () => true }),
}));
vi.mock("@/lib/telemetry/metrics", () => ({ enumName: () => "x" }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/components/channels/VoiceChannelUser.vue", () => ({ default: { name: "VoiceChannelUser", setup: () => () => null } }));
vi.mock("@/components/audio/VolumeSlider.vue", () => ({ default: { name: "VolumeSlider", setup: () => () => null } }));
vi.mock("@argon/ui/context-menu", async () => {
  const { h: hh, defineComponent } = await import("vue");
  const pass = (name: string) =>
    defineComponent({ name, setup: (_, { slots }) => () => hh("div", { class: `stub-${name}` }, slots.default?.()) });
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

const settings = (targets: string[]) => ({ targets, overlap: 0, duckingDb: -8, maxTransmitSeconds: 120, chirp: false });

const channel = (channelId: string, extra: Record<string, unknown> = {}) =>
  ({ channelId, spaceId: "s1", name: channelId, type: ChannelType.Voice, groupId: null, broadcast: null, ...extra }) as any;

const hq = channel("hq", { broadcast: settings(["party1", "party2"]) });
const party1 = channel("party1");
const party2 = channel("party2");
const lobby = channel("lobby");
const voiceChannels = [hq, party1, party2, lobby];

function render(ch: any) {
  return mount(ChannelItem, {
    props: { channel: ch, groupId: null, index: 0, isActive: false, isDragOver: false, voiceChannels },
  });
}

beforeEach(() => {
  h.voice.connectedVoiceChannelId = null;
  h.voice.radio.onAir = [];
  h.voice.radio.transmitting = false;
  h.voice.radio.busyBy = null;
});

describe("a broadcast channel", () => {
  test("shows the radio tower instead of the speaker, and is addressable by id", () => {
    const w = render(hq);
    expect(w.find('[data-testid="broadcast-icon"]').exists()).toBe(true);
    expect(w.find(".channel-item").attributes("data-broadcast")).toBeDefined();
    expect(w.find(".channel-item").attributes("data-channel-id")).toBe("hq");
    expect(w.find('[data-testid="live-pill"]').exists()).toBe(false);
    expect(w.find('[data-testid="radio-target"]').exists()).toBe(false);
  });

  test("goes LIVE while its radio is audible in my room", async () => {
    const w = render(hq);
    h.voice.radio.onAir = [{ userId: "alice", hqChannelId: "hq" }];
    await w.vm.$nextTick();
    expect(w.find('[data-testid="live-pill"]').text()).toBe("broadcast_live");
    expect(w.find(".channel-item").attributes("data-live")).toBeDefined();
  });

  test("another channel's radio does not light it", async () => {
    const w = render(hq);
    h.voice.radio.onAir = [{ userId: "alice", hqChannelId: "other-hq" }];
    await w.vm.$nextTick();
    expect(w.find('[data-testid="live-pill"]').exists()).toBe(false);
  });

  test("goes LIVE while I transmit from it, and only from it", async () => {
    const w = render(hq);
    h.voice.radio.transmitting = true;
    await w.vm.$nextTick();
    expect(w.find('[data-testid="live-pill"]').exists()).toBe(false);

    h.voice.connectedVoiceChannelId = "hq";
    await w.vm.$nextTick();
    expect(w.find('[data-testid="live-pill"]').exists()).toBe(true);
  });

  test("goes LIVE while another member of my HQ is on air", async () => {
    h.voice.connectedVoiceChannelId = "hq";
    const w = render(hq);
    h.voice.radio.busyBy = "bob";
    await w.vm.$nextTick();
    expect(w.find('[data-testid="live-pill"]').exists()).toBe(true);
  });
});

describe("a target", () => {
  test("gets the glyph naming whose radio it hears", () => {
    const w = render(party1);
    const glyph = w.find('[data-testid="radio-target"]');
    expect(glyph.exists()).toBe(true);
    expect(glyph.attributes("title")).toBe('broadcast_hears_radio_of:{"name":"hq"}');
    expect(w.find('[data-testid="broadcast-icon"]').exists()).toBe(false);
  });

  test("never shows LIVE itself, even while the radio plays in it", async () => {
    h.voice.connectedVoiceChannelId = "party1";
    const w = render(party1);
    h.voice.radio.onAir = [{ userId: "alice", hqChannelId: "hq" }];
    await w.vm.$nextTick();
    expect(w.find('[data-testid="live-pill"]').exists()).toBe(false);
  });

  test("names every broadcast channel that lists it", () => {
    const hq2 = channel("hq2", { broadcast: settings(["party1"]) });
    const w = mount(ChannelItem, {
      props: { channel: party1, groupId: null, index: 0, isActive: false, isDragOver: false, voiceChannels: [hq, hq2, party1] },
    });
    expect(w.find('[data-testid="radio-target"]').attributes("title")).toBe('broadcast_hears_radio_of:{"name":"hq, hq2"}');
  });
});

describe("an ordinary voice channel", () => {
  test("shows neither mark", () => {
    const w = render(lobby);
    expect(w.find('[data-testid="broadcast-icon"]').exists()).toBe(false);
    expect(w.find('[data-testid="radio-target"]').exists()).toBe(false);
    expect(w.find('[data-testid="live-pill"]').exists()).toBe(false);
  });

  test("with no channel list at all, nothing breaks", () => {
    const w = mount(ChannelItem, {
      props: { channel: party1, groupId: null, index: 0, isActive: false, isDragOver: false },
    });
    expect(w.find('[data-testid="radio-target"]').exists()).toBe(false);
  });
});
