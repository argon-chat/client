import { Archetype, ArgonChannel, ArgonMessage, ArgonSpace, ArgonSpaceBase, ArgonUser, ChannelGroup, SpaceMember, UserActivityPresence, UserStatus, type ArgonUserProfile } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";
import Dexie, { type Table } from "dexie";

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
  }
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
