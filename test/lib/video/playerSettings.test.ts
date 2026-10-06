/**
 * The video settings, per account: chat autoplay (default like animated stickers: on unless reduced
 * motion, an explicit choice wins, power saving holds it off), the 50 MB autoplay line, looping
 * short clips in the viewer, and the player's remembered volume, mute and speed.
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { USER_SCOPED_BASE_KEYS } from "@/lib/userScopedStorage";

type Settings = typeof import("@/lib/video/playerSettings");
type PowerSaver = typeof import("@/lib/powerSaver");

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

// The first transform is slow when every project runs at once; the tests re-import it fresh.
beforeAll(async () => {
  await import("@/lib/video/playerSettings");
}, 60_000);

/** A fresh module graph, as the app gets on load, with the OS preference set first. */
async function load(reduce = false): Promise<Settings & { power: PowerSaver }> {
  stubReducedMotion(reduce);
  vi.resetModules();
  const settings = await import("@/lib/video/playerSettings");
  const power = await import("@/lib/powerSaver");
  return { ...settings, power };
}

const MB = 1024 * 1024;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaults", () => {
  test("autoplay on, short clips loop, full volume, unmuted, normal speed", async () => {
    const s = await load();
    expect(s.videoAutoplayInChat.value).toBe(true);
    expect(s.videoAutoplayActive.value).toBe(true);
    expect(s.videoAutoplayMaxBytes.value).toBe(50 * MB);
    expect(s.videoLoopShort.value).toBe(true);
    expect(s.playerVolume.value).toBe(1);
    expect(s.playerMuted.value).toBe(false);
    expect(s.playerPlaybackRate.value).toBe(1);
  });

  test("with reduced motion, chat autoplay starts off", async () => {
    const s = await load(true);
    expect(s.videoAutoplayInChat.value).toBe(false);
    expect(s.fitsChatAutoplay(1 * MB)).toBe(false);
  });
});

describe("the user's choice", () => {
  test("wins over reduced motion, is stored under the account's key and survives a reload", async () => {
    const s = await load(true);
    s.videoAutoplayInChat.value = true;
    s.videoLoopShort.value = false;
    expect(s.videoAutoplayActive.value).toBe(true);
    expect(localStorage.getItem(`${s.VIDEO_AUTOPLAY_KEY}::acc-1`)).toBe("true");
    expect(localStorage.getItem(`${s.VIDEO_LOOP_SHORT_KEY}::acc-1`)).toBe("false");

    const again = await load(true);
    expect(again.videoAutoplayInChat.value).toBe(true);
    expect(again.videoLoopShort.value).toBe(false);
  });

  test("another account has its own", async () => {
    const s = await load();
    s.videoAutoplayInChat.value = false;
    localStorage.setItem("argon_active_account", "acc-2");
    const other = await load();
    expect(other.videoAutoplayInChat.value).toBe(true);
  });

  test("reset brings autoplay back to its default and loops short clips again", async () => {
    const s = await load();
    s.videoAutoplayInChat.value = false;
    s.videoLoopShort.value = false;
    s.playerVolume.value = 0.3;
    s.resetVideoChatChoices();
    expect(s.videoAutoplayInChat.value).toBe(true);
    expect(s.videoLoopShort.value).toBe(true);
    expect(s.playerVolume.value).toBe(0.3);
  });

  test("every key is one the account's sign-out clears", async () => {
    const s = await load();
    for (const key of [
      s.VIDEO_AUTOPLAY_KEY,
      s.VIDEO_AUTOPLAY_MAX_BYTES_KEY,
      s.VIDEO_LOOP_SHORT_KEY,
      s.PLAYER_VOLUME_KEY,
      s.PLAYER_MUTED_KEY,
      s.PLAYER_RATE_KEY,
    ]) {
      expect(USER_SCOPED_BASE_KEYS).toContain(key);
    }
  });
});

describe("power saving", () => {
  test("holds chat autoplay off without moving the switch", async () => {
    const s = await load();
    s.power.setGameRunning(true);
    expect(s.videoAutoplayInChat.value).toBe(true);
    expect(s.videoAutoplayActive.value).toBe(false);
    expect(s.fitsChatAutoplay(1 * MB)).toBe(false);
    s.power.setGameRunning(false);
    expect(s.videoAutoplayActive.value).toBe(true);
  });
});

describe("what autoplays and what loops", () => {
  test("up to 50 MB autoplays, above does not", async () => {
    const s = await load();
    expect(s.fitsChatAutoplay(50 * MB)).toBe(true);
    expect(s.fitsChatAutoplay(BigInt(50 * MB + 1))).toBe(false);
  });

  test("the line can be moved by hand in storage", async () => {
    localStorage.setItem("argon_video_autoplay_max_bytes::acc-1", String(10 * MB));
    const s = await load();
    expect(s.fitsChatAutoplay(11 * MB)).toBe(false);
  });

  test("clips under a minute loop in the viewer while the switch is on", async () => {
    const s = await load();
    expect(s.loopsInViewer(59_999)).toBe(true);
    expect(s.loopsInViewer(60_000)).toBe(false);
    expect(s.loopsInViewer(0)).toBe(false);
    s.videoLoopShort.value = false;
    expect(s.loopsInViewer(10_000)).toBe(false);
  });
});

describe("player memory", () => {
  test("volume, mute and speed persist, held to their ranges", async () => {
    const s = await load();
    s.playerVolume.value = 1.7;
    expect(s.playerVolume.value).toBe(1);
    s.playerVolume.value = 0.42;
    s.playerMuted.value = true;
    s.playerPlaybackRate.value = 9;
    expect(s.playerPlaybackRate.value).toBe(4);
    s.playerPlaybackRate.value = 1.5;

    const again = await load();
    expect(again.playerVolume.value).toBe(0.42);
    expect(again.playerMuted.value).toBe(true);
    expect(again.playerPlaybackRate.value).toBe(1.5);
  });

  test("garbage in storage reads as the default", async () => {
    localStorage.setItem("argon_video_volume::acc-1", JSON.stringify("loud"));
    localStorage.setItem("argon_video_rate::acc-1", JSON.stringify(null));
    const s = await load();
    expect(s.playerVolume.value).toBe(1);
    expect(s.playerPlaybackRate.value).toBe(1);
  });
});
