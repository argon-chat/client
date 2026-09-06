/**
 * The presence snapshot versus the events that overtake it.
 *
 * Bootstrapping a space is two answers stitched together: a roster snapshot and a presence list,
 * fetched side by side and then written to the cache a few awaits later. The realtime connection is
 * already up while that happens — it is what `poolStore.init()` subscribes before any of this runs
 * — so a `UserChangedStatus` can arrive after presence was read and before it is written.
 *
 * The event is the newer fact. Presence is a photograph of a moment that has already passed (the
 * server's own `GetPresence` is served from a 1 s cache, so it may be a second stale before it even
 * leaves the building). A write of the older fact on top of the newer one is how a user who came
 * online during startup ends up rendered offline until their next transition — which, if they just
 * came online, may be hours away.
 *
 * @remarks
 * Tests named `KnownPresenceBug:` are expected to be RED against the current code; each carries its
 * own remarks naming the defect.
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
   * KnownPresenceBug — `src/store/data/poolStore.ts`, `writeUsers`: the roster branch builds every
   * row from the presence list it was handed (`status: byId.get(m.userId)?.status ?? Offline`) and
   * `bulkPut`s it over whatever the cache holds.
   *
   * `bulkPut` replaces the whole row, so a status written by a realtime event between the presence
   * answer and this write is discarded — and with the members branch it is discarded even for users
   * presence said nothing about, because those are forced to `Offline` rather than left as they are.
   * The event was the newer fact and the snapshot silently wins.
   *
   * The window is not theoretical: `poolStore.init()` subscribes to events before
   * `loadServerDetails` runs, this path awaits a roster write and a presence call in between, and
   * on a reconnect the first thing the server does is push every friend's presence.
   *
   * Expected: the bootstrap fills in what it knows without overwriting anything more recent.
   */
  test("KnownPresenceBug: a status event that lands while the roster is being written survives it", async () => {
    // The cache as `init()` leaves it: everybody offline, waiting for the snapshot.
    h.db.users.seed({ ...identity("u1"), status: UserStatus.Offline });

    const gate = deferred<void>();
    h.api = api({
      members: [member("u1")],
      presence: [presenceOf("u1", UserStatus.Offline)],
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

    expect(h.db.users.peek("u1").status).toBe(UserStatus.Online);
  });

  /**
   * KnownPresenceBug — same defect through the other branch of `writeUsers`.
   *
   * On every launch after the first the space's roster version matches, so the server sends no
   * members and `writeUsers` takes the `bulkUpdate` path — which writes `status` and `activity`
   * from the same already-stale presence list. This is the branch that runs in the common case.
   */
  test("KnownPresenceBug: the same event survives a bootstrap whose roster version matched", async () => {
    h.db.users.seed({ ...identity("u1"), status: UserStatus.Offline });
    h.db.members.seed(member("u1"));

    const gate = deferred<void>();
    h.api = api({
      members: null,
      presence: [presenceOf("u1", UserStatus.Offline)],
      presenceGate: gate.promise,
    });

    const pool = usePoolStore();
    const users = useUserStore();
    const loading = pool.loadServerDetails();

    await users.updateUserStatus("u1", UserStatus.Online);
    gate.resolve();
    await loading;

    expect(h.db.users.peek("u1").status).toBe(UserStatus.Online);
  });
});
