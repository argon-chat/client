/**
 * The presence snapshot versus the events that overtake it.
 *
 * Bootstrapping a space is two answers stitched together: a roster snapshot and a presence list,
 * fetched side by side and then written to the cache a few awaits later. `writeUsers` is a
 * last-writer-wins replace — `bulkPut` on the roster branch, a `bulkUpdate` of `status`/`activity`
 * on the version-matched branch — so whatever the snapshot says is what the cache ends up holding.
 *
 * That is deliberate, and this file pins it. `loadServerDetails()` exists to replace what the client
 * holds with the server's answer, and `MemberPresence` carries no timestamp or version to merge by,
 * so there is nothing the write could compare against to decide it is older. The window in which it
 * matters is also much narrower than it looks: the SignalR worker is created in exactly one place
 * (`busStore.doListenSignalR` <- `doListenMyEvents` <- `meStore.completeInit`), and
 * `appState.loadUserData()` awaits `poolStore.loadServerDetails()` BEFORE calling `completeInit()`.
 * So at cold boot, after login and after an account switch there is no transport yet and no event
 * can arrive at all. `poolStore.init()` only wires RxJS subjects; it creates nothing.
 *
 * Where the window is real is the resync call sites the bootstrap story never mentions:
 * `systemStore`'s `bus.reconnected` after a long outage and `bus.needFullResync`,
 * `IonWsClient.on("reconnected")`, `serverStore.createServer`/`joinToServer`, and the settings
 * refreshes. There the connection is live, `GetMemberPresence` is served from `SpaceReadGrain`'s 1 s
 * HybridCache, and three `replaceSpaceRows` writes are awaited before `writeUsers` lands. A status
 * event arriving inside that sub-second window is replaced by the snapshot's older value and the
 * server will not resend it (`UserSessionGrain.HeartBeatAsync` only re-broadcasts when
 * `PreferredStatus` actually changes), so that member renders with the pre-change status until their
 * next real transition, a later resync, or a restart.
 *
 * @remarks
 * Whether that should be fixed is an open product decision (design question C6), not a coding
 * mistake — which is why the two tests below assert the current, intended semantics rather than
 * failing. If the team decides events should win, the shape is: stamp the moment
 * `GetMemberPresence` is issued, have `userStore.updateUserStatus` record `userId -> appliedAt`,
 * and in `writeUsers` skip the `status`/`activity` fields (never the identity fields) for a user
 * touched after that stamp. Flipping these two tests is then a deliberate act, which is the point of
 * writing them down.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { UserStatus } from "@argon/glue";
import { FakeDb } from "./inMemoryDexie";

const h = vi.hoisted(() => ({
  db: null as any,
  api: null as any,
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

vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count() {}, distribution() {}, gauge() {} },
  enumName: () => "x",
  errorKind: () => "x",
  bucket: () => "x",
  COUNT_EDGES: [],
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => h.api,
}));

vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({ listenEvents() {}, onServerEvent: () => ({ unsubscribe() {} }) }),
}));
vi.mock("@/store/data/channelStore", () => ({
  useChannelStore: () => ({ selectedTextChannel: null, selectedChannel: null }),
}));
vi.mock("@/store/data/archetypeStore", () => ({
  useArchetypeStore: () => ({ initPermissionsWatcher() {} }),
}));
vi.mock("@/store/realtime/realtimeStore", () => ({ useRealtimeStore: () => ({ realtimeChannels: {} }) }));
vi.mock("@/store/realtime/eventStore", () => ({ useEventStore: () => ({ subscribeToEvents() {} }) }));
vi.mock("@/store/data/messageStore", () => ({ useMessageStore: () => ({}) }));

import { usePoolStore } from "@/store/data/poolStore";
import { useUserStore } from "@/store/data/userStore";

const SPACE = "space-1";

const identity = (userId: string) => ({
  userId,
  username: userId,
  displayName: userId.toUpperCase(),
  avatarFileId: null,
  flags: 0,
});

const member = (userId: string) => ({
  memberId: `m-${userId}`,
  spaceId: SPACE,
  userId,
  user: identity(userId),
  archetypes: [],
});

const presenceOf = (userId: string, status: UserStatus, activity: unknown = null) => ({
  userId,
  status,
  activity,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Stands up the API the bootstrap talks to.
 *
 * `members` decides which of the two shapes `writeUsers` takes: an array is a space whose roster
 * the server re-sent, `null` is a space whose version matched and whose rows are already cached.
 */
function api(options: {
  members: ReturnType<typeof member>[] | null;
  presence: ReturnType<typeof presenceOf>[];
  presenceGate?: Promise<void>;
}) {
  return {
    userInteraction: {
      GetSpaces: async () => [{ spaceId: SPACE, name: "Space", avatarFileId: null }],
      LookupUser: async () => ({ isSuccessLookupUser: () => false, user: null }),
    },
    serverInteraction: {
      GetSpaceSnapshot: async () => ({
        versions: { members: "v1", channels: "v1", archetypes: "v1", groups: "v1" },
        members: options.members,
        channels: null,
        groups: null,
        archetypes: null,
      }),
      GetMemberPresence: async () => {
        if (options.presenceGate) await options.presenceGate;
        return options.presence;
      },
      PrefetchUser: async () => null,
    },
  };
}

describe("presence snapshot", () => {
  beforeEach(() => {
    h.db = new FakeDb();
    setActivePinia(createPinia());
  });

  test("writes the status the presence call reported", async () => {
    h.api = api({
      members: [member("u1"), member("u2")],
      presence: [presenceOf("u1", UserStatus.DoNotDisturb), presenceOf("u2", UserStatus.Online)],
    });

    await usePoolStore().loadServerDetails();

    expect(h.db.users.peek("u1").status).toBe(UserStatus.DoNotDisturb);
    expect(h.db.users.peek("u2").status).toBe(UserStatus.Online);
  });

  test("a member presence never mentioned is offline, not absent", async () => {
    h.api = api({
      members: [member("u1"), member("u2")],
      presence: [presenceOf("u1", UserStatus.Online)],
    });

    await usePoolStore().loadServerDetails();

    expect(h.db.users.peek("u2").status).toBe(UserStatus.Offline);
  });

  test("a cached user who is in none of the loaded spaces is taken offline and loses their activity", async () => {
    h.db.users.seed({
      ...identity("gone"),
      status: UserStatus.InGame,
      activity: { kind: 0, startTimestampSeconds: 1n, titleName: "Half-Life 3" },
    });
    h.api = api({ members: [member("u1")], presence: [presenceOf("u1", UserStatus.Online)] });

    await usePoolStore().loadServerDetails();

    expect(h.db.users.peek("gone").status).toBe(UserStatus.Offline);
    expect(h.db.users.peek("gone").activity).toBeUndefined();
  });

  /**
   * The roster branch of `writeUsers` (`src/store/data/poolStore.ts`) builds every row from the
   * presence list it was handed (`status: byId.get(m.userId)?.status ?? Offline`) and `bulkPut`s it
   * over whatever the cache holds, so a status written by a realtime event between the presence
   * answer and this write is replaced.
   *
   * That is the resync contract: the server's answer is authoritative and the cache is rebuilt from
   * it. `MemberPresence` carries nothing to order the two facts by, and `SpaceReadGrain.GetPresence`
   * is itself served from a 1 s cache, so "the event is newer" is not something this code can know.
   * The `?? Offline` half is not a second defect either — `SpaceReadGrain.GetPresence` projects one
   * `MemberPresence` per roster id, defaulting absent ones to Offline, so `byId` covers the whole
   * roster and the fallback only bites when the presence RPC was rejected outright.
   *
   * Design question C6: see the file header for the shape of the alternative and why flipping this
   * assertion has to be deliberate.
   */
  test("the roster snapshot is authoritative over a status event that raced it", async () => {
    // The cache as `init()` leaves it: everybody offline, waiting for the snapshot.
    h.db.users.seed({ ...identity("u1"), status: UserStatus.Offline });

    const gate = deferred<void>();
    h.api = api({
      members: [member("u1")],
      presence: [presenceOf("u1", UserStatus.DoNotDisturb)],
      presenceGate: gate.promise,
    });

    const pool = usePoolStore();
    const users = useUserStore();
    const loading = pool.loadServerDetails();

    // u1 comes online while the bootstrap is still in flight; the event is handled the moment it
    // arrives, exactly as `eventStore`'s `UserChangedStatus` subscription does.
    await users.updateUserStatus("u1", UserStatus.Online);
    gate.resolve();
    await loading;

    expect(h.db.users.peek("u1").status).toBe(UserStatus.DoNotDisturb);
    // The identity half is rebuilt, not merged away: the row is whole after the replace.
    expect(h.db.users.peek("u1").displayName).toBe("U1");
  });

  /**
   * The other branch of `writeUsers`, and the one that runs in the common case: on every launch
   * after the first the space's roster version matches, the server sends no members, and the write
   * is a `bulkUpdate` of `status` and `activity` from the same presence list. Same contract, same
   * outcome — the snapshot wins — reached through different Dexie semantics, so both are pinned.
   */
  test("the version-matched snapshot is authoritative over a status event that raced it", async () => {
    h.db.users.seed({ ...identity("u1"), status: UserStatus.Offline });
    h.db.members.seed(member("u1"));

    const gate = deferred<void>();
    h.api = api({
      members: null,
      presence: [presenceOf("u1", UserStatus.DoNotDisturb)],
      presenceGate: gate.promise,
    });

    const pool = usePoolStore();
    const users = useUserStore();
    const loading = pool.loadServerDetails();

    await users.updateUserStatus("u1", UserStatus.Online);
    gate.resolve();
    await loading;

    expect(h.db.users.peek("u1").status).toBe(UserStatus.DoNotDisturb);
    expect(h.db.users.peek("u1").displayName).toBe("U1");
  });
});
