/**
 * Decorative motion pauses while nobody is looking: the window unfocused, the page hidden, or power
 * saving on. `decor-paused` on <html> follows it (styles/decor-paused.css pauses the cosmetics'
 * loops), and the animation intersector holds every sticker and emoji still while the user is away —
 * a looping name drift alone kept the window redrawing at the display rate, unfocused, forever.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick, ref } from "vue";
import { AnimationIntersector } from "@/lib/expressions/animationIntersector";

type Motion = typeof import("@/lib/decorativeMotion");
type PowerSaver = typeof import("@/lib/powerSaver");

const html = () => document.documentElement.classList;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A fresh module (and the power saver it reads), as the app gets on load, with focus as given. */
async function load(hasFocus = true): Promise<{ motion: Motion; power: PowerSaver }> {
  vi.spyOn(document, "hasFocus").mockReturnValue(hasFocus);
  vi.resetModules();
  const power = await import("@/lib/powerSaver");
  const motion = await import("@/lib/decorativeMotion");
  motion.initDecorativeMotion();
  return { motion, power };
}

beforeEach(() => {
  html().remove("decor-paused");
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  delete (document as unknown as { visibilityState?: unknown }).visibilityState;
});

describe("the source of truth", () => {
  test("a focused, shown window runs", async () => {
    const { motion } = await load(true);
    expect(motion.windowFocused.value).toBe(true);
    expect(motion.userAway.value).toBe(false);
    expect(motion.decorativeMotionPaused.value).toBe(false);
    expect(html().contains("decor-paused")).toBe(false);
  });

  test("a window that starts unfocused starts paused", async () => {
    const { motion } = await load(false);
    expect(motion.userAway.value).toBe(true);
    expect(motion.decorativeMotionPaused.value).toBe(true);
    expect(html().contains("decor-paused")).toBe(true);
  });

  test("blur pauses, focus resumes", async () => {
    const { motion } = await load(true);

    window.dispatchEvent(new Event("blur"));
    await nextTick();
    expect(motion.windowFocused.value).toBe(false);
    expect(motion.decorativeMotionPaused.value).toBe(true);
    expect(html().contains("decor-paused")).toBe(true);

    window.dispatchEvent(new Event("focus"));
    await nextTick();
    expect(motion.decorativeMotionPaused.value).toBe(false);
    expect(html().contains("decor-paused")).toBe(false);
  });

  test("a hidden page pauses even with focus; shown again, it reads focus afresh", async () => {
    const { motion } = await load(true);

    setVisibility("hidden");
    await nextTick();
    expect(motion.pageHidden.value).toBe(true);
    expect(motion.decorativeMotionPaused.value).toBe(true);

    // Restored but not activated: still away, though no blur arrived.
    vi.mocked(document.hasFocus).mockReturnValue(false);
    setVisibility("visible");
    expect(motion.pageHidden.value).toBe(false);
    expect(motion.userAway.value).toBe(true);

    window.dispatchEvent(new Event("focus"));
    expect(motion.userAway.value).toBe(false);
  });

  test("power saving pauses a focused window, but is not 'away'", async () => {
    const { motion, power } = await load(true);

    power.setGameRunning(true);
    await nextTick();
    expect(motion.userAway.value).toBe(false);
    expect(motion.decorativeMotionPaused.value).toBe(true);
    expect(html().contains("decor-paused")).toBe(true);

    power.setGameRunning(false);
    await nextTick();
    expect(motion.decorativeMotionPaused.value).toBe(false);
    expect(html().contains("decor-paused")).toBe(false);
  });

  test("every cause has to clear before it runs again", async () => {
    const { motion, power } = await load(true);

    power.setGameRunning(true);
    window.dispatchEvent(new Event("blur"));
    setVisibility("hidden");
    expect(motion.decorativeMotionPaused.value).toBe(true);

    setVisibility("visible");
    expect(motion.decorativeMotionPaused.value).toBe(true);
    window.dispatchEvent(new Event("focus"));
    expect(motion.decorativeMotionPaused.value).toBe(true);
    power.setGameRunning(false);
    expect(motion.decorativeMotionPaused.value).toBe(false);
  });
});

describe("the intersector, while the user is away", () => {
  function setup() {
    const away = ref(false);
    const io = new AnimationIntersector({
      IntersectionObserver: null,
      document: null,
      animationsEnabled: ref(true),
      groupAutoplay: {},
      away,
    });
    const playing = { chat: false, hovered: false };
    io.add({ el: null, group: "chat", autoplay: true, setPlaying: (p) => (playing.chat = p) });
    const hovered = io.add({ el: null, group: "chat", autoplay: false, setPlaying: (p) => (playing.hovered = p) });
    return { io, away, playing, hovered };
  }

  test("holds autoplay still and lets it go on return", () => {
    const { io, away, playing } = setup();
    expect(playing.chat).toBe(true);

    away.value = true;
    expect(playing.chat).toBe(false);

    away.value = false;
    expect(playing.chat).toBe(true);
    io.destroy();
  });

  test("a hover plays in a focused window, not in one nobody is looking at", () => {
    const { io, away, playing, hovered } = setup();

    hovered.play();
    expect(playing.hovered).toBe(true);

    away.value = true;
    expect(playing.hovered).toBe(false);

    // Back, the hover's request still stands.
    away.value = false;
    expect(playing.hovered).toBe(true);
    io.destroy();
  });
});
