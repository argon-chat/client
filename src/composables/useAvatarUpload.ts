import { ref, computed } from "vue";
import { uploadFile } from "@/lib/uploadFile";
import type { IUploadFileResult } from "@argon/glue";

export type AvatarUploadStatus =
  | "idle"
  | "uploading"
  | "processing"
  | "done"
  | "error";

export function useAvatarUpload() {
  const status = ref<AvatarUploadStatus>("idle");
  const progress = ref(0);
  const errorMessage = ref<string | null>(null);

  const isUploading = computed(
    () => status.value === "uploading" || status.value === "processing",
  );

  function reset() {
    status.value = "idle";
    progress.value = 0;
    errorMessage.value = null;
  }

  /**
   * Full upload flow: begin → PUT (with progress) → complete
   *
   * @param beginFn - Calls BeginUpload* API and returns the result
   * @param completeFn - Calls CompleteUpload* API with the blobId
   * @param data - Image data (dataURL, Blob, or File)
   */
  async function upload(
    beginFn: () => Promise<IUploadFileResult>,
    completeFn: (blobId: string) => Promise<void>,
    data: string | Blob | File,
  ): Promise<boolean> {
    reset();
    status.value = "uploading";
    progress.value = 0;

    try {
      // Step 1: Begin upload (0 → 5%)
      const begin = await beginFn();
      progress.value = 5;

      // Step 2: PUT file with real progress (5 → 90%)
      const { blobId } = await uploadFile(begin, data, "Avatar", {
        onProgress: (p) => {
          progress.value = 5 + Math.round(p * 85);
        },
      });

      // Step 3: Complete upload (90 → 100%)
      progress.value = 90;
      status.value = "processing";
      await completeFn(blobId);

      progress.value = 100;
      status.value = "done";
      return true;
    } catch (e: any) {
      status.value = "error";
      errorMessage.value = e?.message ?? "Upload failed";
      return false;
    }
  }

  return {
    status,
    progress,
    errorMessage,
    isUploading,
    reset,
    upload,
  };
}
