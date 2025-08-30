import { Archetype, ArgonChannel, ArgonMessage, ArgonSpace, ArgonSpaceBase, ArgonUser, SpaceMember, UserActivityPresence, UserStatus } from "@/lib/glue/argonChat";
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
  messages!: Table<ArgonMessage, number>;
  archetypes!: Table<Archetype, Guid>;
  members!: Table<SpaceMember, Guid>;

  constructor() {
    super("argon-db-v4");
    this.version(1).stores({
      users: "userId",
      servers: "spaceId",
      channels: "channelId, spaceId",
      messages:
        "messageId, [channelId+messageId], [spaceId+channelId+messageId]",
      archetypes: "id, spaceId, [Id+spaceId]",
      members:
        "memberId, [memberId+userId], [userId+spaceId], [memberId+userId+spaceId], [memberId+spaceId]",
    });

    tryDropOldDb("argon-db");
    tryDropOldDb("argon-db-v2");
    tryDropOldDb("argon-db-v3");
  }
}

export const db = new PoolDatabase();
