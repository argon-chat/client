/**
 * Where each status puts a member in the space's member list.
 *
 * The member list has exactly two claims to make: who is around, and who is not. Everything that is
 * not `Offline` is "around" — Away, Do Not Disturb, TouchGrass, InGame, Listen are all a user who is
 * there and reachable, differing only in what colour their dot is. Sorting any of them into the
 * "Offline" bucket would say something about them that is not true, and would do it in the one place
 * a user looks to decide whether it is worth typing.
 *
 * The list is Dexie-backed and there is no IndexedDB in tests (`fake-indexeddb` is not a
 * dependency), so the tables and `liveQuery` are stood in for — see `inMemoryDexie.ts`. The
 * grouping and sorting under test are pure functions of what those tables answer, which is what
 * makes the substitution honest here.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { ref, nextTick } from "vue";
import { UserStatus } from "@argon/glue";
import { FakeDb } from "./inMemoryDexie";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@/store/db/dexie", () => ({
  get db() {
    return h.db;
  },
}));

// The real `liveQuery` needs Dexie's observability middleware, which needs a real database. The
// composable only ever asks it for "run this and hand me the result", so that is what it gets.
vi.mock("dexie", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    liveQuery: (query: () => Promise<unknown>) => ({
      subscribe: ({ next, error }: { next: (value: unknown) => void; error?: (e: unknown) => void }) => {
        query().then(next, error ?? (() => {}));
        return { unsubscribe() {} };
      },
    }),
  };
});

import { useGroupedServerUsers } from "@/composables/useGroupedServerUsers";

const SPACE = "space-1";

const user = (userId: string, status: UserStatus, displayName = userId.toUpperCase()) => ({
  userId,
  username: userId,
  displayName,
  avatarFileId: null,
  flags: 0,
  status,
});

const member = (userId: string) => ({
  memberId: `m-${userId}`,
  spaceId: SPACE,
  userId,
  archetypes: [] as { archetypeId: string }[],
});

/** Seed a space whose whole roster is ungrouped, so the buckets are "Users" and "Offline". */
function seedRoster(...people: ReturnType<typeof user>[]) {
  h.db.servers.seed({ spaceId: SPACE, name: "Space" });
  h.db.users.seed(...people);
  h.db.members.seed(...people.map((p) => member(p.userId)));
}

/** Run the composable and let its (mocked) live query deliver once. */
async function groups() {
  const result = useGroupedServerUsers(ref(SPACE));
  await nextTick();
  // `buildGroups` is a chain of table reads; one macrotask lets the whole chain settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return result.value;
}

const names = (bucket: { users: { displayName: string }[] } | undefined) =>
  (bucket?.users ?? []).map((u) => u.displayName);

describe("member list grouping", () => {
  beforeEach(() => {
    h.db = new FakeDb();
    // The composable registers an unmount hook; outside a component Vue only warns about it.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("Online comes first and Offline is a bucket of its own, last", async () => {
    seedRoster(
      user("c", UserStatus.Offline, "Cara"),
      user("a", UserStatus.Online, "Ann"),
      user("b", UserStatus.Away, "Bob"),
    );

    const result = await groups();

    expect(result.map((g) => g.archetype.name)).toEqual(["Users", "Offline"]);
    expect(names(result[0])).toEqual(["Ann", "Bob"]);
    expect(names(result[1])).toEqual(["Cara"]);
  });

  test.each([
    ["Away", UserStatus.Away],
    ["DoNotDisturb", UserStatus.DoNotDisturb],
    ["TouchGrass", UserStatus.TouchGrass],
    ["InGame", UserStatus.InGame],
    ["Listen", UserStatus.Listen],
  ])("%s is a user who is around, not an offline one", async (_label, status) => {
    seedRoster(user("a", UserStatus.Online, "Ann"), user("b", status, "Bob"));

    const result = await groups();

    expect(names(result.find((g) => g.archetype.name === "Users"))).toEqual(["Ann", "Bob"]);
    expect(result.find((g) => g.archetype.name === "Offline")).toBeUndefined();
  });

  test("every non-offline status shares the online bucket, ordered by name behind Online", async () => {
    seedRoster(
      user("e", UserStatus.TouchGrass, "Eve"),
      user("d", UserStatus.DoNotDisturb, "Dan"),
      user("f", UserStatus.Offline, "Fay"),
      user("a", UserStatus.Online, "Ann"),
      user("c", UserStatus.InGame, "Cara"),
      user("b", UserStatus.Away, "Bob"),
      user("g", UserStatus.Listen, "Gus"),
    );

    const result = await groups();

    // Online first, then everyone else who is around, alphabetically — they rank equally.
    expect(names(result[0])).toEqual(["Ann", "Bob", "Cara", "Dan", "Eve", "Gus"]);
    expect(names(result[1])).toEqual(["Fay"]);
  });

  test("two Online members are ordered by name, not by roster order", async () => {
    seedRoster(user("z", UserStatus.Online, "Zoe"), user("a", UserStatus.Online, "Ann"));

    expect(names((await groups())[0])).toEqual(["Ann", "Zoe"]);
  });

  test("a space where nobody is around is one Offline bucket", async () => {
    seedRoster(user("a", UserStatus.Offline, "Ann"), user("b", UserStatus.Offline, "Bob"));

    const result = await groups();

    expect(result.map((g) => g.archetype.name)).toEqual(["Offline"]);
    expect(names(result[0])).toEqual(["Ann", "Bob"]);
  });

  test("a member whose identity is not cached is left out rather than rendered blank", async () => {
    h.db.servers.seed({ spaceId: SPACE, name: "Space" });
    h.db.users.seed(user("a", UserStatus.Online, "Ann"));
    h.db.members.seed(member("a"), member("ghost"));

    expect(names((await groups())[0])).toEqual(["Ann"]);
  });
});
