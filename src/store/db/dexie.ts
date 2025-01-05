import { UserStatus } from '@/lib/glue/UserStatus';
import Dexie, { Table } from 'dexie';

export type RealtimeUser = IUser & { status: UserStatus };


export class PoolDatabase extends Dexie {
  users!: Table<RealtimeUser, Guid>;
  servers!: Table<IServer, Guid>;
  channels!: Table<IChannel, Guid>;

  constructor() {
    super('argon-db');
    this.version(1).stores({
      users: 'Id',
      servers: 'Id',
      channels: 'Id, ServerId',
    });
  }
}

export const db = new PoolDatabase();