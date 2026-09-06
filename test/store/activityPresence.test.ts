/**
 * Keeping the server's picture of "what this user is playing" true to the client's.
 *
 * The activity a client broadcasts used to expire by itself: the server held it for ten minutes and
 * forgot it, which cost a long session its activity mid-game but also meant every mistake healed on
 * its own. The server now renews that entry for as long as the session lives, so the client is the
 * only thing that can ever take it down — and both halves of "only" bite. A broadcast that never
 * landed is never noticed, and a removal that never landed shows a game the user quit for the rest
 * of the day, to every roster, every friend list and every newcomer's snapshot.
 *
 * So the publication has to be self-healing rather than fire-and-forget, and this pins the three
 * properties that make it so: an unchanged activity is re-asserted from time to time, a removal is
 * retried until it lands, and neither of those may overwrite a newer decision.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ActivityPresenceKind } from "@argon/glue";

const stubs = vi.hoisted(() => ({
  broadcast: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    userInteraction: {
      BroadcastPresence: stubs.broadcast,
      RemoveBroadcastPresence: stubs.remove,
    },
  }),
}));
// The games journal is off, so every presence is allowed through: what is under test here is the
// publication, not the per-game gate (which `isAllowed` covers on its own).
vi.mock("@/store/features/featureFlagsStore", () => ({
  useFeatureFlags: () => ({ overlayGamesEnabled: false }),
}));
vi.mock("@/store/features/gameOverlaySettingsStore", () => ({
  useGameOverlaySettings: () => ({ activityPublishEnabled: true, games: {} }),
}));

import { useActivity } from "@/store/features/activityStore";

type HostPresence = { kind: ActivityPresenceKind; titleName: string; gameId?: string } | null;

/** How the host announces the current activity, and how often it repeats it. */
const REPEAT_MS = 30_000;
/** The window after which an unchanged activity is put on the wire again. */
const REPUBLISH_AFTER_MS = 5 * 60_000;

const PORTAL: HostPresence = { kind: ActivityPresenceKind.GAME, titleName: "Portal 2" };
const FACTORIO: HostPresence = { kind: ActivityPresenceKind.GAME, titleName: "Factorio" };

/** The host's side of the IPC channel: `init()` hands it a listener, tests speak through it. */
let announce: (presence: HostPresence) => void;

function startedStore() {
  const store = useActivity();
  store.init();
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  stubs.broadcast.mockResolvedValue(undefined);
  stubs.remove.mockResolvedValue(undefined);
  setActivePinia(createPinia());

  vi.stubGlobal("argon", { isArgonHost: true });
  (window as unknown as { argonIpc: unknown }).argonIpc = {
    onPresenceUpdate: (handler: (data: unknown) => void) => {
      announce = handler as (presence: HostPresence) => void;
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("activity presence publication", () => {
  test("an activity is broadcast once, and the host's repeats are not news", async () => {
    startedStore();

    announce(PORTAL);
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(PORTAL);
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(PORTAL);

    expect(stubs.broadcast).toHaveBeenCalledTimes(1);
    expect(stubs.broadcast).toHaveBeenCalledWith({
      kind: ActivityPresenceKind.GAME,
      titleName: "Portal 2",
      startTimestampSeconds: 0n,
    });
  });

  /**
   * The renewal the server no longer does for free.
   *
   * A session that publishes once and then only repeats itself locally is exactly the shape the
   * server's renewal was written for — and it is also the shape that pins a stale entry forever if
   * the client's one message was lost. Re-asserting on the host's repeat, once the last send is old
   * enough, costs one RPC per five minutes per playing user and makes the entry the client's to
   * keep alive rather than the server's to guess at.
   */
  test("a live activity is re-asserted once the interval has passed", async () => {
    startedStore();

    announce(PORTAL);
    expect(stubs.broadcast).toHaveBeenCalledTimes(1);

    // Every repeat up to the interval is still just a repeat.
    for (let elapsed = REPEAT_MS; elapsed < REPUBLISH_AFTER_MS; elapsed += REPEAT_MS) {
      await vi.advanceTimersByTimeAsync(REPEAT_MS);
      announce(PORTAL);
    }
    expect(stubs.broadcast).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(PORTAL);

    expect(stubs.broadcast).toHaveBeenCalledTimes(2);
  });

  /**
   * "Nothing" is not renewed, because there is nothing to renew: once the removal has landed the
   * server holds no entry, and a repeated removal would be one RPC per idle client per interval for
   * no effect at all. The retry below is what covers a removal that did NOT land.
   */
  test("an absence of activity is not re-asserted", async () => {
    startedStore();

    announce(PORTAL);
    announce(null);
    expect(stubs.remove).toHaveBeenCalledTimes(1);

    for (let elapsed = 0; elapsed < REPUBLISH_AFTER_MS * 2; elapsed += REPEAT_MS) {
      await vi.advanceTimersByTimeAsync(REPEAT_MS);
      announce(null);
    }

    expect(stubs.remove).toHaveBeenCalledTimes(1);
    expect(stubs.broadcast).toHaveBeenCalledTimes(1);
  });

  /**
   * The failure this whole file exists for: the user quits the game during a bad minute — a token
   * refresh in flight, a wifi blip, a 502 from the edge — and the one message that would have taken
   * the activity down is dropped. Nothing behind it repeats: the host has stopped talking about a
   * game that is closed. So the sender retries it itself.
   */
  test("a removal that fails is retried until it lands", async () => {
    stubs.remove
      .mockRejectedValueOnce(new Error("upstream"))
      .mockRejectedValueOnce(new Error("upstream"));

    startedStore();
    announce(PORTAL);
    announce(null);

    expect(stubs.remove).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(stubs.remove).toHaveBeenCalledTimes(3);
  });

  /** Bounded: a server that is properly down gets a few tries, not a loop for the whole session. */
  test("a removal that keeps failing is given up on rather than retried forever", async () => {
    stubs.remove.mockRejectedValue(new Error("upstream"));

    startedStore();
    announce(PORTAL);
    announce(null);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(stubs.remove).toHaveBeenCalledTimes(3);
  });

  /**
   * A retry is a message from the past, and the past must not win.
   *
   * The user closes Portal 2 and opens Factorio while the removal is still being retried. If the
   * retry fired anyway it would delete the entry the new broadcast just wrote, and the user would
   * be playing nothing for as long as Factorio kept running — the dedupe would hold the correction
   * back until the re-publication interval came round.
   */
  test("a removal overtaken by a new activity stops retrying", async () => {
    stubs.remove.mockRejectedValue(new Error("upstream"));

    startedStore();
    announce(PORTAL);
    announce(null);
    expect(stubs.remove).toHaveBeenCalledTimes(1);

    announce(FACTORIO);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stubs.remove).toHaveBeenCalledTimes(1);
    expect(stubs.broadcast).toHaveBeenCalledTimes(2);
    expect(stubs.broadcast).toHaveBeenLastCalledWith({
      kind: ActivityPresenceKind.GAME,
      titleName: "Factorio",
      startTimestampSeconds: 0n,
    });
  });

  /**
   * A broadcast that failed did not happen, and the dedupe must not remember it as though it had —
   * otherwise the user plays for five minutes before anyone is told. The host's next repeat is half
   * a minute away and is the cheapest possible retry, so a failed send simply stops counting as a
   * send.
   */
  test("a broadcast that fails is re-sent on the host's next repeat", async () => {
    stubs.broadcast.mockRejectedValueOnce(new Error("upstream"));

    startedStore();
    announce(PORTAL);
    expect(stubs.broadcast).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(PORTAL);

    expect(stubs.broadcast).toHaveBeenCalledTimes(2);
  });
});
