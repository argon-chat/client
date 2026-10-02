/**
 * Applications' localized strings (real Dexie on fake-indexeddb).
 *
 * What these pin: the server is asked with the cached version as `known` and at most once per
 * revalidation window, also across a restart; a key the copy was not fetched for is fetched at once,
 * without a version; an answer without texts keeps the cached ones; an application that does not
 * exist is remembered as having none; a failed request is retried after a short delay, not on every
 * open.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia, type Pinia } from "pinia";

await vi.hoisted(async () => {
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
});

const h = vi.hoisted(() => ({ svc: null as any }));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    get userInteraction() {
      return h.svc;
    },
  }),
}));

import {
  AppByBotUser,
  FailedLookupAppTexts,
  LookupError,
  SuccessLookupAppTexts,
  type LocalizedText,
} from "@argon/glue";
import { db, ensureDbOpen } from "@/store/db/dexie";
import { APP_TEXTS_RETRY_MS, APP_TEXTS_REVALIDATE_MS, useAppTextsStore } from "@/store/data/appTextsStore";
import { runSessionReset } from "@/store/system/sessionLifecycle";
import { appRefByBotUser } from "@/lib/appTexts";

const BOT = appRefByBotUser("0199a1b2-0000-7000-8000-00000000b07a");
const MOTD = ["motd"];

const answer = (version: number, list: LocalizedText[] | null) => new SuccessLookupAppTexts({ version, texts: list });

const HELP: LocalizedText[] = [
  { key: "motd", locale: "en", value: "Type /help" },
  { key: "motd", locale: "ru", value: "Напиши /help" },
];

let pinia: Pinia;

function freshPinia() {
  pinia = createPinia();
  setActivePinia(pinia);
}

function disposeStores() {
  for (const store of (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.values()) store.$dispose();
}

beforeEach(async () => {
  await ensureDbOpen();
  await db.appTexts.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  freshPinia();
  h.svc = { LookupAppTexts: vi.fn(async () => answer(1, HELP)) };
});

afterEach(async () => {
  disposeStores();
  await runSessionReset();
  vi.useRealTimers();
});

describe("app texts", () => {
  test("the first open asks for the bot by its user, without a version, and shows the reader's language", async () => {
    const store = useAppTextsStore();

    await store.ensureLoaded(BOT, MOTD);

    const [app, keys, known] = h.svc.LookupAppTexts.mock.calls[0];
    expect(app).toBeInstanceOf(AppByBotUser);
    expect(keys).toEqual(["motd"]);
    expect(known).toBeNull();
    expect(store.text(BOT, "motd", "ru")).toBe("Напиши /help");
    expect(store.text(BOT, "motd", "jp")).toBe("Type /help");
  });

  test("another open inside the window asks nothing", async () => {
    const store = useAppTextsStore();

    await store.ensureLoaded(BOT, MOTD);
    vi.advanceTimersByTime(APP_TEXTS_REVALIDATE_MS - 1);
    await store.ensureLoaded(BOT, MOTD);

    expect(h.svc.LookupAppTexts).toHaveBeenCalledTimes(1);
  });

  test("after the window it sends its version, and an answer without texts keeps them", async () => {
    const store = useAppTextsStore();

    await store.ensureLoaded(BOT, MOTD);
    vi.advanceTimersByTime(APP_TEXTS_REVALIDATE_MS);
    h.svc.LookupAppTexts.mockResolvedValueOnce(answer(1, null));
    await store.ensureLoaded(BOT, MOTD);

    expect(h.svc.LookupAppTexts).toHaveBeenLastCalledWith(expect.any(AppByBotUser), ["motd"], 1);
    expect(store.text(BOT, "motd", "en")).toBe("Type /help");
  });

  test("a key the copy was not fetched for is fetched at once, with the ones it has, and no version", async () => {
    const store = useAppTextsStore();

    await store.ensureLoaded(BOT, MOTD);
    h.svc.LookupAppTexts.mockResolvedValueOnce(
      answer(1, [...HELP, { key: "description", locale: "en", value: "Helps" }]),
    );
    await store.ensureLoaded(BOT, ["description"]);

    expect(h.svc.LookupAppTexts).toHaveBeenLastCalledWith(expect.any(AppByBotUser), ["description", "motd"], null);
    expect(store.text(BOT, "description", "ru")).toBe("Helps");
    expect(store.text(BOT, "motd", "ru")).toBe("Напиши /help");
  });

  test("a new version replaces the texts, and an empty one clears them", async () => {
    const store = useAppTextsStore();

    await store.ensureLoaded(BOT, MOTD);
    vi.advanceTimersByTime(APP_TEXTS_REVALIDATE_MS);
    h.svc.LookupAppTexts.mockResolvedValueOnce(answer(2, [{ key: "motd", locale: "en", value: "Now with /stats" }]));
    await store.ensureLoaded(BOT, MOTD);

    expect(store.text(BOT, "motd", "ru")).toBe("Now with /stats");

    vi.advanceTimersByTime(APP_TEXTS_REVALIDATE_MS);
    h.svc.LookupAppTexts.mockResolvedValueOnce(answer(3, []));
    await store.ensureLoaded(BOT, MOTD);

    expect(store.text(BOT, "motd", "en")).toBeNull();
  });

  test("the cached copy survives a restart and is not asked about again inside the window", async () => {
    await useAppTextsStore().ensureLoaded(BOT, MOTD);
    disposeStores();
    await runSessionReset();
    freshPinia();

    const store = useAppTextsStore();
    await store.ensureLoaded(BOT, MOTD);

    expect(h.svc.LookupAppTexts).toHaveBeenCalledTimes(1);
    expect(store.text(BOT, "motd", "en")).toBe("Type /help");
  });

  test("an application that does not exist is remembered as having no strings", async () => {
    h.svc.LookupAppTexts.mockResolvedValueOnce(new FailedLookupAppTexts(LookupError.NOT_FOUND));
    const store = useAppTextsStore();

    await store.ensureLoaded(BOT, MOTD);
    await store.ensureLoaded(BOT, MOTD);

    expect(store.text(BOT, "motd", "en")).toBeNull();
    expect(h.svc.LookupAppTexts).toHaveBeenCalledTimes(1);
  });

  test("a failed request is retried after the short delay, not on every open", async () => {
    h.svc.LookupAppTexts.mockRejectedValueOnce(new Error("offline"));
    const store = useAppTextsStore();

    await store.ensureLoaded(BOT, MOTD);
    await store.ensureLoaded(BOT, MOTD);
    expect(h.svc.LookupAppTexts).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(APP_TEXTS_RETRY_MS);
    await store.ensureLoaded(BOT, MOTD);

    expect(h.svc.LookupAppTexts).toHaveBeenCalledTimes(2);
    expect(store.text(BOT, "motd", "en")).toBe("Type /help");
  });

  test("two opens at once share one request", async () => {
    const store = useAppTextsStore();

    await Promise.all([store.ensureLoaded(BOT, MOTD), store.ensureLoaded(BOT, MOTD)]);

    expect(h.svc.LookupAppTexts).toHaveBeenCalledTimes(1);
  });
});
