import { UploadFileError, type IUploadFileResult } from "@argon/glue";

export interface UploadResult {
  blobId: string;
}

export interface UploadFileOptions {
  /** Called with upload progress (0–1) during PUT */
  onProgress?: (progress: number) => void;
}

/**
 * Performs the full file upload flow:
 * 1. Validates the BeginUpload result
 * 2. PUTs the raw binary body to the presigned uploadUrl (with progress tracking)
 * 3. Returns the blobId for CompleteUpload
 *
 * @param begin - The result from any BeginUpload*() call
 * @param data - The file data (dataURL string, Blob, or File)
 * @param context - Human-readable context for error messages (e.g. "Avatar", "SpaceHeader")
 * @param options - Optional callbacks (onProgress)
 */
export async function uploadFile(
  begin: IUploadFileResult,
  data: string | Blob | File,
  context = "Upload",
  options?: UploadFileOptions,
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

  await xhrPut(uploadUrl, blob, headers, options?.onProgress);

  return { blobId };
}

function xhrPut(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);

    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    xhr.send(body);
  });
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
