/**
 * Tile shape and per-tile bindings.
 *
 * The regression these guard: diagnostics outlive the video they describe — nothing
 * cleared them when a share ended — so the main tile kept the shape of a stream that
 * was already gone and stayed deformed. Clearing the map was one fix; the durable one
 * is that the ratio is derived only when a track actually exists, which is what these
 * assert. The clamp matters for the same reason: a bogus report must not be able to
 * turn a tile into a sliver.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const voice = vi.hoisted(() => ({
  room: null as unknown,
  isConnected: true,
  isSharing: false,
  ping: 20,
  qualityConnection: "GREEN",
  participants: {} as Record<string, unknown>,
  speaking: new Set<string>(),
  videoTracks: new Map<string, unknown>(),
  diagnostics: new Map<string, Record<string, unknown>>(),
  participantQuality: new Map<string, string>(),
  subscriptionErrors: new Map<string, string>(),
  activeSpeakerId: null as string | null,
  videoTrackKey: (uid: string, source: string) => `${uid}:${source}`,
  hasVideoTrack: (uid: string) =>
    [...voice.videoTracks.keys()].some((k) => k.startsWith(`${uid}:`)),
  isVideoPaused: () => false,
  isVideoHidden: () => false,
  videoQualityOf: () => 2,
  setVideoHidden: vi.fn(),
  setVideoQuality: vi.fn(),
}));

vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => voice }));
vi.mock("@/store/data/poolStore", () => ({
  usePoolStore: () => ({ realtimeChannelUsers: new Map() }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/system/systemStore", () => ({
  useSystemStore: () => ({ microphoneMuted: false, headphoneMuted: false }),
}));
vi.mock("@/store/features/playframeStore", () => ({
  usePlayFrameActivity: () => ({
    channelActivities: [],
    isActive: false,
    myRole: null,
    sessionLifecycle: null,
  }),
}));

import { useMediaLayout } from "@/composables/useMediaLayout";

const SIXTEEN_NINE = 16 / 9;

beforeEach(() => {
  voice.videoTracks = new Map();
  voice.diagnostics = new Map();
  voice.participantQuality = new Map();
  voice.subscriptionErrors = new Map();
});

const layout = () => useMediaLayout(() => null);

/** Give `uid` a screen share reporting `width`x`height`. */
const publish = (uid: string, width?: number, height?: number) => {
  voice.videoTracks.set(`${uid}:screen_share`, {});
  if (width !== undefined) voice.diagnostics.set(uid, { width, height });
};

describe("videoAspectRatio", () => {
  test("follows the real picture when there is one", () => {
    publish("u1", 2560, 1080);
    expect(layout().videoAspectRatio("u1")).toBeCloseTo(2560 / 1080, 5);
  });

  test("a portrait share stays portrait", () => {
    publish("u1", 1080, 1920);
    expect(layout().videoAspectRatio("u1")).toBeCloseTo(1080 / 1920, 5);
  });

  test("no track means no ratio, however stale the diagnostics are", () => {
    // Exactly the reported bug: the share ends, its entry lingers, the tile stays wide.
    voice.diagnostics.set("u1", { width: 3440, height: 1440 });
    expect(layout().videoAspectRatio("u1")).toBe(SIXTEEN_NINE);
  });

  test("falls back when the receiver reports nothing usable", () => {
    const l = layout();
    for (const dims of [
      undefined,
      { width: 0, height: 0 },
      { width: 1920, height: 0 },
      { width: Number.NaN, height: 1080 },
      { width: Number.POSITIVE_INFINITY, height: 1080 },
    ]) {
      voice.videoTracks = new Map([["u1:screen_share", {}]]);
      voice.diagnostics = new Map(dims ? [["u1", dims]] : []);
      expect(l.videoAspectRatio("u1")).toBe(SIXTEEN_NINE);
    }
  });

  test("absurd reports are clamped to a shape a tile can hold", () => {
    const l = layout();

    voice.videoTracks = new Map([["u1:screen_share", {}]]);
    voice.diagnostics = new Map([["u1", { width: 10000, height: 100 }]]);
    expect(l.videoAspectRatio("u1")).toBeLessThanOrEqual(3.5);

    voice.diagnostics = new Map([["u1", { width: 100, height: 10000 }]]);
    expect(l.videoAspectRatio("u1")).toBeGreaterThanOrEqual(0.4);
  });

  test("nobody in the main slot is not an error", () => {
    const l = layout();
    expect(l.videoAspectRatio(null)).toBe(SIXTEEN_NINE);
    expect(l.videoAspectRatio(undefined)).toBe(SIXTEEN_NINE);
  });
});

describe("tileProps", () => {
  test("carries the source it resolved, so events name the right track", () => {
    publish("u1", 1920, 1080);
    expect(layout().tileProps("u1", "screen_share").videoSource).toBe("screen_share");
  });

  test("passes through per-participant quality and subscription failures", () => {
    publish("u1", 1920, 1080);
    voice.participantQuality.set("u1", "poor");
    voice.subscriptionErrors.set("u1", "codec not supported");

    const p = layout().tileProps("u1", "screen_share");
    expect(p.connectionQuality).toBe("poor");
    expect(p.subscriptionError).toBe("codec not supported");
  });

  test("reports nothing rather than guessing for a participant with no data", () => {
    const p = layout().tileProps("u2");
    expect(p.connectionQuality).toBeNull();
    expect(p.subscriptionError).toBeNull();
  });

  test("stats come from the video receiver fields", () => {
    voice.videoTracks.set("u1:camera", {});
    voice.diagnostics.set("u1", {
      width: 1280,
      height: 720,
      codec: "video/VP9",
      videoBitrateKbps: 900,
    });

    expect(layout().tileProps("u1").stats).toEqual({
      width: 1280,
      height: 720,
      codec: "VP9",
      bitrateKbps: 900,
    });
  });
});

describe("qualityConnection is not computed twice", () => {
  test("the indicator delegates to the call store", () => {
    // It used to be reimplemented here off raw ping, so a change to the store's own
    // quality signal never reached the UI.
    voice.qualityConnection = "RED";
    expect(layout().qualityConnection.value).toBe("RED");

    voice.qualityConnection = "GREEN";
    expect(layout().qualityConnection.value).toBe("GREEN");
  });
});
