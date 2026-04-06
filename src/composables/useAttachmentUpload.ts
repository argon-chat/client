import { ref, computed } from "vue";
import { logger } from "@argon/core";
import {
  EntityType,
  MessageEntityAttachment,
  UploadFileError,
  type AttachmentInfo,
  type IMessageEntity,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { rgbaToThumbHash } from "thumbhash";
import type { Guid } from "@argon-chat/ion.webcore";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const MAX_ATTACHMENTS = 10;
const THUMBHASH_MAX_DIM = 100;

export type AttachmentStatus = "pending" | "uploading" | "done" | "error";

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
}

export function useAttachmentUpload() {
  const api = useApi();
  const pendingFiles = ref<PendingAttachment[]>([]);

  const hasFiles = computed(() => pendingFiles.value.length > 0);
  const isUploading = computed(() =>
    pendingFiles.value.some((f) => f.status === "uploading"),
  );

  function validateFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" exceeds 8 MB limit`;
    }
    if (pendingFiles.value.length >= MAX_ATTACHMENTS) {
      return `Maximum ${MAX_ATTACHMENTS} attachments allowed`;
    }
    return null;
  }

  function isImageType(contentType: string): boolean {
    return contentType.startsWith("image/");
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
      };

      if (isImageType(file.type)) {
        entry.previewUrl = URL.createObjectURL(file);
        try {
          const dims = await getImageDimensions(file);
          entry.width = dims.width;
          entry.height = dims.height;
          entry.thumbHash = await generateThumbHash(file);
        } catch (e) {
          logger.warn("Failed to process image metadata:", e);
        }
      }

      pendingFiles.value.push(entry);
    }

    return errors;
  }

  function removeFile(index: number) {
    const entry = pendingFiles.value[index];
    if (entry?.previewUrl) {
      URL.revokeObjectURL(entry.previewUrl);
    }
    pendingFiles.value.splice(index, 1);
  }

  async function uploadSingleFile(
    entry: PendingAttachment,
    spaceId: Guid,
    channelId: Guid,
  ): Promise<void> {
    entry.status = "uploading";
    entry.progress = 0;

    try {
      // Step 1: Begin upload
      const begin = await api.channelInteraction.BeginUploadAttachment(
        spaceId,
        channelId,
      );

      if (begin.isFailedUploadFile()) {
        throw new Error(
          UploadFileError[begin.error] ?? "BeginUploadAttachment failed",
        );
      }
      if (!begin.isSuccessUploadFile()) {
        throw new Error("Unexpected upload state");
      }

      const blobId = begin.blobId;
      if (!blobId)
        throw new Error("No blobId returned from BeginUploadAttachment");

      entry.progress = 20;

      // Step 2: Upload file to KineticaFS
      const formData = new FormData();
      formData.append("file", entry.file);

      const response = await fetch(
        `https://koko.argon.gl/api/v1/upload/${blobId}`,
        {
          method: "PATCH",
          body: formData,
          headers: {
            "X-Api-Token":
              "f2f3be8c3ddf5017c019248fef849bc240e7b4a25ecb662251d8a4ca7ac6fe58",
          },
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Upload failed (${response.status}): ${errText}`);
      }

      entry.progress = 80;

      // Step 3: Complete upload
      const info = await api.channelInteraction.CompleteUploadAttachment(
        spaceId,
        channelId,
        blobId,
      );

      entry.result = info;
      entry.progress = 100;
      entry.status = "done";
    } catch (e: any) {
      entry.status = "error";
      entry.error = e?.message ?? "Upload failed";
      logger.error("Attachment upload failed:", e);
    }
  }

  async function uploadAll(
    spaceId: Guid,
    channelId: Guid,
  ): Promise<IMessageEntity[]> {
    const pending = pendingFiles.value.filter((f) => f.status !== "done");

    await Promise.all(
      pending.map((entry) => uploadSingleFile(entry, spaceId, channelId)),
    );

    const entities: IMessageEntity[] = [];
    for (const entry of pendingFiles.value) {
      if (entry.status !== "done" || !entry.result) continue;

      entities.push(
        new MessageEntityAttachment(
          EntityType.Attachment,
          0,
          0,
          1,
          entry.result.fileId,
          entry.result.fileName,
          entry.result.fileSize,
          entry.result.contentType,
          entry.width,
          entry.height,
          entry.thumbHash,
        ),
      );
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
        ),
    );
  }

  return {
    pendingFiles,
    hasFiles,
    isUploading,
    addFiles,
    removeFile,
    uploadAll,
    clear,
    hasErrors,
    buildOptimisticEntities,
  };
}
