import { Archetype, ArgonChannel, ArgonMessage, ArgonSpace, ArgonSpaceBase, ArgonUser, ChannelGroup, SpaceMember, UserActivityPresence, UserStatus } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";
import Dexie, { type Table } from "dexie";

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

export class PoolDatabase extends Dexie {
  users!: Table<RealtimeUser, Guid>;
  servers!: Table<ArgonSpaceBase, Guid>;
  channels!: Table<ArgonChannel, Guid>;
  channelGroups!: Table<ChannelGroup, Guid>;
  messages!: Table<ArgonMessage, number>;
  archetypes!: Table<Archetype, Guid>;
  members!: Table<SpaceMember, Guid>;

  constructor() {
    super("argon-database-v2");
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
  }
}

// Drop old database before creating new one
tryDropOldDb("argon-database");

export const db = new PoolDatabase();
