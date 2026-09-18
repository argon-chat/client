import { defineStore } from "pinia";
import { watch } from "vue";
import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useSystemStore } from "@/store/system/systemStore";
import { db, type CachedProfile, type ProfileScope } from "@/store/db/dexie";
import { onSessionReset, sessionEpoch } from "@/store/system/sessionLifecycle";
import type { ArgonUserProfile } from "@argon/glue";
import { FeatureFlagActivated, UserProfileUpdated } from "@argon/glue";
import { COSMETIC_FLAG_PREFIX } from "@/store/features/featureFlagsStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import type { Guid } from "@argon-chat/ion.webcore";

const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

/**
 * How many calls may be on the wire at once, and how many members one of them may ask about.
 *
 * A space's member list can want hundreds of profiles in a single frame. PrefetchProfiles answers
 * as many as fit in one round trip and one query, so the burst turns into a handful of calls; the
 * in-flight limit is what keeps a fast scroll from queueing calls faster than they land. Fifty is
 * half of the server's own cap, which drops whatever it is sent past it.
 */
const MAX_INFLIGHT = 6;
const MAX_BATCH = 50;

/**
 * How long a job waits for company before its call goes out.
 *
 * Rows do not arrive together even when they mount together: each one reads the local cache first,
 * and those reads come back one at a time. Sending the moment the first one misses would put a call
 * of one member on the wire and leave the other nineteen for the call after it, which is the shape
 * this was written to get rid of. A few milliseconds is long enough for a screenful of rows to
 * gather and short enough that nobody waiting on a profile card notices.
 */
const BATCH_WINDOW_MS = 8;

/**
 * Hot tier size. The member list is virtualised, so the same row mounts and unmounts every time it
 * crosses the viewport — without this each pass costs an IndexedDB read. Bounded because the
 * entries hold profile data and a long session must not accumulate it without limit.
 */
const MEMORY_LIMIT = 400;

/** What a list row needs from a profile, as opposed to what an opened profile card needs. */
export interface ProfileStatus {
  customStatus: string | null;
  customStatusIconId: string | null;
}

export interface ProfileRequestOptions {
  /**
   * Drops the request if it has not reached the wire yet. A virtualised row aborts on unmount, so
   * scrolling past a member never costs a call.
   */
  signal?: AbortSignal;
}

interface MemoryEntry {
  profile: ArgonUserProfile;
  fetchedAt: number;
  scope: ProfileScope;
}

interface Job {
  key: string;
  spaceId: Guid | null;
  userId: Guid;
  /** Widens to "full" as soon as one full caller joins; decides what gets written down. */
  scope: ProfileScope;
  /** Live callers. At zero the job is worth nothing to anyone. */
  waiters: number;
  /** Sitting in the queue, not yet on the wire — the only state a job can be cancelled from. */
  queued: boolean;
  cancelled: boolean;
  /**
   * Whether what this job learns is still worth writing down. Cleared when the cache is emptied
   * underneath it: the answer it is carrying was asked for before the purge, so writing it back
   * would put the purged row straight back.
   */
  cacheable: boolean;
  promise: Promise<ArgonUserProfile>;
  resolve: (profile: ArgonUserProfile) => void;
  reject: (err: unknown) => void;
}

export const useProfileCacheStore = defineStore("profileCache", () => {
  const api = useApi();
  const bus = useBus();
  const system = useSystemStore();

  const memory = new Map<string, MemoryEntry>();
  const jobs = new Map<string, Job>();
  const queue: string[] = [];
  let inflight = 0;
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * A purge of the stored rows, while it is running. A lookup that started during one would read
   * rows on their way out, so it waits for the purge and reads what is left.
   */
  let purge: Promise<unknown> | null = null;

  // Outside a space — the friends list, a DM, a mention in a direct chat — there is nothing to
  // scope the profile to, and those rows get their own cache namespace.
  const GLOBAL_SCOPE = "@global";

  function cacheKey(spaceId: string | null, userId: string): string {
    return `${spaceId ?? GLOBAL_SCOPE}:${userId}`;
  }

  /**
   * A cached row answers a request when it holds at least as much as the request asks for. Rows
   * written before the scope field existed were always full ones.
   */
  function satisfies(have: ProfileScope | undefined, want: ProfileScope): boolean {
    return want === "status" || (have ?? "full") === "full";
  }

  /**
   * Everything a list row is allowed to leave behind.
   *
   * A member list shows one line of custom status, but PrefetchProfile answers with the whole
   * profile — date of birth, bio, banner, badges, the space roles. Persisting that for every member
   * of every space the account visits builds a local dossier on hundreds of people out of a feature
   * that renders one string, so the rest is dropped the moment the row has what it needs and only
   * an opened profile card writes a full row.
   *
   * Spelled out field by field on purpose: a field added to ArgonUserProfile fails to compile here
   * rather than quietly joining the set of things a list row keeps.
   */
  function statusProjection(profile: ArgonUserProfile): ArgonUserProfile {
    return {
      userId: profile.userId,
      customStatus: profile.customStatus,
      customStatusIconId: profile.customStatusIconId,
      bannerFileID: null,
      dateOfBirth: null,
      bio: null,
      badges: [],
      archetypes: [],
      backgroundId: null,
      voiceCardEffectId: null,
      avatarFrameId: null,
      nickEffectId: null,
      primaryColor: null,
      accentColor: null,
      registeredAt: null,
      displayNameOverride: null,
      avatarFileIdOverride: null,
      cosmetics: null,
      loadoutId: null,
    };
  }

  /**
   * Callers get their own copy. The hot tier hands the same object to every row and popover that
   * asks for it, and at least one caller appends to `badges` before rendering.
   */
  function cloneProfile(profile: ArgonUserProfile): ArgonUserProfile {
    return { ...profile, badges: [...profile.badges], archetypes: [...profile.archetypes] };
  }

  function remember(key: string, profile: ArgonUserProfile, fetchedAt: number, scope: ProfileScope) {
    // Map iterates in insertion order, so re-inserting keeps the oldest entry at the front and the
    // eviction below is least-recently-written.
    memory.delete(key);
    if (memory.size >= MEMORY_LIMIT) {
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
    memory.set(key, { profile, fetchedAt, scope });
  }

  /**
   * The space-less lookup, for a profile asked about outside any space — the friends list, a DM, a
   * mention in a direct chat. PrefetchProfiles is space-scoped and the transport rejects a null
   * space id outright, and this answer carries no archetypes, which is exactly right: there is no
   * space for a member to hold a role in. One user at a time, because that is the shape it has.
   */
  async function lookupProfile(userId: Guid): Promise<ArgonUserProfile> {
    const result = await api.userInteraction.LookupProfile(userId);
    if (result.isSuccessLookupProfile()) return result.profile;
    throw new Error(`Profile lookup for ${userId} failed`);
  }

  /**
   * The next call's worth of queued jobs.
   *
   * Last in, first out: a virtualised list queues rows in the order they mount, so the newest
   * request is the one the user is actually looking at. Jobs are taken from the end until the batch
   * is full, skipping the ones that belong to another space — those ride in their own call, since
   * one call names one space. A cancelled job leaves its key behind as a tombstone and is dropped
   * here rather than sent.
   */
  function takeBatch(): Job[] {
    const batch: Job[] = [];
    let space: Guid | null | undefined;

    for (let i = queue.length - 1; i >= 0 && batch.length < MAX_BATCH; i--) {
      const job = jobs.get(queue[i]);
      if (!job || job.cancelled || !job.queued) {
        queue.splice(i, 1);
        continue;
      }

      if (space === undefined) space = job.spaceId;
      else if (job.spaceId !== space) continue;

      queue.splice(i, 1);
      job.queued = false;
      batch.push(job);

      // Nothing batches a space-less lookup: it answers about one user and that is the whole call.
      if (space === null) break;
    }

    return batch;
  }

  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length > 0) {
      const batch = takeBatch();
      if (batch.length === 0) return;
      void send(batch);
    }
  }

  /** Opens the coalescing window, or leaves the open one alone. */
  function schedulePump() {
    if (pumpTimer !== null) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, BATCH_WINDOW_MS);
  }

  /**
   * Takes a finished job off the registry — but only if it is still the job the registry holds.
   *
   * A job that has already been dropped can finish afterwards: an account switch cancels everything
   * in flight, and the call that was on the wire lands a moment later and settles the object it was
   * carrying. By then a new request for the same member may have registered a job of its own, and a
   * blind `delete` by key would evict that live job while it is still running — leaving its callers
   * waiting on a promise nothing can find, and the next request opening a second call for a profile
   * already on its way.
   */
  function removeJob(job: Job) {
    if (jobs.get(job.key) === job) jobs.delete(job.key);
  }

  function settle(job: Job, profile: ArgonUserProfile) {
    removeJob(job);
    job.resolve(profile);
  }

  function fail(job: Job, err: unknown) {
    removeJob(job);
    job.reject(err);
  }

  function cancel(job: Job) {
    job.cancelled = true;
    job.queued = false;
    removeJob(job);
    job.reject(new DOMException("Profile request cancelled", "AbortError"));
  }

  function keep(job: Job, profile: ArgonUserProfile) {
    // The cache was emptied while this was in flight. The row it would write is the one that was
    // just thrown away, so the answer goes to the callers waiting on it and no further — and the
    // next reader, finding nothing cached, asks again.
    if (!job.cacheable) return;

    const fetchedAt = Date.now();
    const kept = job.scope === "full" ? profile : statusProjection(profile);

    remember(job.key, kept, fetchedAt, job.scope);

    const row: CachedProfile = {
      key: job.key,
      spaceId: job.spaceId ?? GLOBAL_SCOPE,
      userId: job.userId,
      profile: kept,
      fetchedAt,
      scope: job.scope,
    };
    // Not awaited: the caller already has its answer, and the write is a cache refill.
    db.profileCache.put(row).catch(err => logger.warn("profile cache write failed", err));
  }

  /**
   * One call for the whole batch, answered per member.
   *
   * PrefetchProfiles answers one entry per id it was given, but the answers are paired up by
   * `userId` rather than by position: a member the server has nothing to say about should cost that
   * one job its answer, not misalign every job behind it.
   */
  async function fetchBatch(batch: Job[]): Promise<Map<Guid, ArgonUserProfile>> {
    const spaceId = batch[0].spaceId;

    if (!spaceId) {
      const profile = await lookupProfile(batch[0].userId);
      return new Map([[batch[0].userId, profile]]);
    }

    const profiles = await api.serverInteraction.PrefetchProfiles(
      spaceId,
      batch.map(job => job.userId),
    );
    return new Map(profiles.map(profile => [profile.userId, profile]));
  }

  async function send(batch: Job[]) {
    inflight++;
    // Which account asked. A seamless switch swaps the API client and the Dexie database
    // underneath an in-flight request, and a reply fetched with the previous account's credentials
    // must not be written into the incoming account's cache.
    const askedIn = sessionEpoch.value;
    try {
      const answers = await fetchBatch(batch);
      const sameSession = sessionEpoch.value === askedIn;

      for (const job of batch) {
        const profile = answers.get(job.userId);
        if (!profile) {
          fail(job, new Error(`Profile prefetch for ${job.userId} returned no entry`));
          continue;
        }

        if (sameSession && !job.cancelled) keep(job, profile);
        settle(job, profile);
      }
    } catch (err) {
      // The call failed, so every member it was carrying failed with it.
      for (const job of batch) fail(job, err);
    } finally {
      inflight--;
      // A slot just freed and the queue is already standing — that batch has waited its window.
      pump();
    }
  }

  async function begin(job: Job) {
    try {
      if (purge) await purge.catch(() => {});

      const cached = await db.profileCache.get(job.key);
      if (job.cancelled) return;

      if (job.cacheable && cached && Date.now() - cached.fetchedAt < CACHE_TTL && satisfies(cached.scope, job.scope)) {
        remember(job.key, cached.profile, cached.fetchedAt, cached.scope ?? "full");
        settle(job, cached.profile);
        return;
      }

      // Everyone who wanted this scrolled away while the local lookup ran. Nothing has been sent
      // yet, so the cheapest thing to do is nothing.
      if (job.waiters === 0) {
        cancel(job);
        return;
      }

      // Nothing has been fetched yet, so whatever a purge said about this job no longer applies:
      // what it brings back will be read after the purge, and is worth keeping.
      job.cacheable = true;
      job.queued = true;
      queue.push(job.key);
      schedulePump();
    } catch (err) {
      fail(job, err);
    }
  }

  function createJob(key: string, spaceId: Guid | null, userId: Guid, scope: ProfileScope): Job {
    let resolve!: (profile: ArgonUserProfile) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<ArgonUserProfile>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // A cancelled job rejects with nobody listening; this keeps it from surfacing as an unhandled
    // rejection. Callers attach their own handlers to the same promise.
    promise.catch(() => {});

    const job: Job = {
      key, spaceId, userId, scope,
      waiters: 0,
      queued: false,
      cancelled: false,
      cacheable: true,
      promise, resolve, reject,
    };
    jobs.set(key, job);
    void begin(job);
    return job;
  }

  function request(
    spaceId: Guid | null,
    userId: Guid,
    scope: ProfileScope,
    signal?: AbortSignal,
  ): Promise<ArgonUserProfile> {
    const key = cacheKey(spaceId, userId);

    const hot = memory.get(key);
    if (hot && Date.now() - hot.fetchedAt < CACHE_TTL && satisfies(hot.scope, scope))
      return Promise.resolve(cloneProfile(hot.profile));

    if (signal?.aborted)
      return Promise.reject(new DOMException("Profile request cancelled", "AbortError"));

    // Registering the job is synchronous, before any await. The old cache read happened first, so
    // every row mounting in the same frame got past it before any of them recorded itself as
    // in-flight, and each one sent its own call for the same profile.
    let job = jobs.get(key);
    if (!job) job = createJob(key, spaceId, userId, scope);
    else if (scope === "full") job.scope = "full";

    const active = job;
    active.waiters++;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active.waiters--;
      // Already on the wire: the call is paid for, let it land and fill the cache.
      if (active.waiters === 0 && active.queued) cancel(active);
    };

    return new Promise<ArgonUserProfile>((resolve, reject) => {
      const onAbort = () => {
        release();
        reject(new DOMException("Profile request cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      active.promise.then(
        profile => {
          signal?.removeEventListener("abort", onAbort);
          release();
          resolve(cloneProfile(profile));
        },
        err => {
          signal?.removeEventListener("abort", onAbort);
          release();
          reject(err);
        },
      );
    });
  }

  /** The whole profile, for an opened profile card. Writes a full row to the cache. */
  function getProfile(
    spaceId: Guid | null,
    userId: Guid,
    opts: ProfileRequestOptions = {},
  ): Promise<ArgonUserProfile> {
    return request(spaceId, userId, "full", opts.signal);
  }

  /**
   * Just the custom status, for a member-list row. Shares the queue and the de-duplication with
   * getProfile — it only asks for less to be kept.
   */
  async function getStatus(
    spaceId: Guid | null,
    userId: Guid,
    opts: ProfileRequestOptions = {},
  ): Promise<ProfileStatus> {
    const profile = await request(spaceId, userId, "status", opts.signal);
    return { customStatus: profile.customStatus, customStatusIconId: profile.customStatusIconId };
  }

  /**
   * Refreshes a profile already in the cache, keeping the scope it was cached at.
   *
   * A profile that is not cached is left alone: it was never asked for, and an update event is not
   * a reason to start keeping someone's profile. The next read fetches it.
   */
  async function updateProfile(spaceId: string, userId: string, profile: ArgonUserProfile) {
    const key = cacheKey(spaceId, userId);

    // Which account the event was addressed to. The read below is an await, and a seamless switch
    // swaps the Dexie database underneath it — so without this the payload that arrived for the
    // previous account would be written into the incoming account's cache.
    const askedIn = sessionEpoch.value;

    const existing = memory.get(key) ?? await db.profileCache.get(key);
    if (!existing || sessionEpoch.value !== askedIn) return;

    const scope = existing.scope ?? "full";
    const fetchedAt = Date.now();
    const kept = scope === "full" ? profile : statusProjection(profile);

    remember(key, kept, fetchedAt, scope);
    await db.profileCache.put({ key, spaceId, userId, profile: kept, fetchedAt, scope });
  }

  /**
   * Stops the jobs an invalidation has overtaken from putting back what it is removing.
   *
   * A job that is only queued is left alone on purpose: it has not fetched anything yet, so what it
   * brings back will be read after the purge and is exactly the fresh data the invalidation wanted.
   * The ones that matter are already on the wire, or still reading a stored row — those learned
   * what they know before the purge, and would otherwise write it back over it.
   */
  function overtakeInFlight(matches: (job: Job) => boolean) {
    for (const job of jobs.values()) {
      if (!job.queued && matches(job)) job.cacheable = false;
    }
  }

  /**
   * Runs a purge of the stored rows, holding lookups off until it has finished.
   *
   * Without the hold, a request arriving mid-purge reads a row that is on its way out and remembers
   * it — which is the same repopulation the flag above prevents, arriving through the other door.
   */
  async function purging(clear: () => Promise<unknown>) {
    const running = clear();
    purge = running;
    try {
      await running;
    } finally {
      if (purge === running) purge = null;
    }
  }

  async function invalidateAll() {
    overtakeInFlight(() => true);
    memory.clear();
    await purging(() => db.profileCache.clear());
  }

  async function invalidateUser(userId: string) {
    overtakeInFlight(job => job.userId === userId);
    for (const [key, entry] of memory) {
      if (entry.profile.userId === userId) memory.delete(key);
    }
    await purging(() => db.profileCache.where("userId").equals(userId).delete());
  }

  /** Guids arrive from two calls and only agree about case by accident. */
  function idOf(value: unknown): string {
    return String(value).toLowerCase();
  }

  function movedOn(itemId: unknown, held: number | null | undefined, versionOf: ReadonlyMap<string, number>): boolean {
    // A server that does not send the version leaves nothing to compare, and guessing would mean
    // dropping every profile on every catalogue read.
    if (held === null || held === undefined) return false;

    const current = versionOf.get(idOf(itemId));

    return current !== undefined && current !== held;
  }

  function holdsStale(profile: ArgonUserProfile, versionOf: ReadonlyMap<string, number>): boolean {
    for (const worn of profile.cosmetics ?? []) {
      if (movedOn(worn.itemId, worn.version, versionOf)) return true;

      for (const option of worn.options ?? []) {
        if (movedOn(option.itemId, option.version, versionOf)) return true;
      }
    }

    return false;
  }

  /**
   * Drops the cached profiles whose worn cosmetics are older than the catalogue says they are.
   *
   * <b>Re-authoring a published cosmetic reaches nobody holding a cached profile.</b> The payload
   * travels with the person — that is what makes a member list one call instead of one per name —
   * so an operator who changes a frame's thickness changes nothing about anybody, no
   * <c>UserProfileUpdated</c> is raised, and every cached copy keeps rendering what was true when it
   * was fetched. For the lifetime of the cache, which is three hours, that reads as "I changed it
   * and half the people still see the old one".
   *
   * The version is the fix and it costs one comparison: the catalogue carries each row's authoring
   * number, the profile carries the one it was built from, and a disagreement names exactly the
   * profiles to drop. Which is why this is not <c>invalidateAll</c> — a catalogue read happens
   * whenever the picker opens, and clearing every profile each time would undo the cache.
   */
  async function invalidateStaleCosmetics(versionOf: ReadonlyMap<string, number>): Promise<string[]> {
    if (versionOf.size === 0) return [];

    const keys: string[] = [];
    const users = new Set<string>();

    await db.profileCache.each(row => {
      if (!holdsStale(row.profile, versionOf)) return;

      keys.push(row.key);
      users.add(row.userId);
    });

    if (keys.length === 0) return [];

    await db.profileCache.bulkDelete(keys);

    return [...users];
  }

  // Seamless account switch: drop everything in flight and everything held in memory. The cached
  // profiles live in the per-account Dexie DB (swapped on switch), so there's nothing else to clear.
  onSessionReset(() => {
    if (pumpTimer !== null) {
      clearTimeout(pumpTimer);
      pumpTimer = null;
    }
    for (const job of [...jobs.values()]) cancel(job);
    queue.length = 0;
    memory.clear();
  });

  // Subscribe to realtime event
  bus.onServerEvent<UserProfileUpdated>("UserProfileUpdated", (e) => {
    void (async () => {
      await updateProfile(e.spaceId, e.userId, e.profile);
      // The space-less copy of a profile is a different thing — no archetypes — so a space-scoped
      // payload cannot stand in for it. Drop it and let the next read fetch its own; a lookup that
      // is already on its way with the old one does not get to put it back.
      const globalKey = cacheKey(null, e.userId);
      overtakeInFlight(job => job.key === globalKey);
      memory.delete(globalKey);
      await db.profileCache.delete(globalKey);

      // The member list and the message list read cosmetics from their own in-memory batch rather
      // than from here, and nothing else would tell them this person changed.
      useCosmeticsStore().forgetWorn(e.userId);
    })();
  });

  // Invalidate cache after long reconnect
  watch(() => system.isLongReconnecting, (val, oldVal) => {
    if (oldVal && !val) {
      invalidateAll();
    }
  });

  /**
   * An operator switching a cosmetic kind off changes what every cached profile should render, and
   * nothing about the profiles themselves — so no UserProfileUpdated arrives for any of them. Without
   * this, a kind pulled because it was a mistake would keep showing for up to the cache lifetime,
   * which is three hours.
   *
   * Clearing everything is deliberate: the flag says nothing about which people are affected, and a
   * cache miss costs one fetch on the next card that opens.
   */
  bus.onServerEvent<FeatureFlagActivated>("FeatureFlagActivated", (e) => {
    if (!e.flagId.startsWith(COSMETIC_FLAG_PREFIX)) return;

    void invalidateAll();
    useCosmeticsStore().forgetWorn();
  });

  return {
    getProfile,
    getStatus,
    updateProfile,
    invalidateAll,
    invalidateUser,
    invalidateStaleCosmetics,
  };
});
