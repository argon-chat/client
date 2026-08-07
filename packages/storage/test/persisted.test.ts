/**
 * Persisted storage.
 *
 * Everything the user configures lives here, and so does the state that lets a call be
 * rejoined after a renderer crash. The failure that matters is not "a value was lost"
 * but "a corrupt entry takes the app down or silently resets everything" — localStorage
 * is user-writable and survives upgrades, so it must be treated as untrusted input.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { nextTick, isReactive, isRef } from "vue";
import { persisted, persistedValue, readPersistedValue } from "../src";

vi.mock("@argon/core", () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));

beforeEach(() => {
  localStorage.clear();
});

describe("persistedValue: primitives", () => {
  test("starts from the default when nothing is stored", () => {
    const volume = persistedValue("volume", 50);
    expect(volume.value).toBe(50);
  });

  test("writes through on change", async () => {
    const volume = persistedValue("volume", 50);

    volume.value = 80;
    await nextTick();

    expect(persistedValue("volume", 50).value).toBe(80);
  });

  test("reads back what a previous session stored", async () => {
    persistedValue("channel", "").value = "general";
    await nextTick();

    expect(persistedValue("channel", "fallback").value).toBe("general");
  });

  test("preserves types across a reload rather than stringifying", async () => {
    const flag = persistedValue("flag", false);
    flag.value = true;
    await nextTick();

    const reloaded = persistedValue("flag", false);
    expect(reloaded.value).toBe(true);
    expect(typeof reloaded.value).toBe("boolean");
  });

  test("carries dates and sets through a reload, unlike plain JSON", async () => {
    // superjson is the reason this works: JSON.stringify would hand back a string for
    // the date and an empty object for the set.
    const state = persistedValue("state", { at: new Date(0), seen: new Set<string>() });
    state.at = new Date("2026-01-02T03:04:05.000Z");
    state.seen.add("u1");
    await nextTick();

    const reloaded = persistedValue("state", { at: new Date(0), seen: new Set<string>() });
    expect(reloaded.at).toBeInstanceOf(Date);
    expect(reloaded.at.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(reloaded.seen.has("u1")).toBe(true);
  });

  test("a corrupt entry falls back to the default instead of throwing", () => {
    localStorage.setItem("volume", "{not json");
    expect(() => persistedValue("volume", 50)).not.toThrow();
    expect(persistedValue("volume", 50).value).toBe(50);
  });

  test("returns a ref for primitives", () => {
    expect(isRef(persistedValue("n", 1))).toBe(true);
  });
});

describe("persistedValue: objects", () => {
  test("returns a reactive object and persists mutations to it", async () => {
    const prefs = persistedValue("prefs", { theme: "dark", scale: 1 });
    expect(isReactive(prefs)).toBe(true);

    prefs.scale = 2;
    await nextTick();

    expect(persistedValue("prefs", { theme: "light", scale: 0 })).toMatchObject({
      theme: "dark",
      scale: 2,
    });
  });

  test("a stored object wins over the default", () => {
    localStorage.setItem("prefs", JSON.stringify({ json: { theme: "dark" }, meta: {} }));
    expect(persistedValue("prefs", { theme: "light" }).theme).toBe("dark");
  });

  test("a corrupt object entry falls back without throwing", () => {
    localStorage.setItem("prefs", "<<<");
    expect(persistedValue("prefs", { theme: "light" }).theme).toBe("light");
  });
});

describe("readPersistedValue", () => {
  test("reads the latest value without creating a watcher", async () => {
    const channel = persistedValue("channel", "");
    channel.value = "voice-1";
    await nextTick();

    expect(readPersistedValue("channel", "")).toBe("voice-1");
  });

  test("returns the default for a missing key", () => {
    expect(readPersistedValue("absent", "fallback")).toBe("fallback");
  });

  test("returns the default for a corrupt entry rather than throwing", () => {
    localStorage.setItem("broken", "{{{");
    expect(readPersistedValue("broken", "fallback")).toBe("fallback");
  });

  test("distinguishes a stored empty string from a missing key", async () => {
    const v = persistedValue("empty", "x");
    v.value = "";
    await nextTick();

    expect(readPersistedValue("empty", "default")).toBe("");
    expect(readPersistedValue("never-set", "default")).toBe("default");
  });
});

describe("persisted", () => {
  test("starts from the default and stores what is set", () => {
    const box = persisted("box", { a: 1 });
    expect(box.value).toEqual({ a: 1 });

    box.set({ a: 2 });

    expect(persisted("box", { a: 0 }).value).toEqual({ a: 2 });
  });

  test("set_key updates a single field", () => {
    const box = persisted("box", { a: 1, b: 2 });
    box.set({ a: 1, b: 2 });

    box.set_key("b", 9);

    expect(persisted("box", { a: 0, b: 0 }).value).toEqual({ a: 1, b: 9 });
  });

  test("set_key works before anything has been written", () => {
    // The initial value is only held in memory — nothing reaches localStorage until a
    // set(). Reading storage first and mutating the result therefore hits null.
    const box = persisted("fresh", { a: 1, b: 2 });

    expect(() => box.set_key("b", 9)).not.toThrow();
    expect(box.value).toEqual({ a: 1, b: 9 });
  });

  test("destroy removes the entry and freezes further writes", () => {
    const box = persisted("box", { a: 1 });
    box.set({ a: 2 });

    box.destroy();

    expect(localStorage.getItem("box")).toBeNull();
    box.set({ a: 3 });
    expect(localStorage.getItem("box")).toBeNull();
  });
});
