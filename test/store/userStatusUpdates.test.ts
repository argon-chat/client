/**
 * What a `UserChangedStatus` event does to the user cache.
 *
 * `updateUserStatus` is the single funnel every presence event in the app goes through, and it has
 * two jobs beyond writing a number: it must not leave an offline user wearing an activity ("Playing
 * X" under a grey dot), and it must resolve a user the local database has never seen — a space you
 * just joined, a friend you share no space with — without turning one unlucky request into a
 * permanent hole in the roster.
 *
 * Both failure modes are silent: the roster still renders, it is just wrong, so nothing here can be
 * caught by looking at the app.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { UserStatus } from "@argon/glue";
import { FakeDb } from "./inMemoryDexie";

const h = vi.hoisted(() => ({
  db: null as any,
  lookupUser: null as any,
}));

vi.mock("@/store/db/dexie", () => ({
  get db() {
    return h.db;
  },
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: async () => {},
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    userInteraction: {
      LookupUser: (...args: any[]) => h.lookupUser(...args),
    },
  }),
}));

import { useUserStore } from "@/store/data/userStore";

const user = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  username: userId,
  displayName: userId.toUpperCase(),
  avatarFileId: null,
  flags: 0,
  ...extra,
});

const playing = (title: string) => ({ kind: 0, startTimestampSeconds: 1n, titleName: title });

/** What `LookupUser` answers when the account is allowed to know that user. */
const found = (u: unknown) => ({ isSuccessLookupUser: () => true, user: u });
/** NO_ANCHOR: a real answer meaning "you have no standing to know this user". */
const noAnchor = () => ({ isSuccessLookupUser: () => false, user: null });

describe("updateUserStatus", () => {
  beforeEach(() => {
    h.db = new FakeDb();
    h.lookupUser = vi.fn(async () => noAnchor());
    setActivePinia(createPinia());
  });

  test("writes the new status of a user the cache already holds", async () => {
    h.db.users.seed(user("u1", { status: UserStatus.Offline }));
    const store = useUserStore();

    await store.updateUserStatus("u1", UserStatus.DoNotDisturb);

    expect(h.db.users.peek("u1").status).toBe(UserStatus.DoNotDisturb);
    expect(h.lookupUser).not.toHaveBeenCalled();
  });

  test("every non-offline status reaches the cache verbatim", async () => {
    h.db.users.seed(user("u1", { status: UserStatus.Offline }));
    const store = useUserStore();

    for (const status of [
      UserStatus.Online,
      UserStatus.Away,
      UserStatus.InGame,
      UserStatus.Listen,
      UserStatus.TouchGrass,
      UserStatus.DoNotDisturb,
    ]) {
      await store.updateUserStatus("u1", status);
      expect(h.db.users.peek("u1").status).toBe(status);
    }
  });

  test("going offline drops the activity with it", async () => {
    h.db.users.seed(user("u1", { status: UserStatus.InGame, activity: playing("Half-Life 3") }));
    const store = useUserStore();

    await store.updateUserStatus("u1", UserStatus.Offline);

    expect(h.db.users.peek("u1").status).toBe(UserStatus.Offline);
    expect(h.db.users.peek("u1").activity).toBeUndefined();
  });

  test("a status change that is not offline leaves the activity alone", async () => {
    h.db.users.seed(user("u1", { status: UserStatus.Online, activity: playing("Half-Life 3") }));
    const store = useUserStore();

    await store.updateUserStatus("u1", UserStatus.Away);

    expect(h.db.users.peek("u1").activity).toEqual(playing("Half-Life 3"));
  });

  test("a user the cache has never seen is fetched and stored with the status that arrived", async () => {
    h.lookupUser = vi.fn(async () => found(user("stranger")));
    const store = useUserStore();

    await store.updateUserStatus("stranger", UserStatus.DoNotDisturb);

    expect(h.lookupUser).toHaveBeenCalledTimes(1);
    expect(h.lookupUser).toHaveBeenCalledWith("stranger");
    expect(h.db.users.peek("stranger")).toMatchObject({
      userId: "stranger",
      status: UserStatus.DoNotDisturb,
    });
  });

  test("the second event for the same stranger costs no second request", async () => {
    h.lookupUser = vi.fn(async () => found(user("stranger")));
    const store = useUserStore();

    await store.updateUserStatus("stranger", UserStatus.Online);
    await store.updateUserStatus("stranger", UserStatus.Away);

    expect(h.lookupUser).toHaveBeenCalledTimes(1);
    expect(h.db.users.peek("stranger").status).toBe(UserStatus.Away);
  });

  test("a NO_ANCHOR answer is remembered, and the user is ignored from then on", async () => {
    h.lookupUser = vi.fn(async () => noAnchor());
    const store = useUserStore();

    await store.updateUserStatus("nobody", UserStatus.Online);
    expect(h.lookupUser).toHaveBeenCalledTimes(1);

    // Every later event for that id is dead weight and must not become a request.
    await store.updateUserStatus("nobody", UserStatus.Away);
    await store.updateUserStatus("nobody", UserStatus.Offline);

    expect(h.lookupUser).toHaveBeenCalledTimes(1);
    expect(h.db.users.peek("nobody")).toBeUndefined();
  });

  test("an ignored user is not written even if a later event would create the row", async () => {
    h.lookupUser = vi.fn(async () => noAnchor());
    const store = useUserStore();
    await store.updateUserStatus("nobody", UserStatus.Online);

    // The roster later learns the identity by another route...
    await store.trackUser(user("nobody") as never, UserStatus.Offline);
    // ...and a status event arrives. It is allowed to update the row it now has.
    await store.updateUserStatus("nobody", UserStatus.Online);

    expect(h.lookupUser).toHaveBeenCalledTimes(1);
  });

  /**
   * A failure to reach the server is not an answer, and must not be remembered as one.
   *
   * `ignoredUsers` is a permanent, session-long mute: the guard at the top of `updateUserStatus`
   * drops every later event for that id, and `lookupUser`/`getUsersBatch` skip it too, so an id
   * that lands there loses its name and avatar along with its presence and only comes back on an
   * account switch. That is the right price for a NO_ANCHOR answer (the server saying this account
   * has no standing to know that user — nothing to retry) and much too high for one timed-out or
   * dropped request. `updateUserStatus` used to pay it for both, because its own `catch` called
   * `rememberIgnored`; routing the miss through the store's `lookupUser` keeps the two apart.
   */
  test("a request that failed to reach the server does not ignore the user forever", async () => {
    h.lookupUser = vi.fn(async () => {
      throw new Error("network down");
    });
    const store = useUserStore();

    await store.updateUserStatus("flaky", UserStatus.Online);
    expect(h.lookupUser).toHaveBeenCalledTimes(1);

    // The connection is back and another status event arrives.
    h.lookupUser = vi.fn(async () => found(user("flaky")));
    await store.updateUserStatus("flaky", UserStatus.Online);

    expect(h.lookupUser).toHaveBeenCalledTimes(1);
    expect(h.db.users.peek("flaky")).toMatchObject({ status: UserStatus.Online });
  });

  /**
   * One request per unknown user, however many events arrive about them at once.
   *
   * Presence events come in bursts — `PushFriendPresence` on session start, a space's whole roster
   * on join — so several events for the same unknown user land in the same tick, before any of them
   * has written a row for the next one to find. `updateUserStatus` used to call
   * `api.userInteraction.LookupUser` itself and fire one request per event; going through the
   * store's `lookupUser` folds them into the single in-flight request `pendingLookups` already
   * tracks for the read paths.
   */
  test("a burst of events for one stranger is a single lookup", async () => {
    let resolveLookup!: (value: unknown) => void;
    const gate = new Promise((resolve) => (resolveLookup = resolve));
    h.lookupUser = vi.fn(async () => {
      await gate;
      return found(user("stranger"));
    });
    const store = useUserStore();

    const both = Promise.all([
      store.updateUserStatus("stranger", UserStatus.Online),
      store.updateUserStatus("stranger", UserStatus.DoNotDisturb),
    ]);
    resolveLookup(undefined);
    await both;

    expect(h.lookupUser).toHaveBeenCalledTimes(1);
    // Sharing the request must not cost the status: the stranger is written with a status one of
    // those events carried, never inserted Offline for a roster to render as a grey dot first.
    expect(h.db.users.peek("stranger").status).not.toBe(UserStatus.Offline);
  });
});

describe("resetAllUsersToOffline", () => {
  beforeEach(() => {
    h.db = new FakeDb();
    h.lookupUser = vi.fn(async () => noAnchor());
    setActivePinia(createPinia());
  });

  test("every non-offline user is taken offline", async () => {
    h.db.users.seed(
      user("a", { status: UserStatus.Online }),
      user("b", { status: UserStatus.DoNotDisturb }),
      user("c", { status: UserStatus.Offline }),
    );
    const store = useUserStore();

    await store.resetAllUsersToOffline();

    expect(h.db.users.peek("a").status).toBe(UserStatus.Offline);
    expect(h.db.users.peek("b").status).toBe(UserStatus.Offline);
    expect(h.db.users.peek("c").status).toBe(UserStatus.Offline);
  });

  /**
   * Offline and "Playing X" cannot both be true, whichever path takes the user offline.
   *
   * `updateUserStatus` clears the activity when it writes Offline, and `loadServerDetails`'s
   * reconciliation pass clears it for users who turned up in no space — this is the third such
   * path and the first to run on a bootstrap, so it is the one holding the invariant while the
   * presence snapshot is still in flight. It matters because `FriendListItem.vue` renders
   * `user.activity` with no status condition: a stale activity left behind here is yesterday's game
   * printed under a grey dot for as long as no presence answer arrives to overwrite the row, and if
   * `GetMemberPresence` fails that is the whole session.
   */
  test("a user taken offline does not keep the game they were playing", async () => {
    h.db.users.seed(user("a", { status: UserStatus.InGame, activity: playing("Half-Life 3") }));
    const store = useUserStore();

    await store.resetAllUsersToOffline();

    expect(h.db.users.peek("a").status).toBe(UserStatus.Offline);
    expect(h.db.users.peek("a").activity).toBeUndefined();
  });
});
