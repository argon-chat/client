/**
 * The upgrade that drops profile rows cached before worn cosmetics were kept: they hold
 * `cosmetics: null` ("not told") and would draw nobody's look until they aged out.
 */

import {
  describe,
  expect,
  test,
  vi,
} from "vitest";

await vi.hoisted(async () => {
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");

  Object.assign(globalThis, { indexedDB, IDBKeyRange });
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)),
}));

import Dexie from "dexie";

import { PoolDatabase } from "@/store/db/dexie";

describe("the v11 upgrade", () => {
  test("empties the profile cache and keeps every other table", async () => {
    const name = "probe-upgrade-v10";
    const previous = new Dexie(name);

    previous.version(10).stores({
      profileCache: "key, userId, spaceId",
      channels: "channelId, spaceId, type",
    });

    await previous.table("profileCache").put({
      key: "s1:u1",
      spaceId: "s1",
      userId: "u1",
      profile: { userId: "u1", cosmetics: null },
      fetchedAt: Date.now(),
      scope: "status",
    });
    await previous.table("channels").put({ channelId: "c1", spaceId: "s1", type: 0 });
    previous.close();

    const upgraded = new PoolDatabase(name);

    await upgraded.open();

    expect(await upgraded.profileCache.count()).toBe(0);
    expect(await upgraded.channels.count()).toBe(1);

    upgraded.close();
  });
});
