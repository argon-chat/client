import { UploadFileError, type IUploadFileResult } from "@argon/glue";

export interface UploadResult {
  blobId: string;
}

/**
 * Performs the full file upload flow:
 * 1. Validates the BeginUpload result
 * 2. PUTs the raw binary body to the presigned uploadUrl
 * 3. Returns the blobId for CompleteUpload
 *
 * @param begin - The result from any BeginUpload*() call
 * @param data - The file data (dataURL string, Blob, or File)
 * @param context - Human-readable context for error messages (e.g. "Avatar", "SpaceHeader")
 */
export async function uploadFile(
  begin: IUploadFileResult,
  data: string | Blob | File,
  context = "Upload",
): Promise<UploadResult> {
  if (begin.isFailedUploadFile()) {
    throw new Error(
      UploadFileError[begin.error] ?? `Begin${context} failed`,
    );
  }
  if (!begin.isSuccessUploadFile()) {
    throw new Error(`Unexpected upload state for ${context}`);
  }

  const { blobId, uploadUrl, formFields } = begin;
  if (!blobId) throw new Error(`No blobId returned from Begin${context}`);
  if (!uploadUrl) throw new Error(`No uploadUrl returned from Begin${context}`);

  // Resolve data to a Blob
  let blob: Blob;
  if (typeof data === "string") {
    blob = dataURLtoBlob(data);
  } else {
    blob = data;
  }

  // formFields contains HTTP headers for the PUT request (e.g. Content-Type)
  const headers: Record<string, string> = {};
  if (formFields) {
    for (const field of formFields) {
      headers[field.key] = field.value;
    }
  }

  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: blob,
    headers,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${context} upload failed (${response.status}): ${errText}`);
  }

  return { blobId };
}

function dataURLtoBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch) throw new Error("Cannot detect MIME-type from data URL");

  const mime = mimeMatch[1];
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }

  return new Blob([u8arr], { type: mime });
}
