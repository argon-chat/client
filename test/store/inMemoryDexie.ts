/**
 * A stand-in for `@/store/db/dexie` that keeps rows in a Map.
 *
 * The app has no IndexedDB in tests (`fake-indexeddb` is not a dependency and happy-dom ships no
 * implementation), so the stores that read and write through Dexie cannot be exercised against the
 * real thing. This is the smallest surface that lets them run unchanged: only the operations the
 * presence path actually uses, with Dexie's own semantics where they are load-bearing —
 *
 *  - values are structured-cloned on the way in and on the way out, exactly as IndexedDB stores
 *    them, so a row a test holds is never the row a store later mutates;
 *  - `update(key, fn)` answers 1 when the key exists and 0 when it does not, which is the signal
 *    `userStore.updateUserStatus` branches on;
 *  - `bulkUpdate` counts the rows it FOUND, not the rows whose values differed — the count
 *    `poolStore.writeUsers` compares against the presence length.
 *
 * It is not a Dexie emulator: anything past these operations will throw rather than quietly answer
 * something plausible.
 */

export type Row = Record<string, any>;

/** Dexie hands back clones; so does this, or a test would be asserting on the store's own object. */
const copy = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

class FakeCollection<T extends Row> {
  constructor(
    private table: FakeTable<T>,
    private match: (row: T) => boolean,
  ) {}

  private matched(): { key: any; row: T }[] {
    return [...this.table.entries()].filter(([, row]) => this.match(row)).map(([key, row]) => ({ key, row }));
  }

  async toArray(): Promise<T[]> {
    return this.matched().map((m) => copy(m.row));
  }

  async first(): Promise<T | undefined> {
    return copy(this.matched()[0]?.row);
  }

  async primaryKeys(): Promise<any[]> {
    return this.matched().map((m) => m.key);
  }

  async count(): Promise<number> {
    return this.matched().length;
  }

  async modify(changes: ((row: T) => unknown) | Partial<T>): Promise<number> {
    let modified = 0;
    for (const { key, row } of this.matched()) {
      const draft = copy(row);
      if (typeof changes === "function") {
        if (changes(draft) === false) continue;
      } else {
        Object.assign(draft, changes);
      }
      this.table.setRaw(key, draft);
      modified++;
    }
    return modified;
  }

  async delete(): Promise<number> {
    const hits = this.matched();
    for (const { key } of hits) this.table.deleteRaw(key);
    return hits.length;
  }
}

class FakeWhere<T extends Row> {
  constructor(
    private table: FakeTable<T>,
    private field: string,
  ) {}

  equals(value: any) {
    return new FakeCollection<T>(this.table, (row) => row[this.field] === value);
  }

  notEqual(value: any) {
    return new FakeCollection<T>(this.table, (row) => row[this.field] !== value);
  }

  anyOf(values: any[]) {
    const wanted = new Set(values.map((v) => (Array.isArray(v) ? JSON.stringify(v) : v)));
    return new FakeCollection<T>(this.table, (row) => wanted.has(row[this.field]));
  }
}

export class FakeTable<T extends Row> {
  private rows = new Map<any, T>();

  constructor(
    public readonly name: string,
    private readonly primaryKey: string,
  ) {}

  // --- test-side access, never used by product code ---
  entries() {
    return this.rows.entries();
  }
  setRaw(key: any, row: T) {
    this.rows.set(key, row);
  }
  deleteRaw(key: any) {
    this.rows.delete(key);
  }
  /** Seed rows without going through the async surface. */
  seed(...rows: T[]) {
    for (const row of rows) this.rows.set(row[this.primaryKey], copy(row));
    return this;
  }
  /** The live row, uncloned — for assertions only. */
  peek(key: any): T | undefined {
    return this.rows.get(key);
  }
  get size() {
    return this.rows.size;
  }

  // --- the Dexie surface the stores use ---
  async get(key: any): Promise<T | undefined> {
    return copy(this.rows.get(key));
  }

  async put(row: T, key?: any): Promise<any> {
    const id = key ?? row[this.primaryKey];
    this.rows.set(id, copy(row));
    return id;
  }

  async bulkPut(rows: T[]): Promise<void> {
    for (const row of rows) this.rows.set(row[this.primaryKey], copy(row));
  }

  async bulkGet(keys: any[]): Promise<(T | undefined)[]> {
    return keys.map((key) => copy(this.rows.get(key)));
  }

  async bulkDelete(keys: any[]): Promise<void> {
    for (const key of keys) this.rows.delete(key);
  }

  async delete(key: any): Promise<void> {
    this.rows.delete(key);
  }

  async update(key: any, changes: ((row: T) => unknown) | Partial<T>): Promise<number> {
    const row = this.rows.get(key);
    if (!row) return 0;
    const draft = copy(row);
    if (typeof changes === "function") {
      if (changes(draft) === false) return 0;
    } else {
      Object.assign(draft, changes);
    }
    this.rows.set(key, draft);
    return 1;
  }

  /** Dexie counts the rows it found, whether or not the values differed. */
  async bulkUpdate(entries: { key: any; changes: Partial<T> }[]): Promise<number> {
    let found = 0;
    for (const { key, changes } of entries) {
      const row = this.rows.get(key);
      if (!row) continue;
      const draft = copy(row);
      Object.assign(draft, changes);
      this.rows.set(key, draft);
      found++;
    }
    return found;
  }

  async toArray(): Promise<T[]> {
    return [...this.rows.values()].map(copy);
  }

  async count(): Promise<number> {
    return this.rows.size;
  }

  where(field: string) {
    return new FakeWhere<T>(this, field);
  }

  filter(predicate: (row: T) => boolean) {
    return new FakeCollection<T>(this, predicate);
  }

  offset(n: number) {
    const all = [...this.rows.values()];
    return {
      limit: (take: number) => ({ toArray: async () => all.slice(n, n + take).map(copy) }),
    };
  }
}

export class FakeDb {
  users = new FakeTable<any>("users", "userId");
  servers = new FakeTable<any>("servers", "spaceId");
  channels = new FakeTable<any>("channels", "channelId");
  channelGroups = new FakeTable<any>("channelGroups", "groupId");
  messages = new FakeTable<any>("messages", "_msgId");
  archetypes = new FakeTable<any>("archetypes", "id");
  members = new FakeTable<any>("members", "memberId");
  profileCache = new FakeTable<any>("profileCache", "key");
  spaceVersions = new FakeTable<any>("spaceVersions", "spaceId");

  /** Dexie runs the body inside a transaction; nothing here needs the isolation, only the shape. */
  async transaction(_mode: string, ...args: any[]): Promise<any> {
    const body = args[args.length - 1] as () => any;
    return await body();
  }

  async open() {
    return this;
  }
  async close() {}
}
