import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { logger } from "@argon/core";
import Dexie from "dexie";
import {
  useInstance,
  DEFAULT_MANIFEST,
  instanceManifestSchema,
  type InstanceManifest,
} from "@/store/system/instanceStore";
import { USER_SCOPED_BASE_KEYS } from "@/lib/userScopedStorage";
import { db } from "@/store/db/dexie";
import { isWeb, supports } from "@/lib/platform";

// Multi-account registry. Each account "carries" its own instance (official / self-hosted / managed),
// its own refresh token, and its own Dexie DB (`argon-database-v3-<id>`). Switching is reload-based:
// we persist the active pointer and reload, so the rest of the app boots cleanly into the new account
// (dexie name, user-scoped keys, instance endpoints all key off the persisted active pointer).

export type AccountInstanceKind = InstanceManifest["instance"]["kind"]; // "official" | "selfhosted" | "managed"

export interface AccountRecord {
  id: string;                       // stable, sanitized — dexie suffix + user-scoped-key suffix
  userId: string;
  displayName: string;
  avatarFileId: string | null;
  instanceManifest: InstanceManifest;
  instanceKind: AccountInstanceKind;
  refreshToken: string | null;
  accessToken?: string | null;      // short-lived; re-minted from rft by GetMyAuthorization at boot
  createdAt: number;
  lastUsedAt: number;
  needsReauth?: boolean;
  /** Last avatar we managed to read for this account, downscaled and inlined. */
  avatarDataUrl?: string | null;
  /** The avatarFileId `avatarDataUrl` was built from, so a changed avatar is re-read. */
  avatarCachedFor?: string | null;
}

export interface MigrationUser {
  userId: string;
  displayName: string;
  avatarFileId: string | null;
}

const REGISTRY_KEY = "argon_accounts";
const ACTIVE_KEY = "argon_active_account";

const MAX_OFFICIAL = 3;
const MAX_ALT = 4;

// The cached avatar lives in the registry, which lives in localStorage — so it is re-encoded small
// (a 72px square is twice the 36px the picker draws) and dropped entirely if it still comes out fat.
const AVATAR_CACHE_PX = 72;
const AVATAR_CACHE_MAX_CHARS = 64_000;

/**
 * Reads an avatar and re-encodes it small enough to keep.
 *
 * Goes through `fetch` rather than an `<img>` on purpose: an image element loaded cross-origin
 * taints the canvas and `toDataURL` then throws, whereas a fetched blob is same-origin by the time
 * it is drawn. Best-effort throughout — a failure just means the picker shows initials.
 */
async function readAvatarAsDataUrl(url: string): Promise<string | null> {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) return null;

  const bitmap = await createImageBitmap(await response.blob());
  try {
    const side = Math.min(AVATAR_CACHE_PX, Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Centre-cropped to a square: avatars are drawn round, so the corners are never seen anyway.
    const cut = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - cut) / 2, (bitmap.height - cut) / 2, cut, cut, 0, 0, side, side);

    const dataUrl = canvas.toDataURL("image/webp", 0.8);
    return dataUrl.length > AVATAR_CACHE_MAX_CHARS ? null : dataUrl;
  } finally {
    bitmap.close();
  }
}

/** Stable id from instance api host + userId, sanitized to the [a-z0-9-] alphabet used by the
 *  dexie name and the user-scoped-key suffix. Same user on different instances → different ids. */
export function deriveAccountId(manifest: InstanceManifest, userId: string): string {
  let host = "instance";
  try { host = new URL(manifest.endpoints.api).host.toLowerCase(); } catch { /* keep fallback */ }
  return `${host}|${userId}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function loadRegistry(): AccountRecord[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as AccountRecord[]) : [];
  } catch {
    return [];
  }
}

export const useAccounts = defineStore("accounts", () => {
  const accounts = ref<AccountRecord[]>(loadRegistry());
  const activeId = ref<string | null>(localStorage.getItem(ACTIVE_KEY));

  // In-flight legacy-session migration (single-account → registry), finalized after the first GetMe.
  const migrating = ref(false);
  let migrationCtx: { token: string | null; rft: string | null; manifest: InstanceManifest } | null = null;

  const active = computed(() => accounts.value.find(a => a.id === activeId.value) ?? null);
  const officialCount = computed(() => accounts.value.filter(a => a.instanceKind === "official").length);
  const altCount = computed(() => accounts.value.filter(a => a.instanceKind !== "official").length);
  // The browser build holds exactly one session — the one Aegis issued for this origin — so the
  // registry is never added to there and the picker never offers to.
  const canAddOfficial = computed(() => supports("multiAccount") && officialCount.value < MAX_OFFICIAL);
  const canAddAlt = computed(() => supports("multiAccount") && altCount.value < MAX_ALT);

  function canAdd(kind: AccountInstanceKind): boolean {
    return kind === "official" ? canAddOfficial.value : canAddAlt.value;
  }

  function persist() {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(accounts.value));
  }

  function setActivePointer(id: string | null) {
    activeId.value = id;
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  }

  async function announceOffline() {
    // Best-effort: tell the realtime bus we're going offline before the reload tears it down.
    try {
      const { useBus } = await import("@/store/realtime/busStore");
      await useBus().goOffline();
    } catch { /* not connected — server-side grace covers it */ }
  }

  /** Register (or refresh) an account. Re-enrolling an existing id always succeeds and updates it. */
  function addAccount(record: AccountRecord): { ok: true } | { ok: false; reason: "cap" } {
    const existing = accounts.value.find(a => a.id === record.id);
    if (existing) {
      existing.refreshToken = record.refreshToken;
      existing.accessToken = record.accessToken ?? existing.accessToken;
      existing.displayName = record.displayName;
      existing.avatarFileId = record.avatarFileId;
      existing.instanceManifest = record.instanceManifest;
      existing.instanceKind = record.instanceKind;
      existing.needsReauth = false;
      existing.lastUsedAt = Date.now();
      persist();
      return { ok: true };
    }
    if (!canAdd(record.instanceKind)) return { ok: false, reason: "cap" };
    accounts.value.push(record);
    persist();
    return { ok: true };
  }

  /**
   * Hard switch: announce the outgoing account offline (so others don't see it linger online through
   * the ~2-min presence grace), persist the pointer, and reload into the account. The robust fallback
   * when the seamless path throws. Best-effort goOffline — if the realtime worker is already gone the
   * server-side grace covers it.
   */
  async function hardSwitch(id: string): Promise<void> {
    await announceOffline();
    setActivePointer(id);
    location.reload();
  }

  let switchInFlight = false;

  /** Make `id` active. Tries a seamless in-place switch (no page reload); falls back to a reload. */
  async function switchTo(id: string): Promise<void> {
    if (switchInFlight) return; // ignore rapid double-clicks
    const acc = accounts.value.find(a => a.id === id);
    if (!acc) return;
    if (id === activeId.value && !acc.needsReauth) return; // already active
    switchInFlight = true;
    acc.lastUsedAt = Date.now();
    persist();
    try {
      await seamlessSwitch(acc);
    } catch (e) {
      logger.warn("Seamless account switch failed; falling back to reload", e);
      await hardSwitch(id);
    } finally {
      switchInFlight = false;
    }
  }

  /**
   * Seamless switch (no page reload): point storage at the new account, tear down the realtime worker
   * and any active call, reset every account-scoped store (clearing Dexie liveQuery subscriptions),
   * swap the Dexie DB, re-point endpoints + tokens, remount the authed shell, and reload the new
   * account's data. A full-screen overlay masks the brief transition. Throwing triggers the reload
   * fallback in switchTo (the pointer is already set, so the reload lands cleanly on the new account).
   */
  async function seamlessSwitch(acc: AccountRecord): Promise<void> {
    const { sessionEpoch, isSwitchingAccount, runSessionReset } = await import("@/store/system/sessionLifecycle");
    isSwitchingAccount.value = true;
    try {
      setActivePointer(acc.id);

      // 1. Tear down realtime + any active call (best-effort).
      const { useBus } = await import("@/store/realtime/busStore");
      const bus = useBus();
      try { await bus.goOffline(); } catch { /* not connected */ }
      const { useUnifiedCall } = await import("@/store/media/unifiedCallStore");
      const call = useUnifiedCall();
      if (call.mode !== "none") { try { await call.leave(); } catch { /* ignore */ } }
      bus.closeAllSubscribes("account-switch");

      // 2. Clear all account-scoped store state + their Dexie liveQuery subscriptions.
      await runSessionReset();

      // 3. Swap the Dexie DB to the new account.
      const { reopenActiveAccountDb } = await import("@/store/db/dexie");
      await reopenActiveAccountDb();

      // 4. Re-point endpoints + project the new account's tokens; recycle the RPC client; restore session.
      applyActiveAtBoot();
      const { useApi } = await import("@/store/system/apiStore");
      useApi().recycleClient();
      const { useAuthStore } = await import("@/store/auth/authStore");
      await useAuthStore().restoreSession();

      // 5. Reset the route to home (the previous account's space/channel route no longer applies),
      //    then remount the authed shell so component-scoped liveQueries rebind to the new DB.
      const { default: router } = await import("@/router");
      try { await router.push({ path: "/master.pg" }); } catch { /* duplicated/aborted nav */ }
      sessionEpoch.value++;

      // 6. Reload the new account's profile + data and route home (also restarts the realtime worker).
      const { useAppState } = await import("@/store/system/appState");
      await useAppState().continueAfterLogin();
    } finally {
      isSwitchingAccount.value = false;
    }
  }

  /** Remove an account: drop its registry entry, Dexie DB and user-scoped keys; re-home if it was active. */
  async function removeAccount(id: string): Promise<void> {
    const wasActive = activeId.value === id;
    accounts.value = accounts.value.filter(a => a.id !== id);
    persist();

    for (const base of USER_SCOPED_BASE_KEYS) {
      try { localStorage.removeItem(`${base}::${id}`); } catch { /* ignore */ }
    }

    if (wasActive) {
      // The active account's Dexie DB is the open `db` singleton — deleting it now would block on the
      // live connection. Close it and let gcOrphanDbs() reap it on the next boot; we reload anyway.
      try { db.close(); } catch { /* ignore */ }
      const next = [...accounts.value].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
      if (next) {
        await switchTo(next.id);
      } else {
        setActivePointer(null);
        localStorage.removeItem("token");
        localStorage.removeItem("rft");
        await announceOffline();
        location.reload();
      }
      return;
    }

    // Non-active account's DB has no open connection — safe to delete immediately.
    try { await Dexie.delete(`argon-database-v3-${id}`); } catch (e) { logger.warn("Failed to delete account DB", e); }
  }

  /** Reap orphaned per-account Dexie DBs (e.g. an active account removed last session). Best-effort. */
  async function gcOrphanDbs(): Promise<void> {
    try {
      if (!indexedDB.databases) return;
      const keep = new Set(accounts.value.map(a => `argon-database-v3-${a.id}`));
      // The scratch `-default` DB is the OPEN connection only while logged out; otherwise it's an
      // orphan (e.g. left by migration) and safe to reap.
      if (!activeId.value) keep.add("argon-database-v3-default");
      const dbs = await indexedDB.databases();
      for (const d of dbs) {
        const name = d.name ?? "";
        if (name.startsWith("argon-database-v3-") && !keep.has(name)) {
          try { await Dexie.delete(name); } catch { /* ignore */ }
        }
      }
    } catch { /* indexedDB.databases unsupported — skip */ }
  }

  async function logoutActive(): Promise<void> {
    if (activeId.value) await removeAccount(activeId.value);
  }

  function markActiveNeedsReauth() {
    const acc = active.value;
    if (!acc) return;
    acc.needsReauth = true;
    acc.accessToken = null; // drop the stale token so the next boot lands on login, not a refresh loop
    persist();
  }

  /**
   * Adopt the currently-live global session (after a primary AuthPage login) into the registry and
   * switch into it. Creates account #1 on a fresh sign-in, or dedup-updates the active account on a
   * re-auth. Reloads so the per-account Dexie DB is used from the start.
   */
  async function adoptCurrentSession(): Promise<void> {
    const token = localStorage.getItem("token");
    if (!token) return;
    const rft = localStorage.getItem("rft");
    const manifest = useInstance().active;

    const { useApi } = await import("@/store/system/apiStore");
    const me = await useApi().userInteraction.GetMe();
    const id = deriveAccountId(manifest, me.userId);

    const res = addAccount({
      id,
      userId: me.userId,
      displayName: me.displayName,
      avatarFileId: me.avatarFileId ?? null,
      instanceManifest: manifest,
      instanceKind: manifest.instance.kind,
      refreshToken: rft,
      accessToken: token,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    if (!res.ok) {
      logger.warn("Account cap reached; cannot adopt session");
      return;
    }
    setActivePointer(id);
    // Fresh sign-in always happens from a clean login screen (no app state / liveQueries), so we can
    // swap the scratch `-default` DB to the per-account DB and continue loading smoothly — no reload.
    const { reopenActiveAccountDb } = await import("@/store/db/dexie");
    await reopenActiveAccountDb();
    const { useAppState } = await import("@/store/system/appState");
    await useAppState().continueAfterLogin();
  }

  /**
   * Keep the registry's copy of the signed-in identity current — name, avatar id, and the avatar
   * itself.
   *
   * A file id only means anything on the instance that issued it, and every avatar URL is built
   * against whichever instance is active right now. So the account picker rendering another
   * account's avatar asked THIS instance for a file belonging to a different one: the picture came
   * back missing, and a foreign file id was handed to a server with no business seeing it. The
   * bytes are taken here instead, while the account owning them is the active one, and kept with
   * the record — the picker then draws from that copy and never leaves its own instance.
   */
  async function syncActiveProfile(user: MigrationUser): Promise<void> {
    const acc = active.value;
    if (!acc || acc.userId !== user.userId) return;

    acc.displayName = user.displayName;
    acc.avatarFileId = user.avatarFileId;

    if (!user.avatarFileId) {
      acc.avatarDataUrl = null;
      acc.avatarCachedFor = null;
      persist();
      return;
    }

    persist();

    // Already held for this exact avatar — nothing to re-read.
    if (acc.avatarDataUrl && acc.avatarCachedFor === user.avatarFileId) return;

    try {
      const { cdnFetchUrl } = await import("@/store/system/fileStorage");
      const dataUrl = await readAvatarAsDataUrl(cdnFetchUrl(user.avatarFileId));
      if (!dataUrl) return;

      // The account can have been switched away from while the bytes were in flight.
      const current = accounts.value.find(a => a.id === acc.id);
      if (!current) return;
      current.avatarDataUrl = dataUrl;
      current.avatarCachedFor = user.avatarFileId;
      persist();
    } catch (e) {
      logger.warn("Failed to cache account avatar", e);
    }
  }

  /** Persist a freshly-minted access token back into the active record (called after GetMyAuthorization). */
  function updateActiveTokens(token: string) {
    const acc = active.value;
    if (!acc) return;
    acc.accessToken = token;
    acc.lastUsedAt = Date.now();
    persist();
  }

  /**
   * Boot: re-point endpoints from the active account's manifest and project its tokens into the
   * legacy keys the existing auth pipeline reads. Must run BEFORE any RPC/Dexie use (appState step 0).
   * Returns false when there is no active account (→ show login).
   */
  function applyActiveAtBoot(): boolean {
    const acc = active.value;
    if (!acc) return false;
    useInstance().applyManifestObject(acc.instanceManifest);
    if (acc.accessToken) localStorage.setItem("token", acc.accessToken);
    else localStorage.removeItem("token");
    if (acc.refreshToken) localStorage.setItem("rft", acc.refreshToken);
    else localStorage.removeItem("rft");
    return true;
  }

  /**
   * One-time migration of a pre-multi-account session (single `token`/`rft` + optional `argon_instance`)
   * into the registry. The id needs the userId (only known after GetMe), so we stash context here and
   * finalize from appState once the profile loads. Synchronous; leaves the existing token/rft in place
   * so the normal pipeline authenticates this boot.
   */
  function migrateLegacySessionIfNeeded(): void {
    // Nothing to migrate on the web, and it must not try: the OAuth access token is written to the
    // same `token` key this reads, so it would mistake a fresh browser sign-in for a legacy desktop
    // session and start a migration that ends in a reload loop.
    if (isWeb) return;
    if (accounts.value.length > 0) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const rft = localStorage.getItem("rft");

    let manifest: InstanceManifest = DEFAULT_MANIFEST;
    try {
      const raw = localStorage.getItem("argon_instance");
      if (raw) {
        const parsed = instanceManifestSchema.safeParse(JSON.parse(raw));
        if (parsed.success) manifest = parsed.data;
      }
    } catch { /* default */ }

    migrating.value = true;
    migrationCtx = { token, rft, manifest };
  }

  const isMigrating = computed(() => migrating.value);

  /** Finalize migration once the user profile is known, then reload into the per-account DB. */
  async function finalizeMigration(user: MigrationUser): Promise<void> {
    if (!migrating.value || !migrationCtx) return;
    const { token, rft, manifest } = migrationCtx;
    const id = deriveAccountId(manifest, user.userId);

    accounts.value = [{
      id,
      userId: user.userId,
      displayName: user.displayName,
      avatarFileId: user.avatarFileId,
      instanceManifest: manifest,
      instanceKind: manifest.instance.kind,
      refreshToken: rft,
      accessToken: token,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    }];
    persist();
    setActivePointer(id);

    // Carry over the existing user's un-suffixed user-scoped data into the per-account namespace.
    for (const base of USER_SCOPED_BASE_KEYS) {
      const old = localStorage.getItem(base);
      if (old !== null && localStorage.getItem(`${base}::${id}`) === null) {
        localStorage.setItem(`${base}::${id}`, old);
        localStorage.removeItem(base);
      }
    }

    migrating.value = false;
    migrationCtx = null;
    try { await Dexie.delete("argon-database-v3"); } catch { /* legacy DB may not exist */ }
    location.reload();
  }

  return {
    accounts,
    active,
    officialCount,
    altCount,
    canAddOfficial,
    canAddAlt,
    canAdd,
    isMigrating,
    addAccount,
    switchTo,
    removeAccount,
    logoutActive,
    markActiveNeedsReauth,
    updateActiveTokens,
    adoptCurrentSession,
    syncActiveProfile,
    applyActiveAtBoot,
    gcOrphanDbs,
    migrateLegacySessionIfNeeded,
    finalizeMigration,
  };
});
