/**
 * The per-user video upload quality: `auto` until chosen, stored under the account, and an unknown
 * stored value read as the default.
 */

import { describe, test, expect, vi, beforeAll, beforeEach } from "vitest";
import { USER_SCOPED_BASE_KEYS } from "@/lib/userScopedStorage";

type Settings = typeof import("@/lib/video/settings");

beforeAll(async () => {
  await import("@/lib/video/settings");
}, 60_000);

async function load(): Promise<Settings> {
  vi.resetModules();
  return import("@/lib/video/settings");
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
});

describe("video upload quality", () => {
  test("auto by default", async () => {
    expect((await load()).videoUploadQuality.value).toBe("auto");
  });

  test("a choice is stored under the account's key and survives a reload", async () => {
    const s = await load();
    s.videoUploadQuality.value = 720;
    expect(localStorage.getItem(`${s.VIDEO_UPLOAD_QUALITY_KEY}::acc-1`)).toBe("720");
    expect((await load()).videoUploadQuality.value).toBe(720);
  });

  test("another account has its own", async () => {
    (await load()).videoUploadQuality.value = "original";
    localStorage.setItem("argon_active_account", "acc-2");
    expect((await load()).videoUploadQuality.value).toBe("auto");
  });

  test("a stored value this build does not know reads as auto, and is not written", async () => {
    localStorage.setItem("argon_video_upload_quality::acc-1", "4320");
    const s = await load();
    expect(s.videoUploadQuality.value).toBe("auto");
    s.videoUploadQuality.value = 999 as never;
    expect(localStorage.getItem("argon_video_upload_quality::acc-1")).toBe("4320");
  });

  test("the key is forgotten with the account", async () => {
    const s = await load();
    expect(USER_SCOPED_BASE_KEYS).toContain(s.VIDEO_UPLOAD_QUALITY_KEY);
  });
});
