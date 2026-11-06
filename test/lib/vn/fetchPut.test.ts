/**
 * Uploads where there is no XMLHttpRequest (vue-native today): the same PUTs over fetch, with the
 * same errors, and progress that is 0 until the storage answers and then all of it.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { SuccessUploadFile, type VideoUploadTicket } from "@argon/glue";
import { uploadFile, UploadHttpError } from "@/lib/uploadFile";
import { uploadVideoParts } from "@/lib/video/multipartUpload";
import { VideoPartUploadError } from "@/lib/video/errors";

type Answer = { status: number; etag?: string; text?: string } | "network" | "hang";

let calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
let answer: (url: string) => Answer = () => ({ status: 200 });

beforeEach(() => {
  calls = [];
  answer = () => ({ status: 200 });
  vi.stubGlobal("XMLHttpRequest", undefined);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit & { headers?: Record<string, string> }) => {
    calls.push({ url, method: String(init.method), headers: { ...init.headers }, body: await (init.body as Blob).text() });
    const a = answer(url);
    if (a === "network") throw new TypeError("Failed to fetch");
    if (a === "hang")
      return new Promise((_, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener("abort", abort);
      });
    const headers = new Headers(a.etag ? { ETag: a.etag } : {});
    return new Response(a.text ?? "", { status: a.status, headers });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const begin = () =>
  new SuccessUploadFile("blob-1", "https://store/put", [{ key: "Content-Type", value: "image/png" }] as never, 3600);

describe("uploadFile without XMLHttpRequest", () => {
  test("PUTs the bytes with the form fields as headers; progress is 0, then 1", async () => {
    const progress: number[] = [];
    const result = await uploadFile(begin(), new Blob(["hello"]), "Avatar", { onProgress: (p) => progress.push(p) });

    expect(result).toEqual({ blobId: "blob-1" });
    expect(calls).toEqual([
      { url: "https://store/put", method: "PUT", headers: { "Content-Type": "image/png" }, body: "hello" },
    ]);
    expect(progress).toEqual([0, 1]);
  });

  test("a refusal is an UploadHttpError with the storage's answer", async () => {
    answer = () => ({ status: 403, text: "SignatureDoesNotMatch" });
    const failure = await uploadFile(begin(), new Blob(["x"])).catch((e) => e);
    expect(failure).toBeInstanceOf(UploadHttpError);
    expect(failure.status).toBe(403);
    expect(failure.message).toBe("Upload failed (403): SignatureDoesNotMatch");
  });

  test("no answer, an abort and a timeout read as they do over XHR", async () => {
    answer = () => "network";
    await expect(uploadFile(begin(), new Blob(["x"]))).rejects.toThrow("Upload network error");

    answer = () => "hang";
    const controller = new AbortController();
    const aborted = uploadFile(begin(), new Blob(["x"]), "Upload", { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toThrow("Upload aborted");

    await expect(uploadFile(begin(), new Blob(["x"]), "Upload", { timeout: 20 })).rejects.toThrow("Upload timed out");
  });
});

describe("uploadVideoParts without XMLHttpRequest", () => {
  const ticket = (count: number): VideoUploadTicket => ({
    ticketId: "t-1",
    fileId: "f-1",
    uploadUrl: null,
    formFields: [],
    partUrls: Array.from({ length: count }, (_, i) => `https://store/part/${i + 1}`),
    partSize: BigInt(4),
    ttlSeconds: 3600,
  });

  test("the parts go over fetch, their ETags read off the answers", async () => {
    answer = (url) => ({ status: 200, etag: `"etag-${url.split("/").at(-1)}"` });
    const sent: number[] = [];
    const parts = await uploadVideoParts(new Blob(["abcdefghij"]), ticket(3), { onProgress: (bytes) => sent.push(bytes) });

    expect(parts).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
    ]);
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      ["https://store/part/1", "abcd"],
      ["https://store/part/2", "efgh"],
      ["https://store/part/3", "ij"],
    ]);
    expect(sent.at(-1)).toBe(10);
  });

  test("a dropped part is a network failure, retried like one", async () => {
    let first = true;
    answer = () => {
      if (first) {
        first = false;
        return "network";
      }
      return { status: 200, etag: '"e"' };
    };
    const parts = await uploadVideoParts(new Blob(["abcd"]), ticket(1), { backoffMs: () => 0 });
    expect(parts).toEqual([{ partNumber: 1, etag: "e" }]);
    expect(calls).toHaveLength(2);
  });

  test("a cancel is `aborted`", async () => {
    answer = () => "hang";
    const controller = new AbortController();
    const upload = uploadVideoParts(new Blob(["abcd"]), ticket(1), { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    const failure = await upload.catch((e) => e);
    expect(failure).toBeInstanceOf(VideoPartUploadError);
    expect(failure.code).toBe("aborted");
  });
});
