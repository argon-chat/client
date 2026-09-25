/**
 * The voice member row in the sidebar.
 *
 * It used to read mute state from the LiveKit room only, so a channel we were not in never showed
 * anyone as muted. Now every row reads the roster flags, and the room we are in adds its live state
 * on top. What these pin: flags alone are enough, a moderator's mute or deafen looks different from
 * a self-mute, deafened reads as muted too, and our own row follows the local controls instantly
 * rather than waiting for the server's echo.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

const { voice, sys } = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  return {
    voice: reactive({
      connectedVoiceChannelId: null as string | null,
      isSharing: false,
      serverMuted: false,
      serverDeafened: false,
      participants: {} as Record<string, { muted: boolean; mutedAll: boolean; screencast: boolean }>,
      speaking: new Set<string>(),
    }),
    sys: reactive({ microphoneMuted: false, headphoneMuted: false }),
  };
});

vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => voice }));
vi.mock("@/store/system/systemStore", () => ({ useSystemStore: () => sys }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/components/ArgonAvatar.vue", async () => {
  const { h } = await import("vue");
  return { default: { name: "ArgonAvatar", setup: () => () => h("div", { class: "stub-avatar" }) } };
});

import VoiceChannelUser from "@/components/channels/VoiceChannelUser.vue";
import { VoiceStateBits } from "@argon/calls/voice-state";
import { resolveVoiceIndicators } from "@/lib/voice/indicators";

const B = VoiceStateBits;

const render = (userId: string, state: number, channelId = "c1") =>
  mount(VoiceChannelUser, {
    props: {
      channelId,
      user: {
        userId,
        state,
        User: { userId, displayName: userId, avatarFileId: null },
        isSpeaking: false,
        isMuted: false,
        isScreenShare: false,
        volume: [100],
        isRecording: false,
      } as any,
    },
  });

const indicator = (w: ReturnType<typeof render>, name: string) => w.find(`[data-indicator="${name}"]`);

beforeEach(() => {
  voice.connectedVoiceChannelId = null;
  voice.isSharing = false;
  voice.serverMuted = false;
  voice.serverDeafened = false;
  voice.participants = {};
  sys.microphoneMuted = false;
  sys.headphoneMuted = false;
});

describe("a room we are not in", () => {
  test("nothing set, nothing shown", () => {
    const w = render("u1", 0);
    expect(w.find("[data-indicator]").exists()).toBe(false);
  });

  test("a self-mute shows in the plain style", () => {
    const w = render("u1", B.MUTED);
    const mic = indicator(w, "mic");
    expect(mic.exists()).toBe(true);
    expect(mic.attributes("data-by-server")).toBeUndefined();
    expect(mic.attributes("title")).toBe("muted");
  });

  test("deafened reads as muted too", () => {
    const w = render("u1", B.MUTED_HEADPHONES);
    expect(indicator(w, "headphones").exists()).toBe(true);
    expect(indicator(w, "mic").exists()).toBe(true);
  });

  test("a server mute is marked as the moderator's", () => {
    const w = render("u1", B.MUTED_BY_SERVER);
    const mic = indicator(w, "mic");
    expect(mic.attributes("data-by-server")).toBe("true");
    expect(mic.classes()).toContain("voice-flag--server");
    expect(mic.attributes("title")).toBe("voice_member_server_muted");
    expect(indicator(w, "headphones").exists()).toBe(false);
  });

  test("a server deafen marks both the headphones and the microphone", () => {
    const w = render("u1", B.MUTED_HEADPHONES_BY_SERVER);
    expect(indicator(w, "headphones").attributes("data-by-server")).toBe("true");
    expect(indicator(w, "headphones").attributes("title")).toBe("voice_member_server_deafened");
    expect(indicator(w, "mic").attributes("data-by-server")).toBe("true");
  });

  test("streaming shows", () => {
    const w = render("u1", B.STREAMING);
    expect(indicator(w, "streaming").exists()).toBe(true);
  });

  test("LiveKit state from our own room does not leak into another", () => {
    voice.connectedVoiceChannelId = "c2";
    voice.participants = { u1: { muted: true, mutedAll: true, screencast: true } };
    const w = render("u1", 0, "c1");
    expect(w.find("[data-indicator]").exists()).toBe(false);
  });
});

describe("the room we are in", () => {
  test("another member's live mute shows before their flags catch up", () => {
    voice.connectedVoiceChannelId = "c1";
    voice.participants = { u1: { muted: true, mutedAll: false, screencast: false } };
    const w = render("u1", 0);
    expect(indicator(w, "mic").exists()).toBe(true);
  });

  test("flags still count when LiveKit has not caught up", () => {
    voice.connectedVoiceChannelId = "c1";
    voice.participants = { u1: { muted: false, mutedAll: false, screencast: false } };
    const w = render("u1", B.MUTED_BY_SERVER);
    expect(indicator(w, "mic").attributes("data-by-server")).toBe("true");
  });

  test("our own row follows the local controls, not the echo", async () => {
    voice.connectedVoiceChannelId = "c1";
    sys.microphoneMuted = false;
    // The server still says muted: the unmute is on its way.
    const w = render("me", B.MUTED);
    expect(indicator(w, "mic").exists()).toBe(false);

    sys.headphoneMuted = true;
    await w.vm.$nextTick();
    expect(indicator(w, "headphones").exists()).toBe(true);
  });

  test("our own server mute shows even before the roster has it", () => {
    voice.connectedVoiceChannelId = "c1";
    voice.serverMuted = true;
    sys.microphoneMuted = true;
    const w = render("me", 0);
    expect(indicator(w, "mic").attributes("data-by-server")).toBe("true");
  });
});

describe("resolveVoiceIndicators", () => {
  test("self replaces own bits, others merge", () => {
    const echo = B.MUTED | B.STREAMING;
    expect(resolveVoiceIndicators(echo, { self: true, muted: false, deafened: false, streaming: false }))
      .toMatchObject({ micOff: false, streaming: false });
    expect(resolveVoiceIndicators(echo, { self: false, muted: false, deafened: false, streaming: false }))
      .toMatchObject({ micOff: true, streaming: true });
  });

  test("a moderator's bits survive any live state", () => {
    const state = B.MUTED_BY_SERVER;
    expect(resolveVoiceIndicators(state, { self: true, muted: false, deafened: false, streaming: false }))
      .toMatchObject({ micOff: true, micByServer: true });
  });
});
