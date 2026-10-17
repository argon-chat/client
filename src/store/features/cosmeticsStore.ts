import {
  computed,
  shallowRef,
  watch,
} from "vue";
import {
  CosmeticError,
  type ArgonUserProfile,
  type CatalogueCosmetic,
  type CosmeticCatalogue,
  type IEquipResult,
  type IWornCosmetic,
} from "@argon/glue";
import { defineStore } from "pinia";
import { logger } from "@argon/core";

import {
  cosmeticIdKey,
  createCosmeticResolver,
  type RenderFailure,
} from "@/cosmetics/resolver";
import type {
  CosmeticKindModule,
  CosmeticSurface,
  ResolvedCosmetic,
} from "@/cosmetics/types";
import {
  errorKind,
  metrics,
} from "@/lib/telemetry/metrics";
import { cosmeticKinds } from "@/cosmetics/registry";
import { useMe } from "@/store/auth/meStore";
import { useProfileCacheStore } from "@/store/data/profileCacheStore";
import { useApi } from "@/store/system/apiStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";

type EquipAction = "equip" | "unequip";

type WornProfile = Pick<ArgonUserProfile, "cosmetics"> | null | undefined;

/** When each held cosmetic stops being wearable; null for one that never does. */
type Grants = ReadonlyMap<string, Date | null>;

/** Waits before each retry of a boot load that failed; the budget restarts on the next explicit ask. */
const RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000, 30_000];

function expiryOf(expiresAt: { toDate(): Date } | null | undefined): Date | null {
  if (!expiresAt || typeof expiresAt.toDate !== "function") {
    return null;
  }

  return expiresAt.toDate();
}

function hasLapsed(expiresAt: Date | null): boolean {
  if (expiresAt === null) {
    return false;
  }

  return expiresAt.getTime() <= Date.now();
}

// The same item can be listed twice — bought and covered by a subscription — and the longer claim wins.
function longerClaim(known: Date | null | undefined, incoming: Date | null): Date | null {
  if (known === undefined) {
    return incoming;
  }

  if (known === null || incoming === null) {
    return null;
  }

  return known.getTime() >= incoming.getTime() ? known : incoming;
}

function errorName(error: CosmeticError): string {
  return CosmeticError[error]?.toLowerCase() ?? "unknown";
}

export const useCosmeticsStore = defineStore("cosmetics", () => {
  const api = useApi();
  const me = useMe();

  const catalogue = shallowRef<CosmeticCatalogue | null>(null);
  const owned = shallowRef<Grants>(new Map());

  /** Bumped on session reset, so an answer for the previous account is dropped on arrival. */
  let generation = 0;

  let ownedLoaded = false;

  /** Bumped by every owned request, so a forced refresh outranks an older answer still on its way. */
  let ownedSequence = 0;

  let catalogueInflight: Promise<CosmeticCatalogue | null> | null = null;
  let ownedInflight: Promise<Grants | null> | null = null;
  let loading: Promise<void> | null = null;

  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;

  const reportedFailures = new Set<string>();

  const enabledKinds = computed<ReadonlySet<string>>(() => new Set(catalogue.value?.enabledKinds ?? []));

  const byId = computed<ReadonlyMap<string, CatalogueCosmetic>>(() => {
    const index = new Map<string, CatalogueCosmetic>();

    for (const item of catalogue.value?.items ?? []) {
      index.set(cosmeticIdKey(item.cosmeticId), item);
    }

    return index;
  });

  const resolver = computed(() => createCosmeticResolver({
    items: byId.value,
    enabledKinds: enabledKinds.value,
    report: reportFailure,
  }));

  const wearableKinds = computed<CosmeticKindModule[]>(() =>
    cosmeticKinds.filter(kind => kind.surfaces.length > 0 && enabledKinds.value.has(kind.key)));

  onSessionReset(() => {
    generation++;
    catalogue.value = null;
    owned.value = new Map();
    ownedLoaded = false;
    catalogueInflight = null;
    ownedInflight = null;
    loading = null;
    cancelRetry();
    retryAttempt = 0;
    reportedFailures.clear();
  });

  // A subscription starting or lapsing changes what GetMyCosmetics lists.
  watch(() => me.isPremium, (premium, wasPremium) => {
    if (premium === wasPremium || !me.me) {
      return;
    }

    void loadOwned({ force: true }).then(grants => {
      if (grants === null) {
        void loadMissing();
      }
    });
  });

  /** Counted once per thing per session: resolution runs on every render of every row. */
  function reportFailure(kindKey: string, reason: RenderFailure, subject: string): void {
    const key = `${reason}:${kindKey}:${subject}`;

    if (reportedFailures.has(key)) {
      return;
    }

    reportedFailures.add(key);
    metrics.count("cosmetic.render.failed", { kind: kindKey, reason });
  }

  function itemById(cosmeticId: string | null | undefined): CatalogueCosmetic | null {
    return resolver.value.item(cosmeticId);
  }

  /** Absent from the catalogue's list means off, as the server sees it; nothing is on before it arrives. */
  function isKindEnabled(kindKey: string): boolean {
    return enabledKinds.value.has(kindKey);
  }

  /** A grant is checked against its expiry at the moment of asking: the list is only as fresh as its last load. */
  function mayWear(item: CatalogueCosmetic): boolean {
    if (item.free) {
      return true;
    }

    const key = cosmeticIdKey(item.cosmeticId);

    if (!owned.value.has(key)) {
      return false;
    }

    return !hasLapsed(owned.value.get(key) ?? null);
  }

  function loadCatalogue(): Promise<CosmeticCatalogue | null> {
    if (catalogueInflight !== null) {
      return catalogueInflight;
    }

    const running = readCatalogue(generation).finally(() => {
      if (catalogueInflight === running) {
        catalogueInflight = null;
      }
    });

    catalogueInflight = running;

    return running;
  }

  async function readCatalogue(askedIn: number): Promise<CosmeticCatalogue | null> {
    try {
      const answer = await api.cosmeticsInteraction.GetCatalogue();

      if (askedIn !== generation) {
        return null;
      }

      catalogue.value = answer;

      return answer;
    } catch (error) {
      logger.warn("Could not load the cosmetics catalogue", error);

      return null;
    }
  }

  /** What this account may wear. `force` asks again even with a request already on its way. */
  function loadOwned(options: { force?: boolean } = {}): Promise<Grants | null> {
    if (ownedInflight !== null && options.force !== true) {
      return ownedInflight;
    }

    ownedSequence++;

    const running = readOwned(generation, ownedSequence).finally(() => {
      if (ownedInflight === running) {
        ownedInflight = null;
      }
    });

    ownedInflight = running;

    return running;
  }

  async function readOwned(askedIn: number, sequence: number): Promise<Grants | null> {
    try {
      const answer = await api.cosmeticsInteraction.GetMyCosmetics();

      if (askedIn !== generation || sequence !== ownedSequence) {
        return null;
      }

      const grants = new Map<string, Date | null>();

      for (const grant of answer.owned) {
        const expiresAt = expiryOf(grant.expiresAt);

        if (hasLapsed(expiresAt)) {
          continue;
        }

        const key = cosmeticIdKey(grant.cosmeticId);

        grants.set(key, longerClaim(grants.get(key), expiresAt));
      }

      owned.value = grants;
      ownedLoaded = true;

      return grants;
    } catch (error) {
      logger.warn("Could not load the cosmetics this account owns", error);

      // What is held may be out of date — a forced refresh asks because something changed — so the
      // next ensureLoaded or retry asks again instead of trusting it.
      if (askedIn === generation && sequence === ownedSequence) {
        ownedLoaded = false;
      }

      return null;
    }
  }

  function cancelRetry(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry(): void {
    if (retryTimer !== null || retryAttempt >= RETRY_DELAYS_MS.length) {
      return;
    }

    const delay = RETRY_DELAYS_MS[retryAttempt];

    retryAttempt++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void loadMissing();
    }, delay);
  }

  /** Asks again for whichever half has not arrived; a failure is retried with backoff. */
  function loadMissing(): Promise<void> {
    if (loading !== null) {
      return loading;
    }

    const askedIn = generation;
    const pending: Promise<unknown>[] = [];

    if (catalogue.value === null) {
      pending.push(loadCatalogue());
    }

    if (!ownedLoaded) {
      pending.push(loadOwned());
    }

    const running = Promise.all(pending).then(() => {
      if (askedIn !== generation) {
        return;
      }

      if (catalogue.value !== null && ownedLoaded) {
        retryAttempt = 0;

        return;
      }

      scheduleRetry();
    }).finally(() => {
      if (loading === running) {
        loading = null;
      }
    });

    loading = running;

    return running;
  }

  /**
   * Catalogue and owned, once per session. Every surface needs the catalogue to draw a worn item, so
   * this runs right after sign-in and again after a realtime reconnect; each ask restarts the retry budget.
   */
  function ensureLoaded(): Promise<void> {
    cancelRetry();
    retryAttempt = 0;

    return loadMissing();
  }

  /** A catalogue row drawn the way a worn one is, so a picker previews the real thing. */
  function resolveCatalogueItem(item: CatalogueCosmetic): ResolvedCosmetic | null {
    return resolver.value.resolveRow(item);
  }

  /** Rows a picker may offer for a kind: enabled, readable and drawable by this build; wearable first. */
  function optionsFor(kindKey: string): CatalogueCosmetic[] {
    if (!isKindEnabled(kindKey)) {
      return [];
    }

    const offered: CatalogueCosmetic[] = [];

    for (const item of catalogue.value?.items ?? []) {
      if (item.kindKey === kindKey && resolveCatalogueItem(item) !== null) {
        offered.push(item);
      }
    }

    return offered.sort((left, right) => Number(mayWear(right)) - Number(mayWear(left)));
  }

  /**
   * What a profile wears on one surface, in compositing order. Anything this build cannot draw — an
   * unknown kind, a switched-off kind, a row it never saw, a payload it cannot read — is skipped.
   */
  function resolve(profile: WornProfile, surface: CosmeticSurface): ResolvedCosmetic[] {
    const worn = profile?.cosmetics;

    if (!worn || worn.length === 0 || catalogue.value === null) {
      return [];
    }

    return resolver.value.resolveWorn(worn, surface);
  }

  function wornOfKind(profile: WornProfile, kindKey: string): IWornCosmetic | null {
    for (const entry of profile?.cosmetics ?? []) {
      if (resolver.value.kindKeyOf(entry) === kindKey) {
        return entry;
      }
    }

    return null;
  }

  async function wearProfile(profile: ArgonUserProfile): Promise<void> {
    // The echo is the broadcast projection: archetypes empty, connections untold. Only the look is
    // news, and with no own profile loaded there is nothing it may stand in for.
    if (me.meProfile !== null) {
      me.meProfile = { ...me.meProfile, cosmetics: profile.cosmetics };
    }

    const userId = profile.userId || me.me?.userId;

    if (!userId) {
      return;
    }

    try {
      await useProfileCacheStore().updateCosmetics(userId, profile.cosmetics ?? null);
    } catch (error) {
      logger.warn("Could not write the new look into the profile cache", error);
    }
  }

  /**
   * One equip or unequip, settled: the new profile is written where every surface reads it.
   * Resolves to the server's refusal, or null on success; a transport failure is rethrown.
   */
  async function settle(action: EquipAction, kindKey: string, call: () => Promise<IEquipResult>): Promise<CosmeticError | null> {
    const askedIn = generation;
    let result: IEquipResult;

    try {
      result = await call();
    } catch (error) {
      metrics.count("cosmetic.equip", { action, kind: kindKey, result: "failed", error: errorKind(error) });
      throw error;
    }

    if (result.isFailedEquip()) {
      metrics.count("cosmetic.equip", { action, kind: kindKey, result: "failed", error: errorName(result.error) });
      logger.warn(`Cosmetic ${action} was refused`, kindKey, result.error);

      return result.error;
    }

    if (!result.isSuccessEquip()) {
      metrics.count("cosmetic.equip", { action, kind: kindKey, result: "failed", error: "unknown_result" });
      throw new Error(`Cosmetic ${action} answered with an unknown result`);
    }

    metrics.count("cosmetic.equip", { action, kind: kindKey, result: "ok" });

    if (askedIn === generation) {
      await wearProfile(result.profile);
    }

    return null;
  }

  /** Build `worn` with `toWornItem` / `toWornNickname` from wire.ts: plain objects do not serialise. */
  function equip(worn: IWornCosmetic): Promise<CosmeticError | null> {
    const kindKey = resolver.value.kindKeyOf(worn) ?? "unknown";

    return settle("equip", kindKey, () => api.cosmeticsInteraction.Equip(worn));
  }

  async function unequip(kindKey: string): Promise<CosmeticError | null> {
    const askedIn = generation;
    const error = await settle("unequip", kindKey, () => api.cosmeticsInteraction.Unequip(kindKey));

    if (error === CosmeticError.NOT_FOUND && askedIn === generation) {
      await forgetWornKind(kindKey);
    }

    return error;
  }

  /** The server holds nothing of this kind: drop what this tab still believes is worn. */
  async function forgetWornKind(kindKey: string): Promise<void> {
    const worn = me.meProfile?.cosmetics;

    if (!me.meProfile || !worn) {
      return;
    }

    const kept = worn.filter(entry => resolver.value.kindKeyOf(entry) !== kindKey);

    if (kept.length === worn.length) {
      return;
    }

    await wearProfile({ ...me.meProfile, cosmetics: kept });
  }

  return {
    catalogue,
    owned,
    enabledKinds,
    byId,
    wearableKinds,
    itemById,
    isKindEnabled,
    mayWear,
    loadCatalogue,
    loadOwned,
    ensureLoaded,
    optionsFor,
    resolveCatalogueItem,
    resolve,
    wornOfKind,
    equip,
    unequip,
  };
});
