import { shallowReactive, toRaw } from "vue";
import type { IMessageEntity } from "@argon/glue";

/**
 * What a message still being sent shows over each of its attachments: how far along (0..1, null
 * for "working on it") and what it is doing, already in the user's language. Keyed by the optimistic
 * entity itself — the bubble that renders an entity asks for that entity's progress.
 *
 *   <VideoAttachment :video="v" v-bind="attachmentSendProgress(v)" />
 */
export interface AttachmentSendProgress {
  progress: number | null;
  stage: string | null;
}

const byEntity = shallowReactive(new Map<IMessageEntity, AttachmentSendProgress>());

/** Progress of an optimistic entity, or empty props once it is done (or was never sent from here). */
export function attachmentSendProgress(entity: IMessageEntity): Partial<AttachmentSendProgress> {
  return byEntity.get(toRaw(entity)) ?? {};
}

export function setAttachmentSendProgress(entity: IMessageEntity, progress: number | null, stage: string | null): void {
  const key = toRaw(entity);
  const current = byEntity.get(key);
  if (current && current.progress === progress && current.stage === stage) return;
  byEntity.set(key, { progress, stage });
}

export function clearAttachmentSendProgress(entity: IMessageEntity): void {
  byEntity.delete(toRaw(entity));
}

/**
 * Sends still uploading their files, by the optimistic message's random id: until the upload is
 * done the message is not on its way to the server, so it neither times out nor can it be what an
 * incoming echo of the sender's own message stands for.
 */
const uploading = new Set<bigint>();
/** When each send's files finished, so its timeout counts from there. */
const uploadedAt = new Map<bigint, number>();
const FORGET_AFTER_MS = 5 * 60_000;

export function markSendUploading(randomId: bigint): void {
  uploading.add(randomId);
}

export function markSendUploaded(randomId: bigint): void {
  if (!uploading.delete(randomId)) return;
  uploadedAt.set(randomId, Date.now());
  setTimeout(() => uploadedAt.delete(randomId), FORGET_AFTER_MS);
}

export function isSendUploading(randomId: bigint | undefined | null): boolean {
  return randomId != null && uploading.has(randomId);
}

/**
 * How much longer an optimistic message may wait before it counts as timed out: the whole timeout
 * again while its files upload, the rest of it measured from the end of the upload after that, and
 * 0 when it never uploaded anything (its timeout ran from the start).
 */
export function sendTimeoutLeft(randomId: bigint, timeoutMs: number): number {
  if (uploading.has(randomId)) return timeoutMs;
  const at = uploadedAt.get(randomId);
  return at === undefined ? 0 : Math.max(0, at + timeoutMs - Date.now());
}
