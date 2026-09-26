/**
 * "Anyone who can join this channel can transmit" is shown when the space's default archetype,
 * after this channel's overwrite, ends up with Connect, Speak and Broadcast. The server writes an
 * everyone-Allow for Broadcast when the mode goes on; a deny takes it away again, and so does that
 * Allow being removed (or never having landed) — in both cases nobody transmits, and the banner
 * must not say otherwise.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";

const h = vi.hoisted(() => ({
  archetypes: [] as any[],
  overwrites: [] as any[],
  getOverwrites: vi.fn(async (_spaceId: string, _channelId: string): Promise<any[]> => []),
  // Every liveQuery subscriber, so a test can push a new archetype row.
  subscribers: [] as (() => void)[],
}));

vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ archetypeInteraction: { GetChannelEntitlementOverwrites: h.getOverwrites } }),
}));
vi.mock("@/store/db/dexie", () => ({
  db: {
    archetypes: {
      where: () => ({
        equals: (spaceId: string) => ({
          filter: (pred: (a: any) => boolean) => ({
            first: async () => h.archetypes.find((a) => a.spaceId === spaceId && pred(a)),
          }),
        }),
      }),
    },
  },
}));
vi.mock("dexie", () => ({
  liveQuery: (fn: () => Promise<any>) => ({
    subscribe: ({ next }: { next: (row: any) => void }) => {
      const push = () => void fn().then(next);
      h.subscribers.push(push);
      push();
      return { unsubscribe() {} };
    },
  }),
}));

import { ArgonEntitlement } from "@argon/glue";
import { effectiveEntitlement, isBroadcastOpenToEveryone, useBroadcastOpenWarning } from "@/composables/useBroadcastOpenWarning";

const bit = (flag: keyof typeof ArgonEntitlement) => BigInt(ArgonEntitlement[flag] as unknown as bigint);
const CONNECT = bit("Connect");
const SPEAK = bit("Speak");
const BROADCAST = bit("Broadcast");
const VIEW = bit("ViewChannel");

const archetype = (entitlement: bigint, extra: Record<string, unknown> = {}) =>
  ({ id: "everyone", spaceId: "s1", isDefault: true, entitlement, ...extra }) as any;
const overwrite = (allow: bigint, deny: bigint, archetypeId = "everyone") => ({ archetypeId, allow, deny }) as any;

describe("effectiveEntitlement", () => {
  test("applies the overwrite as (base & ~deny) | allow", () => {
    const base = archetype(VIEW | CONNECT | SPEAK);
    expect(effectiveEntitlement(base)).toBe(VIEW | CONNECT | SPEAK);
    expect(effectiveEntitlement(base, overwrite(BROADCAST, SPEAK))).toBe(VIEW | CONNECT | BROADCAST);
  });

  test("accepts the enum's bigint-as-number values", () => {
    const base = { entitlement: ArgonEntitlement.Connect };
    expect(effectiveEntitlement(base)).toBe(CONNECT);
  });
});

describe("isBroadcastOpenToEveryone", () => {
  test("open when everyone ends up with Connect, Speak and Broadcast here", () => {
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK | BROADCAST))).toBe(true);
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK), overwrite(BROADCAST, 0n))).toBe(true);
  });

  test("closed when the overwrite denies Broadcast", () => {
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK | BROADCAST), overwrite(0n, BROADCAST))).toBe(false);
  });

  test("closed when the everyone-Allow for Broadcast is gone or never landed", () => {
    // The role itself does not broadcast; only the server's Allow overwrite would let it.
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK))).toBe(false);
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK), overwrite(0n, 0n))).toBe(false);
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK), overwrite(VIEW, 0n))).toBe(false);
  });

  test("closed when everyone cannot connect or speak here, even if the role could elsewhere", () => {
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK | BROADCAST), overwrite(0n, CONNECT))).toBe(false);
    expect(isBroadcastOpenToEveryone(archetype(CONNECT | SPEAK | BROADCAST), overwrite(0n, SPEAK))).toBe(false);
    expect(isBroadcastOpenToEveryone(archetype(VIEW | BROADCAST))).toBe(false);
  });

  test("open when the overwrite grants what the role lacks", () => {
    expect(isBroadcastOpenToEveryone(archetype(VIEW), overwrite(CONNECT | SPEAK | BROADCAST, 0n))).toBe(true);
  });

  test("nothing to warn about without a default archetype", () => {
    expect(isBroadcastOpenToEveryone(null)).toBe(false);
    expect(isBroadcastOpenToEveryone(undefined, overwrite(BROADCAST, 0n))).toBe(false);
  });
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

beforeEach(() => {
  h.archetypes = [];
  h.overwrites = [];
  h.subscribers = [];
  h.getOverwrites.mockReset();
  h.getOverwrites.mockImplementation(async () => h.overwrites);
});

describe("useBroadcastOpenWarning", () => {
  const channel = () => ref({ channelId: "hq", spaceId: "s1", broadcast: {} } as any);

  test("reads the default archetype and this channel's overwrites, and warns", async () => {
    h.archetypes = [archetype(VIEW, { id: "other", isDefault: false }), archetype(CONNECT | SPEAK)];
    h.overwrites = [overwrite(BROADCAST, 0n)];
    const { open } = useBroadcastOpenWarning(channel(), ref(true));
    await flush();
    expect(h.getOverwrites).toHaveBeenCalledWith("s1", "hq");
    expect(open.value).toBe(true);
  });

  test("a deny on this channel for everyone silences it; another role's deny does not", async () => {
    h.archetypes = [archetype(CONNECT | SPEAK | BROADCAST)];
    h.overwrites = [overwrite(0n, BROADCAST, "mods")];
    const { open, refresh } = useBroadcastOpenWarning(channel(), ref(true));
    await flush();
    expect(open.value).toBe(true);

    h.overwrites = [overwrite(0n, BROADCAST)];
    await refresh();
    await flush();
    expect(open.value).toBe(false);
  });

  test("the everyone-Allow being removed silences it too", async () => {
    h.archetypes = [archetype(CONNECT | SPEAK)];
    h.overwrites = [overwrite(BROADCAST, 0n)];
    const { open, refresh } = useBroadcastOpenWarning(channel(), ref(true));
    await flush();
    expect(open.value).toBe(true);

    h.overwrites = [];
    await refresh();
    await flush();
    expect(open.value).toBe(false);
  });

  test("silent while the mode is off, and re-read when it goes on", async () => {
    h.archetypes = [archetype(CONNECT | SPEAK | BROADCAST)];
    const enabled = ref(false);
    const { open } = useBroadcastOpenWarning(channel(), enabled);
    await flush();
    expect(open.value).toBe(false);
    expect(h.getOverwrites).not.toHaveBeenCalled();

    enabled.value = true;
    await flush();
    expect(h.getOverwrites).toHaveBeenCalledTimes(1);
    expect(open.value).toBe(true);
  });

  test("follows the default archetype live", async () => {
    h.archetypes = [archetype(VIEW)];
    const { open } = useBroadcastOpenWarning(channel(), ref(true));
    await flush();
    expect(open.value).toBe(false);

    h.archetypes = [archetype(VIEW | CONNECT | SPEAK | BROADCAST)];
    for (const push of h.subscribers) push();
    await flush();
    expect(open.value).toBe(true);
  });

  test("a failed overwrite fetch leaves the archetype's own answer", async () => {
    h.archetypes = [archetype(CONNECT | SPEAK | BROADCAST)];
    h.getOverwrites.mockRejectedValue(new Error("offline"));
    const { open } = useBroadcastOpenWarning(channel(), ref(true));
    await flush();
    expect(open.value).toBe(true);
  });
});
