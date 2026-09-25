/**
 * What the current user may do, as the server evaluates it (GetMyEntitlements), and the checks the
 * UI makes against it.
 *
 * The client used to decide from its own reading of the member's roles, which cannot see channel
 * overwrites — so it offered joins, sends and moderation the server then refused. What these pin:
 * the space on screen is fetched when opened; until an answer lands the old local reading stands in
 * (nothing flashes disabled); a channel the answer does not list is a no; EntitlementsChanged,
 * reconnects and new channels refetch — debounced, and only for grants that are ours; and the
 * hide/disable decision (gate) follows space vs channel grants.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { nextTick } from "vue";

const h = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  const { Subject } = await import("rxjs");
  const { vi } = await import("vitest");

  const handlers = new Map<string, Array<(e: any) => void>>();
  return {
    handlers,
    bus: {
      onServerEvent: (key: string, cb: (e: any) => void) => {
        handlers.set(key, [...(handlers.get(key) ?? []), cb]);
        return { unsubscribe() {} };
      },
      reconnected: new Subject<void>(),
      needFullResync: new Subject<void>(),
    },
    pool: reactive({ selectedServer: null as string | null }),
    local: new Set<string>(),
    getMyEntitlements: vi.fn(),
    getMember: vi.fn(async (_spaceId: string, userId: string) => ({ member: { memberId: `m-${userId}` } })),
    trackMember: vi.fn(async () => {}),
  };
});

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ serverInteraction: { GetMyEntitlements: h.getMyEntitlements, GetMember: h.getMember } }),
}));
vi.mock("@/store/realtime/busStore", () => ({ useBus: () => h.bus }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => h.pool }));
vi.mock("@/store/data/archetypeStore", () => ({
  useArchetypeStore: () => ({
    hasPermission: (flag: string) => h.local.has(flag),
    trackMember: h.trackMember,
  }),
}));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {}, log() {}, debug() {} } }));

import { ArgonEntitlement } from "@argon/glue";
import { useEntitlementStore, ENTITLEMENTS_REFETCH_DEBOUNCE_MS } from "@/store/data/entitlementStore";
import { usePexStore } from "@/store/data/permissionStore";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const bit = (...flags: (keyof typeof ArgonEntitlement)[]) =>
  flags.reduce((all, f) => all | BigInt(ArgonEntitlement[f] as unknown as bigint), 0n);

const answer = (space: bigint, channels: Record<string, bigint>) => ({
  space,
  channels: Object.entries(channels).map(([channelId, entitlements]) => ({ channelId, entitlements })),
});

const emit = (key: string, event: Record<string, unknown>) => {
  for (const cb of h.handlers.get(key) ?? []) cb(event);
};

/** Let queued microtasks and resolved requests settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await nextTick();
}

/** Create both stores, open `space` and let the opening fetch land. */
async function openSpace(space = "s1") {
  const ent = useEntitlementStore();
  const pex = usePexStore();
  h.pool.selectedServer = space;
  await nextTick();
  await vi.advanceTimersByTimeAsync(0);
  await settle();
  return { ent, pex };
}

let pinia: Pinia;

beforeEach(async () => {
  vi.useFakeTimers();
  pinia = createPinia();
  setActivePinia(pinia);
  h.handlers.clear();
  // Stores from earlier tests are still subscribed to the old streams.
  const { Subject } = await import("rxjs");
  h.bus.reconnected = new Subject<void>();
  h.bus.needFullResync = new Subject<void>();
  h.pool.selectedServer = null;
  h.local = new Set();
  h.getMyEntitlements.mockReset();
  h.getMember.mockClear();
  h.trackMember.mockClear();
});

afterEach(async () => {
  // The pool fake outlives the test; a store left alive would keep watching it and fetching.
  for (const store of (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.values()) store.$dispose();
  await runSessionReset();
  vi.useRealTimers();
});

describe("fetching", () => {
  test("the space on screen is fetched when it is opened", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(bit("ViewChannel"), { c1: bit("ViewChannel", "JoinToVoice", "Connect") }));

    const { pex } = await openSpace("s1");

    expect(h.getMyEntitlements).toHaveBeenCalledWith("s1");
    expect(pex.ready("s1")).toBe(true);
    expect(pex.hasIn("c1", "Connect", "s1")).toBe(true);
  });

  test("a space asked about before it was opened is fetched on demand", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(0n, { v9: bit("Connect") }));
    useEntitlementStore();
    const pex = usePexStore();

    pex.hasIn("v9", "Connect", "s2");
    await settle();

    expect(h.getMyEntitlements).toHaveBeenCalledWith("s2");
    expect(pex.hasIn("v9", "Connect", "s2")).toBe(true);
  });

  test("a request made while one is in flight runs once more after it, and the later answer wins", async () => {
    let release!: (v: unknown) => void;
    h.getMyEntitlements
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockResolvedValueOnce(answer(0n, { c1: bit("SendMessages") }));
    const ent = useEntitlementStore();
    const pex = usePexStore();

    const first = ent.fetchNow("s1");
    void ent.fetchNow("s1");
    void ent.fetchNow("s1");
    release(answer(0n, { c1: 0n }));
    await first;
    await settle();

    expect(h.getMyEntitlements).toHaveBeenCalledTimes(2);
    expect(pex.hasIn("c1", "SendMessages", "s1")).toBe(true);
  });
});

describe("before the first answer", () => {
  test("the local reading of roles stands in, so nothing flashes disabled", async () => {
    h.local = new Set(["Connect", "ManageChannels"]);
    let release!: (v: unknown) => void;
    h.getMyEntitlements.mockImplementation(() => new Promise((r) => (release = r)));

    const { pex } = await openSpace("s1");

    expect(pex.ready("s1")).toBe(false);
    expect(pex.has("ManageChannels")).toBe(true);
    expect(pex.hasIn("c1", "Connect", "s1")).toBe(true);
    expect(pex.gate("c1", "ManageChannels", "s1")).toBe("allowed");

    // The server's word replaces it: an overwrite took Connect away in c1.
    release(answer(bit("Connect", "ManageChannels"), { c1: bit("ManageChannels") }));
    await settle();

    expect(pex.ready("s1")).toBe(true);
    expect(pex.hasIn("c1", "Connect", "s1")).toBe(false);
  });
});

describe("after the answer", () => {
  test("a channel the answer does not list is a no, even when the space grants the flag", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(bit("SendMessages"), { c1: bit("SendMessages") }));
    const { pex } = await openSpace("s1");

    expect(pex.hasIn("c1", "SendMessages", "s1")).toBe(true);
    expect(pex.hasIn("hidden-channel", "SendMessages", "s1")).toBe(false);
    expect(pex.has("SendMessages")).toBe(true);
  });

  test("the local reading no longer matters", async () => {
    h.local = new Set(["ManageServer"]);
    h.getMyEntitlements.mockResolvedValue(answer(0n, {}));
    const { pex } = await openSpace("s1");

    expect(pex.has("ManageServer")).toBe(false);
  });

  test("a channel's space is found from the answers when the caller does not name it", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(0n, { c1: bit("AddReactions") }));
    const { pex } = await openSpace("s1");
    h.pool.selectedServer = null;

    expect(pex.hasIn("c1", "AddReactions")).toBe(true);
  });

  test("gate: allowed, denied where the space grants it but the channel takes it away, hidden otherwise", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(bit("ManageChannels", "MoveMember"), {
      open: bit("ManageChannels", "MoveMember"),
      locked: bit("MoveMember"),
    }));
    const { pex } = await openSpace("s1");

    expect(pex.gate("open", "ManageChannels", "s1")).toBe("allowed");
    expect(pex.gate("locked", "ManageChannels", "s1")).toBe("denied");
    expect(pex.gate("locked", "KickMember", "s1")).toBe("hidden");
  });
});

describe("refetching", () => {
  test("EntitlementsChanged for everybody refetches once, after the burst settles", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(0n, {}));
    await openSpace("s1");
    h.getMyEntitlements.mockClear();

    emit("EntitlementsChanged", { spaceId: "s1", userId: null });
    emit("EntitlementsChanged", { spaceId: "s1", userId: null });
    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS - 50);
    emit("EntitlementsChanged", { spaceId: "s1", userId: null });
    expect(h.getMyEntitlements).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS);
    await settle();
    expect(h.getMyEntitlements).toHaveBeenCalledTimes(1);
    expect(h.getMyEntitlements).toHaveBeenCalledWith("s1");
  });

  test("EntitlementsChanged naming me refetches, and refreshes my member row", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(0n, {}));
    await openSpace("s1");
    h.getMyEntitlements.mockClear();

    emit("EntitlementsChanged", { spaceId: "s1", userId: "me" });
    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS);
    await settle();

    expect(h.getMyEntitlements).toHaveBeenCalledTimes(1);
    expect(h.getMember).toHaveBeenCalledWith("s1", "me");
  });

  test("EntitlementsChanged naming somebody else leaves my grants alone, but refreshes their row", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(0n, {}));
    await openSpace("s1");
    h.getMyEntitlements.mockClear();

    emit("EntitlementsChanged", { spaceId: "s1", userId: "someone-else" });
    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS * 2);
    await settle();

    expect(h.getMyEntitlements).not.toHaveBeenCalled();
    expect(h.getMember).toHaveBeenCalledWith("s1", "someone-else");
    expect(h.trackMember).toHaveBeenCalledWith({ memberId: "m-someone-else" });
  });

  test("an event for a space never opened fetches nothing; it is fetched when it is needed", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(0n, {}));
    await openSpace("s1");
    h.getMyEntitlements.mockClear();

    emit("EntitlementsChanged", { spaceId: "elsewhere", userId: null });
    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS * 2);

    expect(h.getMyEntitlements).not.toHaveBeenCalled();
  });

  test("a reconnect and a full resync refetch every space seen", async () => {
    h.getMyEntitlements.mockResolvedValue(answer(0n, {}));
    const { pex } = await openSpace("s1");
    pex.hasIn("x", "Connect", "s2");
    await settle();
    h.getMyEntitlements.mockClear();

    h.bus.reconnected.next();
    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS);
    await settle();
    expect(h.getMyEntitlements.mock.calls.map((c) => c[0]).sort()).toEqual(["s1", "s2"]);

    h.getMyEntitlements.mockClear();
    h.bus.needFullResync.next();
    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS);
    await settle();
    expect(h.getMyEntitlements).toHaveBeenCalledTimes(2);
  });

  test("a new channel refetches its space, so its grants are known", async () => {
    h.getMyEntitlements.mockResolvedValueOnce(answer(0n, {}));
    const { pex } = await openSpace("s1");
    expect(pex.hasIn("new", "Connect", "s1")).toBe(false);

    h.getMyEntitlements.mockResolvedValueOnce(answer(0n, { new: bit("Connect") }));
    emit("ChannelCreated", { spaceId: "s1", data: { channelId: "new" } });
    await vi.advanceTimersByTimeAsync(ENTITLEMENTS_REFETCH_DEBOUNCE_MS);
    await settle();

    expect(pex.hasIn("new", "Connect", "s1")).toBe(true);
  });

  test("switching back to a space asks again, keeping the old answer until the new one lands", async () => {
    h.getMyEntitlements.mockResolvedValueOnce(answer(0n, { c1: bit("Connect") }));
    const { pex } = await openSpace("s1");
    h.getMyEntitlements.mockResolvedValue(answer(0n, {}));

    h.pool.selectedServer = "s2";
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    let release!: (v: unknown) => void;
    h.getMyEntitlements.mockImplementationOnce(() => new Promise((r) => (release = r)));
    h.pool.selectedServer = "s1";
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);

    expect(pex.hasIn("c1", "Connect", "s1")).toBe(true);
    release(answer(0n, { c1: 0n }));
    await settle();
    expect(pex.hasIn("c1", "Connect", "s1")).toBe(false);
  });

  test("a session reset forgets every answer", async () => {
    h.local = new Set();
    h.getMyEntitlements.mockResolvedValue(answer(bit("Connect"), { c1: bit("Connect") }));
    const { pex } = await openSpace("s1");
    expect(pex.ready("s1")).toBe(true);

    h.getMyEntitlements.mockImplementation(() => new Promise(() => {}));
    await runSessionReset();

    expect(pex.ready("s1")).toBe(false);
    expect(pex.hasIn("c1", "Connect", "s1")).toBe(false);
  });
});
