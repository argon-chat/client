/**
 * ParticipantCard structure.
 *
 * The regression these guard: the avatar was written as `v-else`, but a DrawOverlay
 * with its own `v-if` had since been inserted between it and the `<video>`. Vue chains
 * `v-else` to the previous sibling, so the avatar became "show unless the drawing
 * overlay is up" and rendered as a flex sibling of live video, squeezing the picture.
 * Nothing in the repo could see it: typecheck and the production build both pass, and
 * Biome does not parse SFC templates. Only rendering the thing catches it.
 */

import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

// vi.mock factories are hoisted above every import, so the helpers they call have to
// be hoisted too, and `h` can only be reached from inside an async factory.
const { stubModule, passthrough, empty } = vi.hoisted(() => ({
  stubModule: (name: string, cls: string) => async () => {
    const { h } = await import("vue");
    return { default: { name, setup: () => () => h("div", { class: cls }) } };
  },
  passthrough: (name: string) => ({
    name,
    setup: (_p: unknown, { slots }: { slots: Record<string, undefined | (() => unknown)> }) =>
      () => slots.default?.() ?? null,
  }),
  empty: (name: string) => ({ name, setup: () => () => null }),
}));

// Replace everything the card only collaborates with, so a failure here means the
// card's own template changed shape — not that a store or the menu library moved.
vi.mock("@/components/ArgonAvatar.vue", stubModule("ArgonAvatar", "stub-avatar"));
vi.mock("@/components/DrawOverlay.vue", stubModule("DrawOverlay", "stub-draw-overlay"));
vi.mock("@/store/features/drawingSessionStore", () => ({
  useDrawingSession: () => ({ isSessionActive: () => false }),
}));
vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@argon/core", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));
vi.mock("livekit-client", () => ({
  VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 },
}));
vi.mock("@argon/ui/context-menu", () => ({
  ContextMenu: passthrough("ContextMenu"),
  ContextMenuTrigger: passthrough("ContextMenuTrigger"),
  // Menu content is portalled in the real UI; keep it out of the tree entirely so the
  // assertions below describe the tile itself.
  ContextMenuContent: empty("ContextMenuContent"),
  ContextMenuItem: passthrough("ContextMenuItem"),
  ContextMenuSeparator: passthrough("ContextMenuSeparator"),
  ContextMenuSub: passthrough("ContextMenuSub"),
  ContextMenuSubContent: passthrough("ContextMenuSubContent"),
  ContextMenuSubTrigger: passthrough("ContextMenuSubTrigger"),
}));

import ParticipantCard from "@/components/home/views/ParticipantCard.vue";

const render = (props: Record<string, unknown> = {}) =>
  mount(ParticipantCard, {
    props: { userId: "u1", displayName: "Someone", ...props },
  });

describe("ParticipantCard: video and avatar are alternatives", () => {
  test("with video: a picture and no avatar beside it", () => {
    const w = render({ hasVideo: true });
    expect(w.findAll("video")).toHaveLength(1);
    expect(w.find(".stub-avatar").exists()).toBe(false);
  });

  test("without video: an avatar and no picture", () => {
    const w = render({ hasVideo: false });
    expect(w.findAll("video")).toHaveLength(0);
    expect(w.find(".stub-avatar").exists()).toBe(true);
  });

  test("never both at once, across every combination", () => {
    for (const hasVideo of [true, false]) {
      for (const isVideoHidden of [true, false]) {
        for (const videoSource of ["camera", "screen_share"]) {
          const w = render({ hasVideo, isVideoHidden, videoSource });
          const videos = w.findAll("video").length;
          const avatars = w.findAll(".stub-avatar").length;
          expect(
            videos + avatars,
            `hasVideo=${hasVideo} hidden=${isVideoHidden} source=${videoSource}`,
          ).toBe(1);
        }
      }
    }
  });
});

describe("ParticipantCard: a hidden tile is really off", () => {
  test("hiding a track stops rendering it and falls back to the avatar", () => {
    const w = render({ hasVideo: true, isVideoHidden: true });
    expect(w.findAll("video")).toHaveLength(0);
    expect(w.find(".stub-avatar").exists()).toBe(true);
  });

  test("a hidden tile shows no paused badge and no stats", () => {
    const w = render({
      hasVideo: true,
      isVideoHidden: true,
      isVideoPaused: true,
      stats: { width: 1920, height: 1080, codec: "video/VP9", bitrateKbps: 2400 },
    });
    expect(w.text()).not.toContain("video_paused");
    expect(w.find(".tile-stats").exists()).toBe(false);
  });
});

describe("ParticipantCard: state readouts", () => {
  test("the paused badge tracks a shown, paused video", () => {
    expect(render({ hasVideo: true, isVideoPaused: true }).text()).toContain("video_paused");
    expect(render({ hasVideo: true, isVideoPaused: false }).text()).not.toContain("video_paused");
  });

  test("a refused subscription is explained instead of leaving the tile blank", () => {
    const w = render({ hasVideo: false, subscriptionError: "codec not supported" });
    expect(w.find(".tile-notice--error").text()).toContain("codec not supported");
  });

  test("stats are rendered from the receiver, not invented", () => {
    const w = render({
      hasVideo: true,
      stats: { width: 2560, height: 1080, codec: "video/VP9", bitrateKbps: 3100 },
    });
    const text = w.find(".tile-stats").text();
    expect(text).toContain("2560×1080");
    expect(text).toContain("VP9");
    expect(text).toContain("3100 kbps");
  });

  test("a weak link is flagged, a healthy one is not", () => {
    expect(render({ connectionQuality: "poor" }).find(".status-icon--warning").exists()).toBe(true);
    expect(render({ connectionQuality: "lost" }).find(".status-icon--warning").exists()).toBe(true);
    expect(render({ connectionQuality: "excellent" }).find(".status-icon--warning").exists()).toBe(false);
    expect(render({ connectionQuality: null }).find(".status-icon--warning").exists()).toBe(false);
  });
});

describe("ParticipantCard: fullscreen targets the tile, not the bare video", () => {
  test("double-click requests fullscreen on the card, not on the <video>", async () => {
    // Fullscreening the <video> hands over the browser's own media controls, which is
    // how a live stream became pausable — and it leaves overlays and badges behind.
    const w = render({ hasVideo: true });

    let target: Element | null = null;
    const card = w.find(".participant-card").element;
    const video = w.find("video").element;
    for (const el of [card, video]) {
      (el as any).requestFullscreen = function (this: Element) {
        target = this;
        return Promise.resolve();
      };
    }

    await w.find(".participant-card").trigger("dblclick");

    expect(target).toBe(card);
    expect((target as Element | null)?.tagName.toLowerCase()).not.toBe("video");
  });
});
