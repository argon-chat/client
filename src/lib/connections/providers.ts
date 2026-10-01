import type { Component } from "vue";
import {
  IconBrandGithub,
  IconBrandSpotify,
  IconBrandSteam,
  IconBrandTelegram,
  IconBrandTwitch,
  IconBrandX,
  IconBrandYoutube,
} from "@tabler/icons-vue";
import {
  ConnectionCapability,
  ConnectionDetailKind,
  ConnectionProvider,
  type ConnectionDetail,
  type SpotifyTrack,
} from "@argon/glue";

export interface ProviderMeta {
  provider: ConnectionProvider;
  /** The provider as the server names it in URLs and feature flags. */
  slug: string;
  /** Brand names are not translated. */
  name: string;
  icon: Component;
  /** The brand colour, for the icon tile. */
  color: string;
}

export const PROVIDERS: Record<ConnectionProvider, ProviderMeta> = {
  [ConnectionProvider.GITHUB]: { provider: ConnectionProvider.GITHUB, slug: "github", name: "GitHub", icon: IconBrandGithub, color: "#8b949e" },
  [ConnectionProvider.STEAM]: { provider: ConnectionProvider.STEAM, slug: "steam", name: "Steam", icon: IconBrandSteam, color: "#66c0f4" },
  [ConnectionProvider.SPOTIFY]: { provider: ConnectionProvider.SPOTIFY, slug: "spotify", name: "Spotify", icon: IconBrandSpotify, color: "#1db954" },
  [ConnectionProvider.TWITTER]: { provider: ConnectionProvider.TWITTER, slug: "twitter", name: "X", icon: IconBrandX, color: "#e7e9ea" },
  [ConnectionProvider.TWITCH]: { provider: ConnectionProvider.TWITCH, slug: "twitch", name: "Twitch", icon: IconBrandTwitch, color: "#a970ff" },
  [ConnectionProvider.YOUTUBE]: { provider: ConnectionProvider.YOUTUBE, slug: "youtube", name: "YouTube", icon: IconBrandYoutube, color: "#ff3d3d" },
  [ConnectionProvider.TELEGRAM]: { provider: ConnectionProvider.TELEGRAM, slug: "telegram", name: "Telegram", icon: IconBrandTelegram, color: "#2aabee" },
};

/** The order providers are offered in; anything the server adds later goes to the end. */
export const PROVIDER_ORDER: ConnectionProvider[] = [
  ConnectionProvider.SPOTIFY,
  ConnectionProvider.STEAM,
  ConnectionProvider.TWITCH,
  ConnectionProvider.YOUTUBE,
  ConnectionProvider.GITHUB,
  ConnectionProvider.TWITTER,
  ConnectionProvider.TELEGRAM,
];

export function providerMeta(provider: ConnectionProvider): ProviderMeta | undefined {
  return PROVIDERS[provider];
}

export function sortByProvider<T extends { provider: ConnectionProvider }>(items: readonly T[]): T[] {
  const rank = (p: ConnectionProvider) => {
    const i = PROVIDER_ORDER.indexOf(p);
    return i < 0 ? PROVIDER_ORDER.length + p : i;
  };
  return [...items].sort((a, b) => rank(a.provider) - rank(b.provider));
}

export function hasCapability(capabilities: ConnectionCapability, flag: ConnectionCapability): boolean {
  return (capabilities & flag) === flag;
}

/**
 * A detail key as it appears in its translation key, `connection_detail_<slug>`. Server keys are
 * dotted (`steam.games`), and a dot in a vue-i18n key is a path, so they are flattened. Callers
 * spell the template out at the t() call so the locale check can see the family is used.
 */
export function detailSlug(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, "_");
}

/** How a detail's value reads on a card. Unknown kinds fall back to the raw value. */
export function formatDetailValue(detail: ConnectionDetail, locale?: string): string {
  switch (detail.kind) {
    case ConnectionDetailKind.NUMBER: {
      const n = Number(detail.value);
      return Number.isFinite(n)
        ? new Intl.NumberFormat(locale, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n)
        : detail.value;
    }
    case ConnectionDetailKind.DATE: {
      const d = new Date(`${detail.value}T00:00:00Z`);
      return Number.isNaN(d.getTime())
        ? detail.value
        : d.toLocaleDateString(locale, { year: "numeric", month: "short", timeZone: "UTC" });
    }
    default:
      return detail.value;
  }
}

/**
 * The details a card shows as facts: flags that say "true", and every other kind. A flag that is
 * false ("not Premium") is not a fact worth a chip.
 */
export function visibleDetails(details: readonly ConnectionDetail[]): ConnectionDetail[] {
  return details.filter((d) => d.kind !== ConnectionDetailKind.FLAG || d.value === "true");
}

export interface TrackProgress {
  positionMs: number;
  durationMs: number;
  /** 0..1 */
  fraction: number;
}

/**
 * Milliseconds since the epoch of an Ion datetime — or of what is left of one after a trip through
 * IndexedDB, which keeps its fields and drops its class (the user cache stores activities there).
 */
export function instantMs(value: { unixTicks: bigint } | null | undefined): number {
  if (!value || typeof value.unixTicks !== "bigint") return Date.now();
  return Number(value.unixTicks / 10_000n);
}

/** Where a track is now, from where the server last saw it. A paused track stands still. */
export function trackProgress(track: SpotifyTrack, nowMs: number = Date.now()): TrackProgress {
  const observed = instantMs(track.observedAt);
  const elapsed = track.isPlaying ? Math.max(0, nowMs - observed) : 0;
  const durationMs = Math.max(0, track.durationMs);
  const positionMs = Math.min(durationMs, track.progressMs + elapsed);
  return { positionMs, durationMs, fraction: durationMs > 0 ? positionMs / durationMs : 0 };
}

/** `m:ss`, or `h:mm:ss` past an hour (podcasts). */
export function formatTrackTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
