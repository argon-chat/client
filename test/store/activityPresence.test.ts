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

/** The bus, reduced to the one thing this store listens for: the connection came back. */
const bus = vi.hoisted(() => {
  const listeners: Array<() => void> = [];
  return {
    listeners,
    reconnected: {
      subscribe(handler: () => void) {
        listeners.push(handler);
        return {
          unsubscribe() {
            listeners.splice(listeners.indexOf(handler), 1);
          },
        };
      },
    },
    /** Speak as the bus does when the realtime connection is re-established. */
    reconnect() {
      for (const handler of [...listeners]) handler();
    },
  };
});

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
// The real one builds a SignalR worker on import; all this store wants from it is `reconnected`.
vi.mock("@/store/realtime/busStore", () => ({ useBus: () => bus }));

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

/** `init` is awaited because the reconnect hook is wired through a dynamic import of the bus. */
async function startedStore() {
  const store = useActivity();
  await store.init();
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  bus.listeners.length = 0;
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
    await startedStore();

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
    await startedStore();

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
    await startedStore();

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

    await startedStore();
    announce(PORTAL);
    announce(null);

    expect(stubs.remove).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(stubs.remove).toHaveBeenCalledTimes(3);
  });

  /**
   * Bounded: the quick retries are a burst, not a loop. A server that is properly down gets three
   * attempts over six seconds and is then left alone until something says the world may have
   * changed — the two tests below are what says it.
   */
  test("the quick retries stop rather than hammering a server that is down", async () => {
    stubs.remove.mockRejectedValue(new Error("upstream"));

    await startedStore();
    announce(PORTAL);
    announce(null);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(stubs.remove).toHaveBeenCalledTimes(3);
  });

  /**
   * Six seconds is not an outage.
   *
   * The burst above covers what it was written for — a request that raced a token refresh, a 502
   * from the edge — and nothing else: a wifi handover, a laptop that slept, a deploy rolling
   * through are all measured in tens of seconds or minutes, and all three attempts fall inside
   * them. So the removal is not a loop that gives up but a debt that stays owed, and the host's
   * repeat of "nothing is running" — the one clock still ticking after the game is closed — is
   * what carries it. Without this, the user who quit Portal 2 during a ten-second blip is playing
   * it on every roster until they sign out.
   */
  test("a removal the quick retries could not land is re-attempted on the host's next repeat", async () => {
    stubs.remove
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"));

    await startedStore();
    announce(PORTAL);
    announce(null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stubs.remove).toHaveBeenCalledTimes(3);

    // The connection is back by the time the host repeats itself, and the repeat spends it.
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(null);
    expect(stubs.remove).toHaveBeenCalledTimes(4);

    // It landed. Nothing is owed any more, so the repeats after it are silent again.
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(null);
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(null);
    expect(stubs.remove).toHaveBeenCalledTimes(4);
  });

  /**
   * The reconnect is the better of the two clocks: the host's repeat retries into a connection that
   * is still down and is up to half a minute late when it is not, while the bus knows the moment
   * the socket is back — which is the first attempt with any chance of landing. It is also the only
   * clock left when the host has nothing to repeat because the window reloaded, or the presence
   * feed went quiet with no game running.
   */
  test("a removal owed across an outage is re-attempted the moment the connection is back", async () => {
    stubs.remove.mockRejectedValue(new Error("offline"));

    await startedStore();
    announce(PORTAL);
    announce(null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stubs.remove).toHaveBeenCalledTimes(3);

    stubs.remove.mockResolvedValue(undefined);
    bus.reconnect();
    expect(stubs.remove).toHaveBeenCalledTimes(4);

    // And that one landed, so neither clock has anything left to send.
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(null);
    bus.reconnect();
    expect(stubs.remove).toHaveBeenCalledTimes(4);
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

    await startedStore();
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
   * The same rule, one step later: a removal that is still OWED after its retries were spent is
   * owed no more once a new activity has been published over it. The broadcast overwrites whatever
   * the server was left holding, so there is nothing to take down — and a retry riding one of the
   * clocks would take down Factorio instead, which is the failure the debt exists to prevent.
   */
  test("a new activity settles the debt of a removal that never landed", async () => {
    stubs.remove.mockRejectedValue(new Error("offline"));

    await startedStore();
    announce(PORTAL);
    announce(null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stubs.remove).toHaveBeenCalledTimes(3);

    announce(FACTORIO);
    stubs.remove.mockResolvedValue(undefined);

    // Both clocks tick, and neither has anything to say.
    bus.reconnect();
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(FACTORIO);
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(FACTORIO);

    expect(stubs.remove).toHaveBeenCalledTimes(3);
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

    await startedStore();
    announce(PORTAL);
    expect(stubs.broadcast).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    announce(PORTAL);

    expect(stubs.broadcast).toHaveBeenCalledTimes(2);
  });
});
