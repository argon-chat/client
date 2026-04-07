import { Archetype, ArgonChannel, ArgonMessage, ArgonSpace, ArgonSpaceBase, ArgonUser, ChannelGroup, SpaceMember, UserActivityPresence, UserStatus } from "@argon/glue";
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

/** Convert ArgonMessage to StoredMessage by adding numeric _msgId */
export function toStoredMessage(msg: ArgonMessage): StoredMessage {
  return { ...msg, _msgId: Number(msg.messageId) };
}

export class PoolDatabase extends Dexie {
  users!: Table<RealtimeUser, Guid>;
  servers!: Table<ArgonSpaceBase, Guid>;
  channels!: Table<ArgonChannel, Guid>;
  channelGroups!: Table<ChannelGroup, Guid>;
  messages!: Table<StoredMessage, number>;
  archetypes!: Table<Archetype, Guid>;
  members!: Table<SpaceMember, Guid>;

  constructor() {
    super("argon-database-v3");
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
  }
}

// Drop old database before creating new one
tryDropOldDb("argon-database");

export const db = new PoolDatabase();
