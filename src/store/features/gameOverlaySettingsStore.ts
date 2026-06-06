import { persistedValue } from "@argon/storage";
import { defineStore } from "pinia";
import { computed, watch } from "vue";
import type { WidgetAnchor } from "@/lib/overlay";

/**
 * One persisted record per game the app has ever detected (Discord-style "registered
 * games" journal). Keyed by a stable id (normalized exe path).
 */
export interface GameEntry {
  id: string;
  name: string;
  lastSeen: number;
  /** Cached PNG data URL of the game's exe icon (extracted once via the main process). */
  icon?: string;
  /** Share "playing X" presence to the server for this game. */
  activityPublish: boolean;
  /** Show the in-game overlay for this game. */
  overlayEnabled: boolean;
  /** false once we detect the overlay can't be shown (e.g. exclusive fullscreen). */
  supportsOverlay: boolean;
  unsupportedReason?: string;
}

/** Snapshot pushed to the main process so it can gate overlay + activity per game. */
export interface GameSettingsSnapshot {
  overlayEnabled: boolean;
  overlayOpacity: number;
  overlayAnchor: WidgetAnchor;
  overlayScreenPadding: number;
  activityPublishEnabled: boolean;
  games: Record<string, { overlayEnabled: boolean; activityPublish: boolean }>;
}

export function normalizeGameId(path: string, name: string): string {
  const p = (path ?? "").trim().toLowerCase();
  return p || `name:${(name ?? "").trim().toLowerCase()}`;
}

export const useGameOverlaySettings = defineStore("gameOverlaySettings", () => {
  // ── Global overlay params ──
  const overlayEnabled = persistedValue<boolean>("argon.overlay.enabled", true);
  const overlayOpacity = persistedValue<number>("argon.overlay.opacity", 0.45);
  const overlayAnchor = persistedValue<WidgetAnchor>("argon.overlay.anchor", "top-left");
  const overlayScreenPadding = persistedValue<number>("argon.overlay.screenPadding", 20);

  // ── Global activity-publication toggle ──
  const activityPublishEnabled = persistedValue<boolean>("argon.overlay.activityPublish", true);

  // ── Per-game journal (reactive object → deep-persisted) ──
  const games = persistedValue<Record<string, GameEntry>>("argon.overlay.games", {});

  const gamesList = computed(() =>
    Object.values(games).sort((a, b) => b.lastSeen - a.lastSeen),
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

  /** Extract + cache the game's exe icon once (id is the normalized exe path). */
  async function ensureIcon(id: string): Promise<void> {
    const entry = games[id];
    if (!entry || entry.icon || id.startsWith("name:")) return;
    try {
      const dataUrl = await (globalThis as any).argonOverlay?.getGameIcon?.(id);
      if (dataUrl && games[id]) games[id].icon = dataUrl;
    } catch { /* ignore */ }
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
    };
  }

  function push(): void {
    (globalThis as any).argonOverlay?.publishGameSettings?.(snapshot());
  }

  let initialized = false;
  function init(): void {
    if (initialized) return;
    initialized = true;
    const bridge = (globalThis as any).argonOverlay;
    if (!bridge) return;

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
      [overlayEnabled, overlayOpacity, overlayAnchor, overlayScreenPadding, activityPublishEnabled, games],
      () => push(),
      { deep: true },
    );
    push(); // initial

    // Backfill icons for games recorded before icon caching existed.
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
    recordGame,
    setGameOverlay,
    setGameActivity,
    markUnsupported,
    markSupported,
    removeGame,
    snapshot,
    init,
  };
});
