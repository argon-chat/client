import {
  PrepareUploadError,
  SuccessUploadFile,
  VideoUploadError,
  type AttachmentInfo,
  type IChannelInteraction,
  type IPrepareUploadResult,
  type IUploadFileResult,
  type IUserChatInteractions,
  type IVideoUploadResult,
  type UploadedPart,
  type VideoInfo,
  type VideoUploadDeclaration,
  type VideoUploadTicket,
} from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { logger } from "@argon/core";
import { sha256Hex } from "@/lib/attachments/hash";
import { uploadFile } from "@/lib/uploadFile";
import { isAbortError, VideoPartUploadError } from "./errors";
import { VideoUploadFailure, videoUploadFailureName, type VideoUploadFailureCode } from "./uploadErrors";
import { preloadPrefixAfter } from "./preloadPrefix";
import { isFastStart, moovInServerReach, readTopLevelBoxes, SERVER_HEAD_BYTES, VIDEO_PROBE_BYTES, type Mp4Box } from "./mp4Boxes";
import { highWater, uploadVideoParts, uploadVideoSingle, type PartPut } from "./multipartUpload";
import { recordUpload, type VideoUploadTransport } from "./telemetry";
import type { PreparedVideo } from "./transcode";
import type { VideoPoster } from "./poster";
import type { VideoStoryboardSprite } from "./storyboard";

/** Where the video goes: a channel of a space, or the direct chat with one person. */
export type VideoUploadTarget = { kind: "channel"; spaceId: Guid; channelId: Guid } | { kind: "dm"; peerId: Guid };

type UploadCalls =
  | "PrepareUploadAttachment"
  | "BeginUploadAttachment"
  | "CompleteUploadAttachment"
  | "PrepareVideoUpload"
  | "CompleteVideoUpload"
  | "AbortVideoUpload";

/** The calls an upload makes; `useApi()` fits it. */
export interface VideoUploadApi {
  channelInteraction: Pick<IChannelInteraction, UploadCalls>;
  userChatInteractions: Pick<IUserChatInteractions, UploadCalls>;
}

export type VideoUploadStage = "poster" | "storyboard" | "video";

/** A prepared video plus what goes up with it. */
export interface VideoUploadInput extends PreparedVideo {
  fileName: string;
  poster?: VideoPoster | null;
  storyboard?: VideoStoryboardSprite | null;
}

export interface UploadVideoOptions {
  /** Each stage's own 0..1. */
  onProgress?: (stage: VideoUploadStage, fraction: number) => void;
  signal?: AbortSignal;
  /** Defaults to the app's api store. */
  api?: VideoUploadApi;
  /** Parts in flight at once for a multipart ticket. */
  parallel?: number;
  /** Extra attempts per part / per single PUT. */
  retries?: number;
  /** Test hooks for the part transport and the retry wait. */
  put?: PartPut;
  backoffMs?: (attempt: number) => number;
}

/** The calls of one target, with the target's ids bound. */
interface TargetCalls {
  prepareAttachment(sha256: Uint8Array, size: bigint, contentType: string, fileName: string): Promise<IPrepareUploadResult>;
  beginAttachment(): Promise<IUploadFileResult>;
  completeAttachment(blobId: Guid): Promise<AttachmentInfo>;
  prepareVideo(declaration: VideoUploadDeclaration): Promise<IVideoUploadResult>;
  completeVideo(ticketId: Guid, parts: UploadedPart[]): Promise<IVideoUploadResult>;
  abortVideo(ticketId: Guid): Promise<void>;
}

function callsFor(api: VideoUploadApi, target: VideoUploadTarget): TargetCalls {
  if (target.kind === "dm") {
    const dm = api.userChatInteractions;
    const peer = target.peerId;
    return {
      prepareAttachment: (sha, size, type, name) => dm.PrepareUploadAttachment(peer, sha, size, type, name),
      beginAttachment: () => dm.BeginUploadAttachment(peer),
      completeAttachment: (blobId) => dm.CompleteUploadAttachment(peer, blobId),
      prepareVideo: (declaration) => dm.PrepareVideoUpload(peer, declaration),
      completeVideo: (ticketId, parts) => dm.CompleteVideoUpload(peer, ticketId, parts),
      abortVideo: (ticketId) => dm.AbortVideoUpload(peer, ticketId),
    };
  }
  const ch = api.channelInteraction;
  const { spaceId, channelId } = target;
  return {
    prepareAttachment: (sha, size, type, name) => ch.PrepareUploadAttachment(spaceId, channelId, sha, size, type, name),
    beginAttachment: () => ch.BeginUploadAttachment(spaceId, channelId),
    completeAttachment: (blobId) => ch.CompleteUploadAttachment(spaceId, channelId, blobId),
    prepareVideo: (declaration) => ch.PrepareVideoUpload(spaceId, channelId, declaration),
    completeVideo: (ticketId, parts) => ch.CompleteVideoUpload(spaceId, channelId, ticketId, parts),
    abortVideo: (ticketId) => ch.AbortVideoUpload(spaceId, channelId, ticketId),
  };
}

async function defaultApi(): Promise<VideoUploadApi> {
  const { useApi } = await import("@/store/system/apiStore");
  return useApi();
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hashOf(blob: Blob): Promise<string | null> {
  try {
    return await sha256Hex(blob);
  } catch (e) {
    logger.debug("video hashing skipped", e);
    return null;
  }
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new VideoUploadFailure("aborted");
}

function toFailure(e: unknown, signal: AbortSignal | undefined): VideoUploadFailure {
  if (e instanceof VideoUploadFailure) return e;
  if (signal?.aborted || isAbortError(e)) return new VideoUploadFailure("aborted", undefined, { cause: e });
  if (e instanceof VideoPartUploadError) {
    // A 5xx/408/429 that outlasted the retries is the transfer failing; any other refusal is the storage's.
    const transient = e.status !== undefined && (e.status >= 500 || e.status === 408 || e.status === 429);
    const code: VideoUploadFailureCode =
      e.code === "etag-unavailable" || e.code === "forbidden"
        ? e.code
        : e.code === "http"
          ? transient
            ? "network"
            : "storage"
          : e.code === "bad-ticket"
            ? VideoUploadError.INTERNAL_ERROR
            : "network";
    return new VideoUploadFailure(code, e.message, { cause: e });
  }
  return new VideoUploadFailure("network", e instanceof Error ? e.message : String(e), { cause: e });
}

/**
 * Fails early, before anything is declared or uploaded, when the server's header read would not find
 * the `moov` (it reads 64 KiB for it and refuses one ending beyond 32 MiB): NOT_STREAMABLE.
 */
async function checkStreamable(blob: Blob): Promise<Mp4Box> {
  const boxes = await readTopLevelBoxes(blob, { until: (b) => b.type === "moov" || b.type === "mdat" });
  const moov = boxes.find((b) => b.type === "moov");
  if (!isFastStart(boxes) || !moovInServerReach(moov)) {
    const where = moov ? `moov at ${moov.offset}..${moov.offset + moov.size}` : "no moov before the media";
    throw new VideoUploadFailure(
      VideoUploadError.NOT_STREAMABLE,
      `The MP4 header is beyond the server's reach (${where}; it must start in the first ${SERVER_HEAD_BYTES} bytes and end within ${VIDEO_PROBE_BYTES})`,
    );
  }
  return moov;
}

const extensionOf = (blob: Blob) => (blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp");

/** The name the MP4 is declared under: the source's stem with `.mp4`. */
export function mp4FileName(name: string): string {
  if (/\.mp4$/i.test(name)) return name;
  const stem = name.replace(/\.[^./\\]+$/, "").trim();
  return `${stem || "video"}.mp4`;
}

/**
 * An image attachment uploaded the way the composer uploads one (hash first, so a known image is
 * linked rather than sent), finalized, ready to be named as a poster or storyboard.
 */
async function uploadImage(
  calls: TargetCalls,
  blob: Blob,
  fileName: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal | undefined,
): Promise<AttachmentInfo> {
  const contentType = blob.type || "application/octet-stream";
  let ticket: IUploadFileResult | null = null;

  const hex = await hashOf(blob);
  if (hex) {
    let prepared: IPrepareUploadResult | null = null;
    try {
      prepared = await calls.prepareAttachment(hexToBytes(hex), BigInt(blob.size), contentType, fileName);
    } catch (e) {
      logger.warn("PrepareUploadAttachment failed; falling back to BeginUploadAttachment:", e);
    }
    if (prepared?.isAlreadyStored()) {
      onProgress(1);
      return prepared.info;
    }
    if (prepared?.isUploadRequired()) ticket = new SuccessUploadFile(prepared.blobId, prepared.uploadUrl, prepared.formFields, prepared.ttlSeconds);
    else if (prepared?.isFailedPrepareUpload()) throw new Error(PrepareUploadError[prepared.error] ?? "PrepareUploadAttachment failed");
  }

  ticket ??= await calls.beginAttachment();
  checkAbort(signal);
  const { blobId } = await uploadFile(ticket, blob, "VideoImage", { onProgress, signal });
  checkAbort(signal);
  const info = await calls.completeAttachment(blobId);
  onProgress(1);
  return info;
}

/** Poster and storyboard are extras: one that fails to upload is left out, the video still goes. */
async function optionalImage(
  calls: TargetCalls,
  blob: Blob,
  fileName: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal | undefined,
): Promise<AttachmentInfo | null> {
  try {
    return await uploadImage(calls, blob, fileName, onProgress, signal);
  } catch (e) {
    if (signal?.aborted || isAbortError(e) || (e instanceof VideoUploadFailure && e.code === "aborted")) throw e;
    logger.warn(`Uploading ${fileName} failed; the video goes without it:`, e);
    return null;
  }
}

/**
 * Uploads a prepared video to a channel or a direct chat and returns its media record:
 *
 * 0. the MP4's header is checked to be where the server reads it (else NOT_STREAMABLE at once);
 * 1. the poster, then the storyboard, as ordinary image attachments of the same target;
 * 2. PrepareVideoUpload with the declaration (hash, size, display size, duration, codec, poster,
 *    storyboard, preload prefix): VideoStored when the server already has these bytes, otherwise a
 *    ticket. POSTER_REJECTED is asked once more without poster, storyboard and thumbHash;
 * 3. the parts in parallel (or one PUT, for an older server's ticket without part URLs);
 * 4. CompleteVideoUpload, answered with VideoStored.
 *
 * Each stage's progress only goes up. A refusal, a transfer failure or a cancel gives the ticket
 * back (AbortVideoUpload, best effort) and rejects with {@link VideoUploadFailure}.
 */
export async function uploadVideo(target: VideoUploadTarget, prepared: VideoUploadInput, options: UploadVideoOptions = {}): Promise<VideoInfo> {
  const { signal } = options;
  const stageProgress = {
    poster: highWater<[]>((f) => options.onProgress?.("poster", f)),
    storyboard: highWater<[]>((f) => options.onProgress?.("storyboard", f)),
    video: highWater<[]>((f) => options.onProgress?.("video", f)),
  };
  const startedAt = performance.now();
  let transport: VideoUploadTransport = "none";
  let ticket: VideoUploadTicket | null = null;
  let calls: TargetCalls | null = null;

  try {
    checkAbort(signal);
    const { blob } = prepared;
    const moov = await checkStreamable(blob);
    calls = callsFor(options.api ?? (await defaultApi()), target);
    const fileName = mp4FileName(prepared.fileName);
    const stem = fileName.replace(/\.mp4$/i, "");

    const poster = prepared.poster
      ? await optionalImage(calls, prepared.poster.blob, `${stem}.poster.${extensionOf(prepared.poster.blob)}`, stageProgress.poster, signal)
      : null;
    const storyboard = prepared.storyboard
      ? await optionalImage(calls, prepared.storyboard.blob, `${stem}.storyboard.${extensionOf(prepared.storyboard.blob)}`, stageProgress.storyboard, signal)
      : null;
    checkAbort(signal);

    const hex = await hashOf(blob);
    const bitrate = prepared.durationMs > 0 ? (blob.size * 8) / (prepared.durationMs / 1000) : 0;
    const prefix = preloadPrefixAfter(moov, blob.size, bitrate);
    const declaration: VideoUploadDeclaration = {
      fileName,
      contentType: "video/mp4",
      size: BigInt(blob.size),
      sha256: hex ? hexToBytes(hex) : null,
      width: prepared.width,
      height: prepared.height,
      durationMs: prepared.durationMs,
      hasAudio: prepared.hasAudio,
      codec: prepared.codecString,
      thumbHash: prepared.poster?.thumbHash ?? null,
      posterFileId: poster?.fileId ?? null,
      storyboardFileId: storyboard?.fileId ?? null,
      storyboard: storyboard && prepared.storyboard ? prepared.storyboard.storyboard : null,
      preloadPrefixSize: prefix > 0 ? BigInt(prefix) : null,
    };
    checkAbort(signal);

    let result = await calls.prepareVideo(declaration);
    checkAbort(signal);
    const extras = declaration.posterFileId !== null || declaration.storyboardFileId !== null || declaration.thumbHash !== null;
    if (result.isFailedVideoUpload() && result.error === VideoUploadError.POSTER_REJECTED && extras) {
      logger.warn("The poster or storyboard was refused; declaring the video without them");
      result = await calls.prepareVideo({ ...declaration, thumbHash: null, posterFileId: null, storyboardFileId: null, storyboard: null });
      checkAbort(signal);
    }
    if (result.isVideoStored()) {
      transport = "stored";
      stageProgress.video(1);
      recordUpload(transport, performance.now() - startedAt);
      return result.info;
    }
    if (result.isFailedVideoUpload()) throw new VideoUploadFailure(result.error);
    if (!result.isVideoUploadRequired()) throw new VideoUploadFailure(VideoUploadError.INTERNAL_ERROR, "PrepareVideoUpload gave no ticket");

    ticket = result.ticket;
    const progress = (sent: number, total: number) => stageProgress.video(total > 0 ? sent / total : 1);
    let parts: UploadedPart[] = [];
    if (ticket.partUrls.length === 0) {
      transport = "single";
      await uploadVideoSingle(blob, ticket, { onProgress: progress, signal, retries: options.retries, backoffMs: options.backoffMs });
    } else {
      transport = "multipart";
      parts = await uploadVideoParts(blob, ticket, {
        onProgress: progress,
        signal,
        parallel: options.parallel,
        retries: options.retries,
        put: options.put,
        backoffMs: options.backoffMs,
      });
    }
    checkAbort(signal);

    result = await calls.completeVideo(ticket.ticketId, parts);
    if (result.isVideoStored()) {
      recordUpload(transport, performance.now() - startedAt);
      return result.info;
    }
    if (result.isFailedVideoUpload()) throw new VideoUploadFailure(result.error);
    throw new VideoUploadFailure(VideoUploadError.INTERNAL_ERROR, "CompleteVideoUpload did not store the video");
  } catch (e) {
    const failure = toFailure(e, signal);
    if (ticket && calls) {
      const ticketId = ticket.ticketId;
      calls.abortVideo(ticketId).catch((err) => logger.debug("AbortVideoUpload failed", err));
    }
    recordUpload(transport, performance.now() - startedAt, videoUploadFailureName(failure.code));
    throw failure;
  }
}
