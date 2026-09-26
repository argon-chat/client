/**
 * A channel row and its menus, gated per channel.
 *
 * Joining a voice channel without Connect used to go all the way to the server and come back as an
 * error toast. The row now knows: a voice channel the user may not enter is shown locked, says why,
 * and a click does nothing — so nothing reaches ChatList, the call store or Interlink. The menus
 * follow one rule: what nothing in the space grants is left out, what the space grants but this
 * channel's overwrite takes away is shown disabled with the reason.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

const h = await vi.hoisted(async () => {
  const { reactive, ref } = await import("vue");
  return {
    // Space-level grants, and per-channel grants (a channel absent here has none).
    space: new Set<string>(),
    channels: new Map<string, Set<string>>(),
    voice: reactive({
      connectedVoiceChannelId: null as string | null,
      isConnected: false,
      participants: {},
      radio: { onAir: [] as { userId: string; hqChannelId: string | null }[], transmitting: false, busyBy: null as string | null },
    }),
    openChannelSettings: (..._a: unknown[]) => {},
    splitButton: ref(true),
    splitCtrl: ref(true),
  };
});

const hasIn = (channelId: string, flag: string) => h.channels.get(channelId)?.has(flag) ?? false;

vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({
    has: (flag: string) => h.space.has(flag),
    hasIn: (channelId: string, flag: string) => hasIn(channelId, flag),
    hasInSpace: (_spaceId: string, flag: string) => h.space.has(flag),
    gate: (channelId: string, flag: string) =>
      hasIn(channelId, flag) ? "allowed" : h.space.has(flag) ? "denied" : "hidden",
  }),
}));
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ channelInteraction: {} }) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
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
vi.mock("@/store/ui/windowStore", () => ({ useWindow: () => ({ openChannelSettings: h.openChannelSettings }) }));
vi.mock("@/composables/useSplitView", () => ({
  canButton: h.splitButton,
  canCtrlClick: h.splitCtrl,
  splitEnabled: h.splitButton,
}));
vi.mock("@/composables/useVoiceModeration", () => ({
  useVoiceModeration: () => ({ moveMember: async () => true, setServerMuted: async () => true, setServerDeafened: async () => true }),
}));
vi.mock("@/lib/telemetry/metrics", () => ({ enumName: () => "x" }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/components/channels/VoiceChannelUser.vue", async () => {
  const { h: hh } = await import("vue");
  return { default: { name: "VoiceChannelUser", props: ["user"], setup: (p: any) => () => hh("span", { class: "stub-voice-user" }, p.user?.userId) } };
});
vi.mock("@/components/audio/VolumeSlider.vue", () => ({ default: { name: "VolumeSlider", setup: () => () => null } }));

// A menu that is always open: what matters here is which items it holds and in what state.
vi.mock("@argon/ui/context-menu", async () => {
  const { h: hh, defineComponent } = await import("vue");
  const pass = (name: string, tag = "div") =>
    defineComponent({ name, inheritAttrs: true, setup: (_, { slots }) => () => hh(tag, { class: `stub-${name}` }, slots.default?.()) });
  const Item = defineComponent({
    name: "ContextMenuItem",
    props: { disabled: Boolean, inset: Boolean },
    emits: ["select"],
    setup(props, { slots, emit }) {
      return () =>
        hh("div", {
          class: "stub-item",
          "data-disabled": props.disabled ? "" : undefined,
          onClick: () => { if (!props.disabled) emit("select"); },
        }, slots.default?.());
    },
  });
  return {
    ContextMenu: pass("ContextMenu"),
    ContextMenuTrigger: pass("ContextMenuTrigger"),
    ContextMenuContent: pass("ContextMenuContent"),
    ContextMenuItem: Item,
    ContextMenuSeparator: pass("ContextMenuSeparator", "hr"),
    ContextMenuShortcut: pass("ContextMenuShortcut", "span"),
    ContextMenuLabel: pass("ContextMenuLabel"),
    ContextMenuSub: pass("ContextMenuSub"),
    ContextMenuSubTrigger: pass("ContextMenuSubTrigger"),
    ContextMenuSubContent: pass("ContextMenuSubContent"),
  };
});

import { ChannelType } from "@argon/glue";
import ChannelItem from "@/components/ChannelItem.vue";

const channel = (channelId: string, type = ChannelType.Voice) =>
  ({ channelId, spaceId: "s1", name: channelId, type, groupId: null }) as any;

const member = (userId: string) => ({ userId, state: 0, User: { userId, displayName: userId }, volume: [100] });

function render(ch = channel("v1"), extra: Record<string, unknown> = {}) {
  return mount(ChannelItem, {
    props: { channel: ch, groupId: null, index: 0, isActive: false, isDragOver: false, ...extra },
  });
}

const grant = (channelId: string, ...flags: string[]) => h.channels.set(channelId, new Set(flags));

beforeEach(() => {
  h.space = new Set();
  h.channels = new Map();
  h.voice.connectedVoiceChannelId = null;
});

describe("a voice channel without Connect", () => {
  test("is shown locked and says why", () => {
    grant("v1", "ViewChannel");
    const w = render();

    expect(w.find(".channel-item").attributes("data-locked")).toBeDefined();
    expect(w.find('[data-testid="voice-lock"]').exists()).toBe(true);
    const inner = w.find(".channel-inner");
    expect(inner.attributes("aria-disabled")).toBe("true");
    expect(inner.attributes("title")).toBe("voice_channel_locked");
  });

  test("a click, a ctrl-click and a middle click do nothing, so nothing asks to join", async () => {
    grant("v1", "ViewChannel");
    const w = render();
    const inner = w.find(".channel-inner");

    await inner.trigger("click");
    await inner.trigger("click", { ctrlKey: true });
    await inner.trigger("auxclick", { button: 1 });

    expect(w.emitted("select")).toBeUndefined();
    expect(w.emitted("open-split")).toBeUndefined();
    expect(w.emitted("switch-voice")).toBeUndefined();
    expect(w.find(".split-btn").exists()).toBe(false);
  });

  test("Join and the voice invite stay in the menu, disabled, with the reason on hover", async () => {
    grant("v1", "ViewChannel");
    const w = render();

    for (const action of ["join-voice", "voice-invite"]) {
      const item = w.find(`[data-action="${action}"]`);
      expect(item.attributes("data-gate")).toBe("denied");
      expect(item.attributes("data-disabled")).toBeDefined();
      expect(item.element.parentElement?.getAttribute("title")).toBe("voice_channel_locked");
      await item.trigger("click");
    }
    expect(w.emitted("switch-voice")).toBeUndefined();
  });
});

describe("a voice channel with Connect", () => {
  test("is an ordinary row: a click selects it and Join works", async () => {
    grant("v1", "ViewChannel", "JoinToVoice", "Connect");
    const w = render();

    expect(w.find(".channel-item").attributes("data-locked")).toBeUndefined();
    expect(w.find('[data-testid="voice-lock"]').exists()).toBe(false);

    await w.find(".channel-inner").trigger("click");
    expect(w.emitted("select")?.[0]).toEqual(["v1"]);

    const join = w.find('[data-action="join-voice"]');
    expect(join.attributes("data-gate")).toBe("allowed");
    await join.trigger("click");
    expect(w.emitted("switch-voice")?.[0]).toEqual(["v1"]);
  });

  test("a text channel is never locked", () => {
    grant("t1", "ViewChannel");
    const w = render(channel("t1", ChannelType.Text));
    expect(w.find(".channel-item").attributes("data-locked")).toBeUndefined();
    expect(w.find('[data-action="join-voice"]').exists()).toBe(false);
  });
});

describe("managing the channel", () => {
  test("left out entirely when nothing in the space grants ManageChannels", () => {
    grant("t1", "ViewChannel");
    const w = render(channel("t1", ChannelType.Text));

    expect(w.find('[data-action="edit-channel"]').exists()).toBe(false);
    expect(w.find('[data-action="duplicate-channel"]').exists()).toBe(false);
  });

  test("disabled with the reason when this channel's overwrite takes it away", async () => {
    h.space = new Set(["ManageChannels"]);
    grant("t1", "ViewChannel");
    const opened = vi.spyOn(h, "openChannelSettings");
    const w = render(channel("t1", ChannelType.Text));

    const edit = w.find('[data-action="edit-channel"]');
    expect(edit.attributes("data-gate")).toBe("denied");
    expect(edit.attributes("data-disabled")).toBeDefined();
    expect(edit.element.parentElement?.getAttribute("title")).toBe("permission_denied_in_channel");
    expect(w.find('[data-action="duplicate-channel"]').attributes("data-gate")).toBe("denied");

    await edit.trigger("click");
    expect(opened).not.toHaveBeenCalled();
    // Nor can the row be dragged to another place.
    expect(w.find(".channel-row").attributes("draggable")).toBe("false");
  });

  test("usable where the channel grants it", async () => {
    grant("t1", "ViewChannel", "ManageChannels");
    const opened = vi.spyOn(h, "openChannelSettings");
    const w = render(channel("t1", ChannelType.Text));

    const edit = w.find('[data-action="edit-channel"]');
    expect(edit.attributes("data-gate")).toBe("allowed");
    await edit.trigger("click");
    expect(opened).toHaveBeenCalledWith("s1", "t1");
    expect(w.find(".channel-row").attributes("draggable")).toBe("true");
  });
});

describe("the voice member menu", () => {
  const withMember = () => ({
    voiceUsers: { Channel: channel("v1"), Users: new Map([["u2", member("u2")]]) },
    voiceChannels: [channel("v1"), channel("v2"), channel("v3")],
  });

  test("moderation the space never grants is left out", () => {
    grant("v1", "ViewChannel", "JoinToVoice", "Connect");
    const w = render(channel("v1"), withMember());

    for (const action of ["move-to", "server-mute", "server-deafen", "kick"])
      expect(w.find(`[data-action="${action}"]`).exists()).toBe(false);
  });

  test("taken away in the member's channel: shown disabled, not usable", () => {
    h.space = new Set(["MuteMember", "KickMember", "MoveMember"]);
    grant("v1", "ViewChannel", "JoinToVoice", "Connect");
    const w = render(channel("v1"), withMember());

    for (const action of ["move-to", "kick"]) {
      const item = w.find(`[data-action="${action}"]`);
      expect(item.attributes("data-gate")).toBe("denied");
      expect(item.attributes("data-disabled")).toBeDefined();
    }
    expect(w.find('[data-action="server-deafen"]').exists()).toBe(false);
  });

  test("server mute and deafen follow the space-wide grant, as the server checks them", () => {
    h.space = new Set(["MuteMember"]);
    grant("v1", "ViewChannel", "JoinToVoice", "Connect");
    const w = render(channel("v1"), withMember());

    expect(w.find('[data-action="server-mute"]').attributes("data-gate")).toBe("allowed");
    expect(w.find('[data-action="server-deafen"]').exists()).toBe(false);
  });

  test("move targets where the moderator lacks MoveMember are disabled", () => {
    h.space = new Set(["MoveMember"]);
    grant("v1", "ViewChannel", "JoinToVoice", "Connect", "MoveMember");
    grant("v2", "ViewChannel", "MoveMember");
    grant("v3", "ViewChannel");
    const w = render(channel("v1"), withMember());

    expect(w.find('[data-move-target="v2"]').attributes("data-gate")).toBe("allowed");
    const v3 = w.find('[data-move-target="v3"]');
    expect(v3.attributes("data-gate")).toBe("denied");
    expect(v3.attributes("data-disabled")).toBeDefined();
    // The member can be dragged out of v1, where the moderator may move people.
    expect(w.find(".voice-user-list li").attributes("draggable")).toBe("true");
  });
});
