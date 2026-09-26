import { BroadcastOverlap, SetBroadcastSettingsError, type BroadcastSettings } from "@argon/glue";
import type { IonPartial } from "@argon-chat/ion.webcore";

/**
 * The broadcast settings form and the sparse patch it saves with.
 *
 * `PatchBroadcastSettings` takes only the keys that changed: a key it does not see is left alone,
 * and `maxTransmitSeconds: null` clears the limit. The form keeps the last limit the user typed
 * while the switch is off, so turning it back on does not start from scratch.
 *
 * Dirtiness is per field. The caller records which fields the user touched; a change that
 * arrives from elsewhere is written into the others (`applyRemoteSettings`), and the patch only
 * ever carries touched fields — so an edit here never sends back a stale value for a field
 * somebody else just changed.
 */

/** Mirrors the server defaults (voice-broadcast.md, "Model"). */
export const DEFAULT_MAX_TRANSMIT_SECONDS = 120;
export const MIN_MAX_TRANSMIT_SECONDS = 10;
export const MAX_MAX_TRANSMIT_SECONDS = 3600;
export const MIN_DUCKING_DB = -40;
export const MAX_DUCKING_DB = 0;

export interface BroadcastForm {
  targets: string[];
  overlap: BroadcastOverlap;
  duckingDb: number;
  limitOn: boolean;
  maxTransmitSeconds: number;
  chirp: boolean;
}

/** A field the user can touch; the limit switch and its number are one field. */
export type BroadcastField = "targets" | "overlap" | "duckingDb" | "limit" | "chirp";

export function clampTransmitSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_TRANSMIT_SECONDS;
  return Math.min(MAX_MAX_TRANSMIT_SECONDS, Math.max(MIN_MAX_TRANSMIT_SECONDS, Math.round(value)));
}

export function clampDuckingDb(value: number): number {
  if (!Number.isFinite(value)) return MAX_DUCKING_DB;
  return Math.min(MAX_DUCKING_DB, Math.max(MIN_DUCKING_DB, Math.round(value)));
}

export function formFromSettings(settings: BroadcastSettings): BroadcastForm {
  return {
    targets: [...settings.targets],
    overlap: settings.overlap,
    duckingDb: settings.duckingDb,
    limitOn: settings.maxTransmitSeconds !== null,
    maxTransmitSeconds: settings.maxTransmitSeconds ?? DEFAULT_MAX_TRANSMIT_SECONDS,
    chirp: settings.chirp,
  };
}

const sameTargets = (a: readonly string[], b: readonly string[]) => {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort();
  const other = [...b].sort();
  return sorted.every((id, i) => id === other[i]);
};

/** The limit the form asks for: the clamped number, or null for "no limit". */
export function limitOf(form: Pick<BroadcastForm, "limitOn" | "maxTransmitSeconds">): number | null {
  return form.limitOn ? clampTransmitSeconds(form.maxTransmitSeconds) : null;
}

/**
 * Writes `settings` into the fields the user has not touched; their own edits stay.
 * Without `touched`, every field is taken.
 */
export function applyRemoteSettings(form: BroadcastForm, settings: BroadcastSettings, touched?: ReadonlySet<BroadcastField>): void {
  const fresh = formFromSettings(settings);
  const keep = (field: BroadcastField) => touched?.has(field) ?? false;
  if (!keep("targets")) form.targets = fresh.targets;
  if (!keep("overlap")) form.overlap = fresh.overlap;
  if (!keep("duckingDb")) form.duckingDb = fresh.duckingDb;
  if (!keep("limit")) {
    form.limitOn = fresh.limitOn;
    form.maxTransmitSeconds = fresh.maxTransmitSeconds;
  }
  if (!keep("chirp")) form.chirp = fresh.chirp;
}

/**
 * Only the keys whose value differs from `current`, among the fields the user touched (every
 * field when `touched` is not given); an empty object when nothing changed.
 */
export function buildBroadcastPatch(
  current: BroadcastSettings,
  form: BroadcastForm,
  touched?: ReadonlySet<BroadcastField>,
): IonPartial<BroadcastSettings> {
  const consider = (field: BroadcastField) => touched === undefined || touched.has(field);
  const patch: IonPartial<BroadcastSettings> = {};
  if (consider("targets") && !sameTargets(current.targets, form.targets)) patch.targets = [...form.targets];
  if (consider("overlap") && form.overlap !== current.overlap) patch.overlap = form.overlap;
  if (consider("duckingDb")) {
    const ducking = clampDuckingDb(form.duckingDb);
    if (ducking !== current.duckingDb) patch.duckingDb = ducking;
  }
  if (consider("limit")) {
    const limit = limitOf(form);
    if (limit !== current.maxTransmitSeconds) patch.maxTransmitSeconds = limit;
  }
  if (consider("chirp") && form.chirp !== current.chirp) patch.chirp = form.chirp;
  return patch;
}

export function isBroadcastFormDirty(
  current: BroadcastSettings,
  form: BroadcastForm,
  touched?: ReadonlySet<BroadcastField>,
): boolean {
  return Object.keys(buildBroadcastPatch(current, form, touched)).length > 0;
}

const ERROR_KEYS: Record<SetBroadcastSettingsError, string> = {
  [SetBroadcastSettingsError.NONE]: "broadcast_error_unknown",
  [SetBroadcastSettingsError.INSUFFICIENT_PERMISSIONS]: "broadcast_error_insufficient_permissions",
  [SetBroadcastSettingsError.CHANNEL_IS_NOT_VOICE]: "broadcast_error_not_voice",
  [SetBroadcastSettingsError.INVALID_TARGET]: "broadcast_error_invalid_target",
  [SetBroadcastSettingsError.NOT_A_BROADCAST_CHANNEL]: "broadcast_error_not_broadcast",
};

/** The i18n key for a refused SetBroadcastMode / PatchBroadcastSettings. */
export function broadcastErrorKey(error: SetBroadcastSettingsError): string {
  return ERROR_KEYS[error] ?? ERROR_KEYS[SetBroadcastSettingsError.NONE];
}

export const OVERLAP_OPTIONS: readonly { value: BroadcastOverlap; labelKey: string; descKey: string }[] = [
  { value: BroadcastOverlap.MIX, labelKey: "broadcast_overlap_mix", descKey: "broadcast_overlap_mix_desc" },
  { value: BroadcastOverlap.LOCK, labelKey: "broadcast_overlap_lock", descKey: "broadcast_overlap_lock_desc" },
];
