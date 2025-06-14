import Dexie, { Table } from 'dexie';

export type RealtimeUser = IUserDto & { status: UserStatus, activity?: IUserActivityPresence, archetypes?: IArchetypeDto[] };

const tryDropOldDb = (s: string) => { try { indexedDB.deleteDatabase(s) } catch {} };

export class PoolDatabase extends Dexie {
  users!: Table<RealtimeUser, Guid>;
  servers!: Table<IServerDto, Guid>;
  channels!: Table<IChannel, Guid>;
  messages!: Table<IArgonMessageDto, number>;
  archetypes!: Table<IArchetypeDto, Guid>;
  members!: Table<IServerMemberDto, Guid>;

  constructor() {
    super('argon-db-v3');
    this.version(1).stores({
      users: 'UserId',
      servers: 'Id',
      channels: 'Id, ServerId',
      messages: 'MessageId, [ChannelId+MessageId], [ServerId+ChannelId+MessageId]',
      archetypes: 'Id, ServerId, [Id+ServerId]',
      members: 'MemberId, [MemberId+UserId], [UserId+ServerId], [MemberId+UserId+ServerId], [MemberId+ServerId]'
    });

    tryDropOldDb("argon-db");
    tryDropOldDb("argon-db-v2");
  }
}

export const db = new PoolDatabase();