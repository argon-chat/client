/**
 * Lite mode: "Animate stickers and emoji" and "Autoplay in the picker", per user. Until the user
 * chooses, animations are on unless the OS asks for reduced motion; an explicit choice wins either
 * way and is stored under the account's key. The picker switch only stops the picker's autoplay.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";

type Settings = typeof import("@/lib/expressions/settings");

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** A fresh module, as the app gets on load, with the OS preference set first. */
async function load(reduce: boolean): Promise<Settings> {
  stubReducedMotion(reduce);
  vi.resetModules();
  return import("@/lib/expressions/settings");
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaults", () => {
  test("without reduced motion: animations on, picker autoplay on", async () => {
    const s = await load(false);
    expect(s.animationsEnabled.value).toBe(true);
    expect(s.pickerAutoplay.value).toBe(true);
    expect(s.prefersReducedMotion()).toBe(false);
  });

  test("with reduced motion: animations off", async () => {
    const s = await load(true);
    expect(s.animationsEnabled.value).toBe(false);
    expect(s.prefersReducedMotion()).toBe(true);
  });
});

describe("the user's choice", () => {
  test("wins over reduced motion, persists per account, and survives a reload", async () => {
    const s = await load(true);
    s.animationsEnabled.value = true;
    expect(s.animationsEnabled.value).toBe(true);
    expect(s.prefersReducedMotion()).toBe(false);
    expect(localStorage.getItem(`${s.EXPRESSION_ANIMATIONS_KEY}::acc-1`)).toBe("true");

    const again = await load(true);
    expect(again.animationsEnabled.value).toBe(true);
  });

  test("off stays off without reduced motion; reset goes back to the default", async () => {
    const s = await load(false);
    s.animationsEnabled.value = false;
    s.pickerAutoplay.value = false;
    expect(s.prefersReducedMotion()).toBe(true);
    expect(localStorage.getItem(`${s.PICKER_AUTOPLAY_KEY}::acc-1`)).toBe("false");

    s.resetExpressionAnimationChoices();
    expect(s.animationsEnabled.value).toBe(true);
    expect(s.pickerAutoplay.value).toBe(true);
  });

  test("another account has its own", async () => {
    const s = await load(false);
    s.animationsEnabled.value = false;
    localStorage.setItem("argon_active_account", "acc-2");
    const other = await load(false);
    expect(other.animationsEnabled.value).toBe(true);
  });
});

describe("power saving", () => {
  test("holds every animation still whatever the user chose, and lets go when it ends", async () => {
    const s = await load(true);
    const power = await import("@/lib/powerSaver");
    s.animationsEnabled.value = true;
    expect(s.animationsEnabled.value).toBe(true);

    power.setGameRunning(true);
    expect(s.animationsEnabled.value).toBe(false);
    expect(s.prefersReducedMotion()).toBe(true);
    // The switch itself still shows what the user asked for.
    expect(s.animationsChoice.value).toBe(true);

    power.setGameRunning(false);
    expect(s.animationsEnabled.value).toBe(true);
    expect(s.prefersReducedMotion()).toBe(false);
  });

  test("a choice made while it is on is kept for afterwards", async () => {
    const s = await load(false);
    const power = await import("@/lib/powerSaver");
    power.setGameRunning(true);

    s.animationsEnabled.value = false;
    expect(localStorage.getItem(`${s.EXPRESSION_ANIMATIONS_KEY}::acc-1`)).toBe("false");

    power.setGameRunning(false);
    expect(s.animationsEnabled.value).toBe(false);
  });
});

describe("the intersector", () => {
  async function intersector(s: Settings) {
    const { AnimationIntersector } = await import("@/lib/expressions/animationIntersector");
    const io = new AnimationIntersector({ IntersectionObserver: null, document: null });
    const playing = { chat: false, picker: false };
    const chat = io.add({ el: null, group: "chat", autoplay: true, setPlaying: (p) => (playing.chat = p) });
    const picker = io.add({ el: null, group: "picker", autoplay: true, setPlaying: (p) => (playing.picker = p) });
    return { io, playing, chat, picker };
  }

  test("the global switch stops every autoplay; the picker switch only the picker's", async () => {
    const s = await load(false);
    const { playing, picker } = await intersector(s);
    expect(playing).toEqual({ chat: true, picker: true });

    s.pickerAutoplay.value = false;
    await nextTick();
    expect(playing).toEqual({ chat: true, picker: false });

    // A hover or click still plays it.
    picker.play();
    expect(playing.picker).toBe(true);

    s.animationsEnabled.value = false;
    await nextTick();
    expect(playing.chat).toBe(false);
  });

  test("power saving pauses what autoplays, and it resumes when power saving ends", async () => {
    const s = await load(false);
    const power = await import("@/lib/powerSaver");
    const { playing } = await intersector(s);
    expect(playing).toEqual({ chat: true, picker: true });

    power.setGameRunning(true);
    await nextTick();
    expect(playing).toEqual({ chat: false, picker: false });

    power.setGameRunning(false);
    await nextTick();
    expect(playing).toEqual({ chat: true, picker: true });
  });
});
