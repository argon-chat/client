import { ref, computed, getCurrentScope, onScopeDispose } from "vue";
import { logger } from "@argon/core";
import { metrics, errorKind } from "@/lib/telemetry/metrics";
import {
  AttachExistingFileError,
  EntityType,
  MessageEntityAttachment,
  PrepareUploadError,
  SuccessUploadFile,
  type AttachmentInfo,
  type IAttachExistingFileResult,
  type IMessageEntity,
  type IPrepareUploadResult,
  type IUploadFileResult,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { uploadFile } from "@/lib/uploadFile";
import { rgbaToThumbHash } from "thumbhash";
import type { Guid } from "@argon-chat/ion.webcore";
import { sha256Hex } from "@/lib/attachments/hash";
import { findUpload, forgetUpload, rememberUpload } from "@/lib/attachments/uploadPool";
import type { AttachmentRef } from "@/lib/attachments/clipboard";
import { cdnFetchUrl } from "@/store/system/fileStorage";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const MAX_ATTACHMENTS = 10;
const THUMBHASH_MAX_DIM = 100;

export type AttachmentStatus = "pending" | "uploading" | "done" | "error";

/** Where the files go: a channel of a space, or the direct chat with one person. */
export type UploadTarget =
  | { kind: "channel"; spaceId: Guid; channelId: Guid }
  | { kind: "dm"; peerId: Guid };

/** How a pending attachment came to point at a file the server already has; "server" is the server finding one by the hash. */
export type LinkOrigin = "pool" | "clipboard" | "drag" | "server";

export interface AttachmentLink {
  fileId: Guid;
  /** The name the copy is given; null keeps the original's. */
  fileName: string | null;
  origin: LinkOrigin;
}

export interface PendingAttachment {
  file: File;
  previewUrl: string | null;
  thumbHash: string | null;
  width: number | null;
  height: number | null;
  progress: number;
  status: AttachmentStatus;
  error?: string;
  result?: AttachmentInfo;
  /** The bytes' hash when they were small enough to take one; the key into the upload pool. */
  sha256?: string | null;
  /** A file already on the server that these bytes are: sent as a copy of it, uploaded only when that is refused. */
  link?: AttachmentLink | null;
}

export function useAttachmentUpload() {
  const api = useApi();
  const pendingFiles = ref<PendingAttachment[]>([]);

  const hasFiles = computed(() => pendingFiles.value.length > 0);
  const isUploading = computed(() =>
    pendingFiles.value.some((f) => f.status === "uploading"),
  );

  function validateFile(file: File): string | null {
    if (pendingFiles.value.length >= MAX_ATTACHMENTS) {
      return `Maximum ${MAX_ATTACHMENTS} attachments allowed`;
    }
    return null;
  }

  function isImageType(contentType: string): boolean {
    return contentType.startsWith("image/");
  }

  function isVideoType(contentType: string): boolean {
    return contentType.startsWith("video/");
  }

  async function getVideoDimensions(
    file: File,
  ): Promise<{ width: number; height: number; previewUrl: string }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadeddata = () => {
        video.currentTime = 0.1;
      };
      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            const previewUrl = URL.createObjectURL(blob);
            resolve({ width: video.videoWidth, height: video.videoHeight, previewUrl });
          } else {
            reject(new Error("Failed to generate video thumbnail"));
          }
        }, "image/jpeg", 0.8);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load video"));
      };
      video.src = url;
    });
  }

  async function getImageDimensions(
    file: File,
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        reject(new Error("Failed to load image"));
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }

  async function generateThumbHash(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = url;
      });

      // Scale down to ≤100×100 preserving aspect ratio
      const scale = Math.min(
        THUMBHASH_MAX_DIM / img.naturalWidth,
        THUMBHASH_MAX_DIM / img.naturalHeight,
        1,
      );
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);

      const pixels = ctx.getImageData(0, 0, w, h);
      const hash = rgbaToThumbHash(w, h, pixels.data);
      return btoa(String.fromCharCode(...hash));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** The preview, dimensions and placeholder of an entry; what a reference already knows is kept. */
  async function describe(entry: PendingAttachment, need = { dimensions: true, thumbHash: true }) {
    const file = entry.file;
    if (isImageType(file.type)) {
      entry.previewUrl = URL.createObjectURL(file);
      try {
        if (need.dimensions) {
          const dims = await getImageDimensions(file);
          entry.width = dims.width;
          entry.height = dims.height;
        }
        if (need.thumbHash) entry.thumbHash = await generateThumbHash(file);
      } catch (e) {
        logger.warn("Failed to process image metadata:", e);
      }
    } else if (isVideoType(file.type)) {
      try {
        const videoInfo = await getVideoDimensions(file);
        entry.previewUrl = videoInfo.previewUrl;
        if (need.dimensions) {
          entry.width = videoInfo.width;
          entry.height = videoInfo.height;
        }
      } catch (e) {
        logger.warn("Failed to process video metadata:", e);
      }
    }
  }

  async function hashOf(file: File): Promise<string | null> {
    try {
      return await sha256Hex(file);
    } catch (e) {
      logger.debug("hashing skipped", e);
      return null;
    }
  }

  async function addFiles(files: FileList | File[]): Promise<string[]> {
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      const err = validateFile(file);
      if (err) {
        errors.push(err);
        continue;
      }

      const entry: PendingAttachment = {
        file,
        previewUrl: null,
        thumbHash: null,
        width: null,
        height: null,
        progress: 0,
        status: "pending",
        sha256: null,
        link: null,
      };

      await describe(entry);

      // Bytes this account has sent before go out as a copy of that upload, not as bytes again.
      entry.sha256 = await hashOf(file);
      if (entry.sha256) {
        const known = await findUpload(entry.sha256);
        if (known) entry.link = { fileId: known.fileId, fileName: file.name, origin: "pool" };
      }

      pendingFiles.value.push(entry);
    }

    return errors;
  }

  /**
   * Files the server already has, arriving as references — a paste of something copied out of a
   * chat, a drag from one channel into another. A paste of one picture brings its bitmap along, and
   * that is the preview; anything else is fetched from the store, so the entry is a file like any
   * other and an upload is still possible should the copy be refused.
   */
  async function addReferences(
    refs: AttachmentRef[],
    bytes: FileList | File[] | null | undefined,
    origin: LinkOrigin,
  ): Promise<string[]> {
    const errors: string[] = [];
    const carried = bytes ? Array.from(bytes) : [];

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const local = carried.length === refs.length ? carried[i] : null;
      const file = local ? renamed(local, ref) : await fetchAsFile(ref.fileId, ref.fileName, ref.contentType);

      if (!file) {
        errors.push(`Could not read ${ref.fileName ?? ref.fileId}`);
        continue;
      }

      const err = validateFile(file);
      if (err) {
        errors.push(err);
        continue;
      }

      const entry: PendingAttachment = {
        file,
        previewUrl: null,
        thumbHash: ref.thumbHash,
        width: ref.width,
        height: ref.height,
        progress: 0,
        status: "pending",
        sha256: null,
        link: { fileId: ref.fileId, fileName: ref.fileName, origin },
      };

      await describe(entry, { dimensions: ref.width == null || ref.height == null, thumbHash: !ref.thumbHash });

      pendingFiles.value.push(entry);
    }

    return errors;
  }

  function renamed(local: File, ref: AttachmentRef): File {
    const name = ref.fileName ?? local.name;
    return name === local.name ? local : new File([local], name, { type: local.type || ref.contentType || "application/octet-stream" });
  }

  async function fetchAsFile(fileId: Guid, fileName: string | null, contentType: string | null): Promise<File | null> {
    try {
      const resp = await fetch(cdnFetchUrl(fileId));
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return new File([blob], fileName ?? "file", { type: contentType || blob.type || "application/octet-stream" });
    } catch (e) {
      logger.warn("Could not fetch a referenced file:", e);
      return null;
    }
  }

  function removeFile(index: number) {
    const entry = pendingFiles.value[index];
    if (entry?.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
    }
    pendingFiles.value.splice(index, 1);
  }

  /** A copy of the linked file in the target, or null when the server would rather have the bytes. */
  async function attachExisting(entry: PendingAttachment, target: UploadTarget): Promise<AttachmentInfo | null> {
    const link = entry.link!;
    const name = link.fileName ?? entry.file.name ?? null;

    try {
      const result: IAttachExistingFileResult = target.kind === "dm"
        ? await api.userChatInteractions.AttachExistingFile(target.peerId, link.fileId, name)
        : await api.channelInteraction.AttachExistingFile(target.spaceId, target.channelId, link.fileId, name);

      if (result.isSuccessAttachExistingFile()) return result.info;

      if (result.isFailedAttachExistingFile()) {
        logger.info("Attaching an existing file was refused:", result.error);
        // A pooled file the server no longer has is not offered again.
        if (result.error === AttachExistingFileError.SOURCE_NOT_FOUND && link.origin === "pool" && entry.sha256)
          await forgetUpload(entry.sha256);
      }
      return null;
    } catch (e) {
      // An older server has no such method; the bytes go the long way.
      logger.warn("Attaching an existing file failed:", e);
      return null;
    }
  }

  async function remember(entry: PendingAttachment) {
    if (!entry.sha256 || !entry.result) return;
    try {
      await rememberUpload({
        sha256: entry.sha256,
        fileId: entry.result.fileId,
        fileName: entry.result.fileName,
        fileSize: Number(entry.result.fileSize),
        contentType: entry.result.contentType,
        width: entry.width,
        height: entry.height,
        thumbHash: entry.thumbHash,
      });
    } catch (e) {
      logger.debug("upload pool write skipped", e);
    }
  }

  async function uploadSingleFile(
    entry: PendingAttachment,
    target: UploadTarget,
  ): Promise<void> {
    entry.status = "uploading";
    entry.progress = 0;

    const kind = isImageType(entry.file.type) ? "image" : isVideoType(entry.file.type) ? "video" : "other";

    if (entry.link) {
      const linked = await attachExisting(entry, target);
      if (linked) {
        entry.result = linked;
        entry.progress = 100;
        entry.status = "done";
        metrics.count("attachment.dedup", { kind, source: entry.link.origin, result: "linked" });
        await remember(entry);
        return;
      }

      metrics.count("attachment.dedup", { kind, source: entry.link.origin, result: "fallback" });

      // A pasted bitmap is a re-encoding of the original; the store still has the original itself.
      if (entry.link.origin !== "pool") {
        const original = await fetchAsFile(entry.link.fileId, entry.link.fileName ?? entry.file.name, null);
        if (original) entry.file = original;
      }
    }

    const uploadTimer = metrics.startTimer("attachment.upload.duration", { kind });
    metrics.distribution("attachment.bytes", entry.file.size, "byte", { kind });

    try {
      // Step 1: describe the bytes and ask for a ticket. A server that already holds them where this
      // account can see answers with a copy instead, and the bytes never leave the device.
      const begin = await beginUpload(entry, target);

      if (begin.existing) {
        entry.result = begin.existing;
        entry.progress = 100;
        entry.status = "done";
        uploadTimer.end({ result: "ok" });
        metrics.count("attachment.dedup", { kind, source: "server", result: "linked" });
        await remember(entry);
        return;
      }

      entry.progress = 20;

      // Step 2: Upload file via PUT
      const { blobId } = await uploadFile(begin.ticket, entry.file, "Attachment");

      entry.progress = 80;

      // Step 3: Complete upload
      const info = target.kind === "dm"
        ? await api.userChatInteractions.CompleteUploadAttachment(target.peerId, blobId)
        : await api.channelInteraction.CompleteUploadAttachment(target.spaceId, target.channelId, blobId);

      entry.result = info;
      entry.progress = 100;
      entry.status = "done";
      uploadTimer.end({ result: "ok" });
      metrics.count("attachment.upload", { kind, result: "ok" });
      await remember(entry);
    } catch (e: any) {
      entry.status = "error";
      entry.error = e?.message ?? "Upload failed";
      logger.error("Attachment upload failed:", e);
      uploadTimer.end({ result: "failed", error: errorKind(e) });
      metrics.count("attachment.upload", { kind, result: "failed", error: errorKind(e) });
    }
  }

  /**
   * The ticket for an upload, or the copy the server made instead. With a hash in hand the server is
   * told what is coming (PrepareUploadAttachment); without one, or against a server that predates it,
   * the plain BeginUploadAttachment is what it always was.
   */
  async function beginUpload(
    entry: PendingAttachment,
    target: UploadTarget,
  ): Promise<{ ticket: IUploadFileResult; existing?: undefined } | { ticket?: undefined; existing: AttachmentInfo }> {
    if (entry.sha256) {
      let prepared: IPrepareUploadResult | null = null;
      try {
        const sha = hexToBytes(entry.sha256);
        const size = BigInt(entry.file.size);
        const type = entry.file.type || "application/octet-stream";
        prepared = target.kind === "dm"
          ? await api.userChatInteractions.PrepareUploadAttachment(target.peerId, sha, size, type, entry.file.name)
          : await api.channelInteraction.PrepareUploadAttachment(target.spaceId, target.channelId, sha, size, type, entry.file.name);
      } catch (e) {
        logger.warn("PrepareUploadAttachment failed; falling back to BeginUploadAttachment:", e);
      }

      if (prepared?.isAlreadyStored()) return { existing: prepared.info };
      if (prepared?.isUploadRequired())
        return { ticket: new SuccessUploadFile(prepared.blobId, prepared.uploadUrl, prepared.formFields, prepared.ttlSeconds) };
      if (prepared?.isFailedPrepareUpload())
        throw new Error(PrepareUploadError[prepared.error] ?? "PrepareUploadAttachment failed");
    }

    const begin = target.kind === "dm"
      ? await api.userChatInteractions.BeginUploadAttachment(target.peerId)
      : await api.channelInteraction.BeginUploadAttachment(target.spaceId, target.channelId);

    return { ticket: begin };
  }

  function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function entityOf(entry: PendingAttachment, result: AttachmentInfo): MessageEntityAttachment {
    return new MessageEntityAttachment(
      EntityType.Attachment,
      0,
      0,
      1,
      result.fileId,
      result.fileName,
      result.fileSize,
      result.contentType,
      entry.width,
      entry.height,
      entry.thumbHash,
      null,
    );
  }

  async function uploadAll(target: UploadTarget): Promise<IMessageEntity[]> {
    const pending = pendingFiles.value.filter((f) => f.status !== "done");

    await Promise.all(
      pending.map((entry) => uploadSingleFile(entry, target)),
    );

    const entities: IMessageEntity[] = [];
    for (const entry of pendingFiles.value) {
      if (entry.status !== "done" || !entry.result) continue;
      entities.push(entityOf(entry, entry.result));
    }

    return entities;
  }

  function clear() {
    for (const entry of pendingFiles.value) {
      if (entry.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    }
    pendingFiles.value = [];
  }

  // Files staged in a composer that unmounts (channel switch, space closed) used to stay pinned by
  // their object URLs with nothing left to revoke them — up to ten 8 MB blobs per abandoned draft.
  // A send in flight is unaffected: detach() has already moved its entries out of pendingFiles.
  if (getCurrentScope()) onScopeDispose(() => clear());

  function hasErrors(): boolean {
    return pendingFiles.value.some((f) => f.status === "error");
  }

  function buildOptimisticEntities(): IMessageEntity[] {
    const PLACEHOLDER_FILE_ID = "00000000-0000-0000-0000-000000000000";
    return pendingFiles.value.map(
      (entry) =>
        new MessageEntityAttachment(
          EntityType.Attachment,
          0,
          0,
          1,
          PLACEHOLDER_FILE_ID,
          entry.file.name,
          BigInt(entry.file.size),
          entry.file.type || "application/octet-stream",
          entry.width,
          entry.height,
          entry.thumbHash,
          null,
        ),
    );
  }

  /**
   * Detach current pending files from the composable for background upload.
   * Returns a standalone uploader that owns the snapshot.
   * The composable is cleared immediately so new files can be added.
   */
  function detach() {
    const snapshot = [...pendingFiles.value];
    // Clear composable without revoking previewUrls (snapshot still needs them)
    pendingFiles.value = [];

    return {
      files: snapshot,
      hasFiles: snapshot.length > 0,
      async uploadAll(target: UploadTarget): Promise<IMessageEntity[]> {
        const pending = snapshot.filter((f) => f.status !== "done");
        await Promise.all(
          pending.map((entry) => uploadSingleFile(entry, target)),
        );

        const entities: IMessageEntity[] = [];
        for (const entry of snapshot) {
          if (entry.status !== "done" || !entry.result) continue;
          entities.push(entityOf(entry, entry.result));
        }
        return entities;
      },
      hasErrors(): boolean {
        return snapshot.some((f) => f.status === "error");
      },
      cleanup() {
        for (const entry of snapshot) {
          if (entry.previewUrl) {
            URL.revokeObjectURL(entry.previewUrl);
          }
        }
      },
    };
  }

  return {
    pendingFiles,
    hasFiles,
    isUploading,
    addFiles,
    addReferences,
    removeFile,
    uploadAll,
    clear,
    hasErrors,
    buildOptimisticEntities,
    detach,
  };
}
