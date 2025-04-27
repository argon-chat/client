import { UserStatus } from '@/lib/glue/UserStatus';
import Dexie, { Table } from 'dexie';

export type RealtimeUser = IUserDto & { status: UserStatus, activity?: IUserActivityPresence };


const tryDropOldDb = (s: string) => { try { indexedDB.deleteDatabase(s) } catch {} };


export class PoolDatabase extends Dexie {
  users!: Table<RealtimeUser, Guid>;
  servers!: Table<IServerDto, Guid>;
  channels!: Table<IChannel, Guid>;
  messages!: Table<IArgonMessageDto, number>;

  constructor() {
    super('argon-db-v2');
    this.version(1).stores({
      users: 'UserId',
      servers: 'Id',
      channels: 'Id, ServerId',
    });
    this.version(2).stores({
      users: 'UserId',
      servers: 'Id',
      channels: 'Id, ServerId',
      messages: 'MessageId, [ChannelId+MessageId], [ServerId+ChannelId+MessageId]',
    });

    tryDropOldDb("argon-db");
  }
}

export const db = new PoolDatabase();