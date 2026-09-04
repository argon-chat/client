import { persistedValue } from "@argon/storage";
import { openDB, type IDBPDatabase } from "idb";
import { defineStore } from "pinia";
import { computed, shallowReactive, watch } from "vue";
import {
  defaultHudConfig,
  normalizeHudConfig,
  type WidgetAnchor,
  type OverlayHudConfig,
  type OverlayWidgetType,
  type OverlayWidgetLayout,
  type VoiceLayoutMode,
  type VoiceWidgetConfig,
} from "@/lib/overlay";

/**
 * One persisted record per game the app has ever detected (Discord-style "registered
 * games" journal). Keyed by a stable id (normalized exe path).
 *
 * Keep this shape small: the whole journal is re-serialized into localStorage every time a
 * `lastSeen` ticks. Icons deliberately live outside it (IndexedDB + `icons` below).
 */
export interface GameEntry {
  id: string;
  name: string;
  lastSeen: number;
  /** Share "playing X" presence to the server for this game. */
  activityPublish: boolean;
  /** Show the in-game overlay for this game. */
  overlayEnabled: boolean;
  /** false once we detect the overlay can't be shown (e.g. exclusive fullscreen). */
  supportsOverlay: boolean;
  unsupportedReason?: string;
}

/** What the UI renders: the persisted entry plus its icon (PNG data URL), when known. */
export type GameListItem = GameEntry & { icon?: string };

/** On-disk shape from before icons moved to IndexedDB: the data URL was stored inline. */
type LegacyGameEntry = GameEntry & { icon?: unknown };

/** Snapshot pushed to the main process so it can gate overlay + activity per game. */
export interface GameSettingsSnapshot {
  overlayEnabled: boolean;
  overlayOpacity: number;
  overlayAnchor: WidgetAnchor;
  overlayScreenPadding: number;
  activityPublishEnabled: boolean;
  games: Record<string, { overlayEnabled: boolean; activityPublish: boolean }>;
  /** Full HUD config (per-widget placement/appearance) for the overlay window. */
  hud: OverlayHudConfig;
}

export function normalizeGameId(path: string, name: string): string {
  const p = (path ?? "").trim().toLowerCase();
  return p || `name:${(name ?? "").trim().toLowerCase()}`;
}

/** Entries not seen for this long are dropped from the journal on startup. */
const JOURNAL_MAX_AGE_MS = 180 * 86_400_000;
/** Hard cap on journal size after the age prune (most recently seen win). */
const JOURNAL_MAX_ENTRIES = 300;

// ── Icon storage (IndexedDB) ──
// Exe icons are PNG data URLs of tens of KB each; keeping them in the persisted journal
// would both bloat every localStorage write and eventually hit the quota. They go into a
// dedicated database instead (separate from the Dexie one, whose version bumps purge data).
// Every access is best-effort: IndexedDB may be unavailable, and the store must keep
// working without it (icons are then re-extracted from the exe each session).

const ICON_DB_NAME = "argon.game-icons";
const ICON_DB_VERSION = 1;
const ICON_STORE = "icons";

let iconDbPromise: Promise<IDBPDatabase | null> | undefined;

function iconDb(): Promise<IDBPDatabase | null> {
  if (!iconDbPromise) {
    iconDbPromise = (async () => {
      try {
        if (typeof indexedDB === "undefined") return null;
        return await openDB(ICON_DB_NAME, ICON_DB_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(ICON_STORE)) db.createObjectStore(ICON_STORE);
          },
        });
      } catch {
        return null;
      }
    })();
  }
  return iconDbPromise;
}

async function readStoredIcon(id: string): Promise<string | undefined> {
  try {
    const db = await iconDb();
    const value = await db?.get(ICON_STORE, id);
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

async function writeStoredIcon(id: string, dataUrl: string): Promise<void> {
  try {
    const db = await iconDb();
    await db?.put(ICON_STORE, dataUrl, id);
  } catch { /* ignore */ }
}

async function deleteStoredIcon(id: string): Promise<void> {
  try {
    const db = await iconDb();
    await db?.delete(ICON_STORE, id);
  } catch { /* ignore */ }
}

export const useGameOverlaySettings = defineStore("gameOverlaySettings", () => {
  // ── Global overlay params ──
  const overlayEnabled = persistedValue<boolean>("argon.overlay.enabled", true);
  const overlayOpacity = persistedValue<number>("argon.overlay.opacity", 0.45);
  const overlayAnchor = persistedValue<WidgetAnchor>("argon.overlay.anchor", "top-left");
  const overlayScreenPadding = persistedValue<number>("argon.overlay.screenPadding", 20);

  // ── Global activity-publication toggle ──
  const activityPublishEnabled = persistedValue<boolean>("argon.overlay.activityPublish", true);

  // ── Rich HUD config (per-widget placement/appearance) — reactive, deep-persisted ──
  const hud = persistedValue<OverlayHudConfig>("argon.overlay.hud", defaultHudConfig());

  // ── Per-game journal (reactive object → deep-persisted) ──
  const games = persistedValue<Record<string, GameEntry>>("argon.overlay.games", {});

  // ── Icons by game id, filled lazily from IndexedDB / the exe. Never persisted with `games`. ──
  const icons = shallowReactive<Record<string, string>>({});
  /** In-flight icon lookups, so a burst of detections doesn't extract the same exe icon twice. */
  const pendingIcons = new Map<string, Promise<void>>();

  const gamesList = computed<GameListItem[]>(() =>
    Object.values(games)
      .map((g): GameListItem => {
        const icon = icons[g.id];
        return icon ? { ...g, icon } : { ...g };
      })
      .sort((a, b) => b.lastSeen - a.lastSeen),
  );

  function recordGame(path: string, name: string): GameEntry {
    const id = normalizeGameId(path, name);
    const existing = games[id];
    if (existing) {
      existing.lastSeen = Date.now();
      if (name) existing.name = name;
      void ensureIcon(id);
      return existing;
    }
    const entry: GameEntry = {
      id,
      name: name || id,
      lastSeen: Date.now(),
      activityPublish: true,
      overlayEnabled: true,
      supportsOverlay: true,
    };
    games[id] = entry;
    void ensureIcon(id);
    return entry;
  }

  /**
   * Make the game's icon available in `icons`: from IndexedDB if cached there, otherwise
   * extracted once from the exe via the main process (id is the normalized exe path) and
   * cached. Games matched by name only have no exe to read from.
   */
  function ensureIcon(id: string): Promise<void> {
    if (icons[id] || id.startsWith("name:") || !games[id]) return Promise.resolve();
    let pending = pendingIcons.get(id);
    if (!pending) {
      pending = loadIcon(id).finally(() => pendingIcons.delete(id));
      pendingIcons.set(id, pending);
    }
    return pending;
  }

  async function loadIcon(id: string): Promise<void> {
    const stored = await readStoredIcon(id);
    if (stored) {
      if (games[id]) icons[id] = stored;
      return;
    }
    try {
      const dataUrl = await (globalThis as any).argonOverlay?.getGameIcon?.(id);
      if (typeof dataUrl === "string" && dataUrl && games[id]) {
        icons[id] = dataUrl;
        await writeStoredIcon(id, dataUrl);
      }
    } catch { /* ignore */ }
  }

  function forgetIcon(id: string): void {
    delete icons[id];
    void deleteStoredIcon(id);
  }

  function setGameOverlay(id: string, enabled: boolean): void {
    if (games[id]) games[id].overlayEnabled = enabled;
  }
  function setGameActivity(id: string, enabled: boolean): void {
    if (games[id]) games[id].activityPublish = enabled;
  }
  function markUnsupported(id: string, reason: string): void {
    if (games[id]) { games[id].supportsOverlay = false; games[id].unsupportedReason = reason; }
  }
  function markSupported(id: string): void {
    if (games[id]) { games[id].supportsOverlay = true; games[id].unsupportedReason = undefined; }
  }
  function removeGame(id: string): void {
    delete games[id];
    forgetIcon(id);
  }

  // ── Journal housekeeping (run once at init) ──

  /** Drop entries not seen for 180 days, then cap the journal at the 300 most recently seen. */
  function pruneJournal(): void {
    const now = Date.now();
    const remove: string[] = [];
    const kept: Array<{ id: string; lastSeen: number }> = [];
    for (const [id, entry] of Object.entries(games)) {
      const lastSeen = Number(entry?.lastSeen) || 0;
      if (now - lastSeen > JOURNAL_MAX_AGE_MS) remove.push(id);
      else kept.push({ id, lastSeen });
    }
    if (kept.length > JOURNAL_MAX_ENTRIES) {
      kept.sort((a, b) => b.lastSeen - a.lastSeen);
      for (const { id } of kept.slice(JOURNAL_MAX_ENTRIES)) remove.push(id);
    }
    for (const id of remove) removeGame(id);
  }

  /**
   * Icons used to be persisted inline as `icon` on each entry. Move any such blob into
   * IndexedDB (and the in-memory map) and strip the field, so the next localStorage write of
   * the journal no longer carries them.
   */
  function migrateLegacyIcons(): void {
    for (const [id, entry] of Object.entries(games as Record<string, LegacyGameEntry>)) {
      if (!entry || !("icon" in entry)) continue;
      const legacy = entry.icon;
      delete entry.icon;
      if (typeof legacy === "string" && legacy && !icons[id]) {
        icons[id] = legacy;
        void writeStoredIcon(id, legacy);
      }
    }
  }

  // ── HUD config mutators (used by the layout editor + settings) ──

  /** Build a complete, plain HUD payload, folding the legacy global controls in. */
  function buildHud(): OverlayHudConfig {
    const h = normalizeHudConfig(hud);
    h.globalOpacity = overlayOpacity.value;
    h.screenPadding = overlayScreenPadding.value;
    // The legacy "Position" select still drives the voice widget's anchor.
    h.widgets.voice.anchor = overlayAnchor.value;
    return h;
  }

  function setVoiceMode(mode: VoiceLayoutMode): void {
    hud.voice.mode = mode;
  }
  function setVoiceAppearance(patch: Partial<VoiceWidgetConfig>): void {
    Object.assign(hud.voice, patch);
  }
  function setWidgetLayout(type: OverlayWidgetType, patch: Partial<OverlayWidgetLayout>): void {
    Object.assign(hud.widgets[type], patch);
  }
  function resetHud(): void {
    Object.assign(hud, defaultHudConfig());
  }

  function snapshot(): GameSettingsSnapshot {
    const g: Record<string, { overlayEnabled: boolean; activityPublish: boolean }> = {};
    for (const [id, e] of Object.entries(games)) {
      g[id] = { overlayEnabled: e.overlayEnabled, activityPublish: e.activityPublish };
    }
    return {
      overlayEnabled: overlayEnabled.value,
      overlayOpacity: overlayOpacity.value,
      overlayAnchor: overlayAnchor.value,
      overlayScreenPadding: overlayScreenPadding.value,
      activityPublishEnabled: activityPublishEnabled.value,
      games: g,
      hud: buildHud(),
    };
  }

  function push(): void {
    (globalThis as any).argonOverlay?.publishGameSettings?.(snapshot());
  }

  let initialized = false;
  function init(): void {
    if (initialized) return;
    initialized = true;

    // Housekeeping on the persisted journal: prune first so we don't migrate icons of
    // entries that are about to be dropped anyway.
    pruneJournal();
    migrateLegacyIcons();

    const bridge = (globalThis as any).argonOverlay;
    if (!bridge) return;

    // Backfill any HUD fields added since this config was first persisted.
    Object.assign(hud, normalizeHudConfig(hud));

    // A game was detected by the native plugin — record it (and resolve any unsupported flag).
    bridge.onGameDetected?.((g: { path?: string; name?: string }) => {
      const entry = recordGame(g?.path ?? "", g?.name ?? "");
      if (entry.supportsOverlay === false) { /* keep prior unsupported flag */ }
      push();
    });

    // The overlay reported it can't show for a game (e.g. exclusive fullscreen).
    bridge.onOverlayUnsupported?.((u: { path?: string; name?: string; reason?: string }) => {
      const id = normalizeGameId(u?.path ?? "", u?.name ?? "");
      if (!games[id]) recordGame(u?.path ?? "", u?.name ?? "");
      markUnsupported(id, u?.reason ?? "unsupported");
      push();
    });

    // Push settings to main whenever anything relevant changes.
    watch(
      [overlayEnabled, overlayOpacity, overlayAnchor, overlayScreenPadding, activityPublishEnabled, games, hud],
      () => push(),
      { deep: true },
    );
    push(); // initial

    // Load cached icons (or extract them once) for every game in the journal.
    for (const id of Object.keys(games)) void ensureIcon(id);
  }

  return {
    overlayEnabled,
    overlayOpacity,
    overlayAnchor,
    overlayScreenPadding,
    activityPublishEnabled,
    games,
    gamesList,
    hud,
    recordGame,
    setGameOverlay,
    setGameActivity,
    markUnsupported,
    markSupported,
    removeGame,
    setVoiceMode,
    setVoiceAppearance,
    setWidgetLayout,
    resetHud,
    snapshot,
    init,
  };
});
