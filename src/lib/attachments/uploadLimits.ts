import { logger } from "@argon/core";
import type { Guid } from "@argon-chat/ion.webcore";
import type { UploadLimits } from "@argon/glue";
import { onSessionReset } from "@/store/system/sessionLifecycle";

/** Where files go: a channel of a space, or the direct chat with one person. */
export type LimitsTarget = { kind: "channel"; spaceId: Guid; channelId: Guid } | { kind: "dm"; peerId: Guid };

/** The calls the limits come from; `useApi()` fits it. */
export interface UploadLimitsApi {
  channelInteraction: { GetUploadLimits(spaceId: Guid, channelId: Guid): Promise<UploadLimits> };
  userChatInteractions: { GetUploadLimits(peerId: Guid): Promise<UploadLimits> };
}

export interface ResolvedUploadLimits {
  attachmentMaxBytes: number;
  videoMaxBytes: number;
  videoMaxDurationMs: number;
  /** The server did not say (it failed, or predates the call): these are the defaults. */
  fallback: boolean;
}

/** The base tier, used when the server cannot be asked. */
export const DEFAULT_UPLOAD_LIMITS: ResolvedUploadLimits = {
  attachmentMaxBytes: 100 * 1024 * 1024,
  videoMaxBytes: 100 * 1024 * 1024,
  videoMaxDurationMs: 4 * 60 * 60 * 1000,
  fallback: true,
};

/** A failed ask is tried again after this; a server that answered is believed for the session. */
const RETRY_AFTER_FAILURE_MS = 60_000;

interface Entry {
  promise: Promise<ResolvedUploadLimits>;
  /** Until when the answer stands (forever for a real one). */
  until: number;
}

const cache = new Map<string, Entry>();
onSessionReset(() => cache.clear());

export function limitsKey(target: LimitsTarget): string {
  return target.kind === "dm" ? `dm:${target.peerId}` : `channel:${target.spaceId}:${target.channelId}`;
}

const positive = (value: bigint | number | null | undefined, fallback: number): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

async function ask(api: UploadLimitsApi, target: LimitsTarget): Promise<ResolvedUploadLimits> {
  const limits = target.kind === "dm"
    ? await api.userChatInteractions.GetUploadLimits(target.peerId)
    : await api.channelInteraction.GetUploadLimits(target.spaceId, target.channelId);
  return {
    attachmentMaxBytes: positive(limits?.attachmentMaxBytes, DEFAULT_UPLOAD_LIMITS.attachmentMaxBytes),
    videoMaxBytes: positive(limits?.videoMaxBytes, DEFAULT_UPLOAD_LIMITS.videoMaxBytes),
    videoMaxDurationMs: positive(limits?.videoMaxDurationMs, DEFAULT_UPLOAD_LIMITS.videoMaxDurationMs),
    fallback: false,
  };
}

/**
 * What this user may upload to `target`, asked once per target and kept for the session. A server
 * that fails or has no such method (an older one) gives the defaults, never an error: sending goes
 * on with them, and the server is asked again a minute later.
 */
export function resolveUploadLimits(api: UploadLimitsApi, target: LimitsTarget): Promise<ResolvedUploadLimits> {
  const key = limitsKey(target);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.promise;

  const entry: Entry = { until: Number.POSITIVE_INFINITY, promise: Promise.resolve(DEFAULT_UPLOAD_LIMITS) };
  entry.promise = ask(api, target).catch((e) => {
    logger.info("Upload limits unavailable; using the defaults:", e);
    entry.until = Date.now() + RETRY_AFTER_FAILURE_MS;
    return DEFAULT_UPLOAD_LIMITS;
  });
  cache.set(key, entry);
  return entry.promise;
}

/** Forgets a target's limits (the server refused something they allowed): the next send asks again. */
export function invalidateUploadLimits(target: LimitsTarget): void {
  cache.delete(limitsKey(target));
}

/** Tests. */
export function clearUploadLimits(): void {
  cache.clear();
}

/** A byte limit as people read it: `100 MB`, `2 GB`, `1.5 GB`. */
export function formatLimitBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${Number(gb.toFixed(1))} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** A duration limit as people read it: `4:00:00`, `10:00`. */
export function formatLimitDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
