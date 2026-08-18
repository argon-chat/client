import { Archetype, ArgonChannel, ArgonMessage, ArgonSpace, ArgonSpaceBase, ArgonUser, ChannelGroup, SpaceMember, UserActivityPresence, UserStatus, type ArgonUserProfile, type SpaceVersions } from "@argon/glue";
import { Guid, IonDateTime } from "@argon-chat/ion.webcore";
import Dexie, { type Table, type Transaction } from "dexie";

/** ArgonMessage with a numeric _msgId for IndexedDB indexing (bigint can't be an IDB key) */
export type StoredMessage = ArgonMessage & { _msgId: number };

export type RealtimeUser = ArgonUser & {
  status: UserStatus;
  activity?: UserActivityPresence;
  archetypes?: Archetype[];
};

const tryDropOldDb = (s: string) => {
  try {
    indexedDB.deleteDatabase(s);
  } catch {}
};

/**
 * Per-account database isolation. Each account gets its own Dexie DB named
 * `argon-database-v3-<activeAccountId>`. The active account id is read straight from localStorage
 * (NOT via accountsStore) so this module stays free of store import cycles — it's imported by ~22
 * data stores. Because switching accounts reloads the page, reading the pointer at module-load is
 * always correct (the pointer is written before the reload). Pre-first-login falls back to "default"
 * (that DB stays empty — pool data is only written once authenticated).
 */
function activeDbSuffix(): string {
  try {
    const id = localStorage.getItem("argon_active_account");
    if (id && /^[a-z0-9-]+$/.test(id)) return id;
  } catch {}
  return "default";
}

/** Convert ArgonMessage to StoredMessage by adding numeric _msgId */
export function toStoredMessage(msg: ArgonMessage): StoredMessage {
  return { ...msg, _msgId: Number(msg.messageId) };
}

/**
 * The server's own version tokens for one space's cached parts, kept so the next bootstrap can say
 * what it already has and be sent only what moved.
 *
 * The tokens are opaque — nothing here reads one, it is stored exactly as given and handed straight
 * back. A row is only written once every part of that same answer landed in its table, because a
 * token that outlives the data it describes is worse than no token: the server would answer "you
 * already have it" about rows that are not there. For the same reason this table is emptied with
 * every other one, never on its own.
 */
export interface StoredSpaceVersions {
  spaceId: Guid;
  versions: SpaceVersions;
}

export interface CachedProfile {
  key: string; // `${spaceId}:${userId}`
  spaceId: string;
  userId: string;
  profile: ArgonUserProfile;
  fetchedAt: number;
}

export class PoolDatabase extends Dexie {
  users!: Table<RealtimeUser, Guid>;
  servers!: Table<ArgonSpaceBase, Guid>;
  channels!: Table<ArgonChannel, Guid>;
  channelGroups!: Table<ChannelGroup, Guid>;
  messages!: Table<StoredMessage, number>;
  archetypes!: Table<Archetype, Guid>;
  members!: Table<SpaceMember, Guid>;
  profileCache!: Table<CachedProfile, string>;
  spaceVersions!: Table<StoredSpaceVersions, Guid>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      users: "userId, status",
      servers: "spaceId",
      channels: "channelId, spaceId",
      channelGroups: "groupId, spaceId",
      messages:
        "++id, messageId, [channelId+messageId], [spaceId+channelId+messageId]",
      archetypes: "id, spaceId, [Id+spaceId]",
      members:
        "memberId, spaceId, [memberId+userId], [userId+spaceId], [memberId+userId+spaceId], [memberId+spaceId]",
    });
    // v2: _msgId (Number) as PK — bigint can't be an IndexedDB key.
    // put() now upserts by _msgId, no duplicate rows.
    this.version(2).stores({
      messages:
        "_msgId, [channelId+_msgId], [spaceId+channelId+_msgId]",
    });
    // v3: profile cache table
    this.version(3).stores({
      profileCache: "key, userId, spaceId",
    });
    // v4: purge the message cache once. Older rows baked an absolute, region-specific attachment
    // `downloadUrl` into the cached message entities; a transient VPN/region could pin a dead
    // cross-region URL there forever. URLs are now region-agnostic (resolved per-fetch by the server
    // geo-redirect), so we drop the stale cache and let it refill clean on next channel open.
    this.version(4).stores({}).upgrade((tx) => tx.table("messages").clear());
    // v5: everything the glue writes changed shape when ion moved `datetime` from
    // `{ date: Date; offsetMinutes: number }` to `IonDateTime`, and rows written under the old
    // contract cannot be read under the new one.
    //
    // The standing policy from here on: a version bump empties the whole cache rather than
    // migrating it. Every table is a cache of server state and refills on the next open, so the
    // cost is one cold start, and that is cheaper than a per-table upgrade path that has to be
    // right about a contract that has already moved on.
    this.version(5).stores({}).upgrade(purgeEverything);
    // v6: per-space version tokens for the bootstrap snapshot. Purges like every other bump — the
    // new table starts empty either way, and arriving with no tokens is exactly the case the
    // server already handles (it sends everything).
    this.version(6).stores({
      spaceVersions: "spaceId",
    }).upgrade(purgeEverything);

    // Registered after the last `stores()` call on purpose: `Version.stores()` runs
    // `removeTablesApi` before rebuilding the table objects, so a hook attached against an earlier
    // version is discarded without a warning.
    this.messages.hook("reading", onRow((row) => {
      row.timeSent = liveDateTime(row.timeSent);
    }));
    this.members.hook("reading", onRow((row) => {
      row.joinedAt = liveDateTime(row.joinedAt);
    }));
    this.profileCache.hook("reading", onRow((row) => {
      if (row.profile) row.profile.registeredAt = liveDateTime(row.profile.registeredAt);
    }));
  }
}

/**
 * Wraps a `reading` hook so it only ever sees an actual row.
 *
 * Dexie fires `reading` on the raw result of every read, and `Table.get` for a key that is not
 * there resolves to `undefined` — the hook still runs, on nothing. A hook that reaches straight
 * for a field therefore throws on a cache miss, which is the single most ordinary thing that can
 * happen to a cache. The revived row is mutated in place and returned, matching what the hook
 * contract expects.
 */
function onRow<T>(revive: (row: T) => void): (row: T) => T {
  return (row) => {
    if (row != null) revive(row);
    return row;
  };
}

/**
 * Rebuilds an `IonDateTime` that IndexedDB flattened on the way out. Null and already-live values
 * pass through untouched.
 *
 * IndexedDB persists values with the structured clone algorithm, which copies own properties and
 * drops the prototype. `IonDateTime` keeps its entire surface there — `toDate`, `toOffset`,
 * `toString` — so without this a cached row comes back holding the right numbers and answers
 * `timeSent.toDate is not a function` at the first call site. The type checker cannot see it: the
 * value written and the value read have the same declared type.
 *
 * The cache is not what changed; the contract is. The previous glue spelled a datetime
 * `{ date: Date; offsetMinutes: number }` — plain data, which survived the round trip intact.
 */
function liveDateTime<T>(value: T): T {
  if (value == null || value instanceof IonDateTime) return value;

  const flat = value as unknown as IonDateTime;
  return new IonDateTime(flat.unixTicks, flat.offsetMinutes) as unknown as T;
}

/**
 * Empties every store in the transaction. Written against `tx.storeNames` rather than a list, so a
 * table added later is purged too without anyone having to remember this function exists.
 */
function purgeEverything(tx: Transaction): Promise<unknown> {
  return Promise.all(tx.storeNames.map((store) => tx.table(store).clear()));
}

// Drop old database before creating new one
tryDropOldDb("argon-database");

// `db` is a stable forwarding Proxy over a swappable PoolDatabase instance. ~22 modules import it as a
// const; routing every access through the proxy lets seamless account switching close the old DB and
// open the new account's DB WITHOUT a page reload — those importers keep working transparently. Methods
// are bound to the live instance so Dexie's internal `this` is correct.
let _dbName = `argon-database-v3-${activeDbSuffix()}`;
let _instance = new PoolDatabase(_dbName);

export const db: PoolDatabase = new Proxy({} as PoolDatabase, {
  get(_t, prop) {
    const v = (_instance as any)[prop];
    return typeof v === "function" ? v.bind(_instance) : v;
  },
  set(_t, prop, value) {
    (_instance as any)[prop] = value;
    return true;
  },
});

/** The live underlying Dexie name (for diagnostics / orphan GC). */
export function currentDbName(): string {
  return _dbName;
}

/**
 * Seamless switch: close the current account's DB and open the active account's DB (read from the
 * persisted pointer). Existing liveQuery subscriptions are bound to the OLD instance, so callers MUST
 * reset the stores that hold them and re-init AFTER this resolves. No-op when already on the right DB.
 */
export async function reopenActiveAccountDb(): Promise<void> {
  const next = `argon-database-v3-${activeDbSuffix()}`;
  if (next === _dbName) return;
  try { _instance.close(); } catch { /* ignore */ }
  _dbName = next;
  _instance = new PoolDatabase(next);
  await _instance.open();
}
