import { defineStore } from "pinia";
import { shallowReactive, watch } from "vue";
import { logger } from "@argon/core";
import type { ChannelCreated, EntitlementsChanged, MemberEntitlements } from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useMe } from "@/store/auth/meStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useArchetypeStore } from "@/store/data/archetypeStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";

/** Changes tend to come in bursts (a role edit touches many flags, a save many overwrites). */
export const ENTITLEMENTS_REFETCH_DEBOUNCE_MS = 200;

export interface SpaceEntitlements {
  /** The caller's space-level grants. */
  space: bigint;
  /** Grants after each visible channel's overwrites. A channel missing here is not visible. */
  channels: ReadonlyMap<string, bigint>;
}

/**
 * What the server says the current user may do, per space (`GetMyEntitlements`).
 *
 * The UI gates its controls on this rather than on a local reading of roles, which cannot see
 * channel overwrites. A space is fetched when it is opened or first asked about, and again when
 * the server says grants moved, after a reconnect, and when a channel is created.
 */
export const useEntitlementStore = defineStore("entitlements", () => {
  const api = useApi();
  const bus = useBus();
  const me = useMe();
  const pool = usePoolStore();
  const archetypes = useArchetypeStore();

  const bySpace = shallowReactive(new Map<string, SpaceEntitlements>());

  // Spaces fetched (or being fetched) this session: the ones worth keeping fresh.
  const attempted = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Bumped on session reset so an answer for the previous account is dropped.
  let generation = 0;

  function toEntitlements(answer: MemberEntitlements): SpaceEntitlements {
    const channels = new Map<string, bigint>();
    for (const c of answer.channels ?? []) channels.set(String(c.channelId), BigInt(c.entitlements as unknown as bigint));
    return { space: BigInt(answer.space as unknown as bigint), channels };
  }

  /** One request per space at a time; a request made meanwhile runs once the current one lands. */
  function fetchNow(spaceId: string): Promise<void> {
    attempted.add(spaceId);
    const running = inflight.get(spaceId);
    if (running) {
      again.add(spaceId);
      return running;
    }

    const gen = generation;
    const run = (async () => {
      try {
        const answer = await api.serverInteraction.GetMyEntitlements(spaceId);
        if (gen === generation) bySpace.set(spaceId, toEntitlements(answer));
      } catch (e) {
        logger.warn("[entitlements] fetch failed", spaceId, e);
      } finally {
        inflight.delete(spaceId);
      }
      if (gen === generation && again.delete(spaceId)) await fetchNow(spaceId);
    })();

    inflight.set(spaceId, run);
    return run;
  }

  /** Fetch again after a short quiet period; repeated calls collapse into one request. */
  function refresh(spaceId: string | null | undefined, delayMs = ENTITLEMENTS_REFETCH_DEBOUNCE_MS) {
    if (!spaceId) return;
    const pending = timers.get(spaceId);
    if (pending) clearTimeout(pending);
    timers.set(spaceId, setTimeout(() => {
      timers.delete(spaceId);
      void fetchNow(spaceId);
    }, delayMs));
  }

  /**
   * Fetch a space nobody asked for yet. Safe to call from a render: it does nothing for a space
   * already fetched or failed (events and reconnects retry those), and starts the request later.
   */
  function ensure(spaceId: string | null | undefined) {
    if (!spaceId || attempted.has(spaceId)) return;
    attempted.add(spaceId);
    queueMicrotask(() => void fetchNow(spaceId));
  }

  const get = (spaceId: string): SpaceEntitlements | undefined => bySpace.get(spaceId);

  /** The space a channel belongs to, among the spaces answered so far. */
  function spaceOf(channelId: string): string | undefined {
    for (const [spaceId, grants] of bySpace) if (grants.channels.has(channelId)) return spaceId;
    return undefined;
  }

  function refreshAll() {
    for (const spaceId of attempted) refresh(spaceId);
  }

  // Opening a space always asks again: it is cheap, and the answer on screen stays until it lands.
  watch(
    () => pool.selectedServer,
    (spaceId) => {
      if (spaceId) {
        attempted.add(spaceId);
        refresh(spaceId, 0);
      }
    },
    { immediate: true },
  );

  bus.onServerEvent<EntitlementsChanged>("EntitlementsChanged", (e) => {
    const spaceId = String(e.spaceId);
    const userId = e.userId ? String(e.userId) : null;

    // One member's roles: their row (and role colours) moved for everybody, their grants for them.
    if (userId) void refreshMember(spaceId, userId);
    if (userId && userId !== me.me?.userId) return;
    if (attempted.has(spaceId)) refresh(spaceId);
  });

  bus.onServerEvent<ChannelCreated>("ChannelCreated", (e) => {
    const spaceId = String(e.spaceId);
    if (attempted.has(spaceId)) refresh(spaceId);
  });

  // Events may have been missed while the connection was down.
  bus.reconnected.subscribe(() => refreshAll());
  bus.needFullResync.subscribe(() => refreshAll());

  async function refreshMember(spaceId: string, userId: string) {
    try {
      const member = await api.serverInteraction.GetMember(spaceId, userId);
      if (member?.member) await archetypes.trackMember(member.member);
    } catch (e) {
      logger.warn("[entitlements] member refresh failed", spaceId, e);
    }
  }

  onSessionReset(() => {
    generation++;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    inflight.clear();
    again.clear();
    attempted.clear();
    bySpace.clear();
  });

  return { bySpace, get, spaceOf, ensure, refresh, fetchNow };
});
