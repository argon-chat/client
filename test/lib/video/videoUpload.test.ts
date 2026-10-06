/**
 * Uploading a prepared video: poster and storyboard first as attachments of the same target, then
 * the declaration, then the bytes as one PUT or as parts, then the completion. A refusal, a failed
 * transfer or a cancel gives the ticket back and rejects with a typed code.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  AlreadyStored,
  FailedVideoUpload,
  UploadRequired,
  VideoStored,
  VideoUploadError,
  VideoUploadRequired,
  type AttachmentInfo,
  type VideoInfo,
  type VideoUploadDeclaration,
  type VideoUploadTicket,
} from "@argon/glue";

const { uploadFile, count, distribution } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  count: vi.fn(),
  distribution: vi.fn(),
}));

vi.mock("@/lib/uploadFile", () => ({ uploadFile }));
vi.mock("@/lib/telemetry/metrics", () => {
  const metrics = { count, distribution, gauge: vi.fn() };
  return { metrics, default: metrics };
});

import { uploadVideo, mp4FileName, type VideoUploadApi, type VideoUploadInput } from "@/lib/video/videoUpload";
import type { PartPut } from "@/lib/video/multipartUpload";
import { VideoUploadFailure } from "@/lib/video/uploadErrors";
import { VideoPartUploadError } from "@/lib/video/errors";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, size: number) => [...be32(size), ...ascii(type), ...new Array(size - 8).fill(7)];

/** 32 + 200 + 1032 = 1264 bytes of a fast-start MP4's box structure. */
const MP4 = new Uint8Array([...box("ftyp", 32), ...box("moov", 200), ...box("mdat", 1032)]);

const SPACE = "space-1";
const CHANNEL = "channel-1";

function info(over: Partial<VideoInfo> = {}): VideoInfo {
  return {
    fileId: "video-file",
    fileName: "clip.mp4",
    fileSize: BigInt(MP4.length),
    contentType: "video/mp4",
    width: 1280,
    height: 720,
    durationMs: 10_000,
    hasAudio: true,
    codec: "avc1.64001f",
    thumbHash: "hash",
    posterFileId: "poster-file",
    storyboardFileId: "board-file",
    storyboard: null,
    preloadPrefixSize: null,
    downloadUrl: "https://cdn/video",
    posterUrl: null,
    storyboardUrl: null,
    ...over,
  };
}

function ticket(over: Partial<VideoUploadTicket> = {}): VideoUploadTicket {
  return {
    ticketId: "ticket-1",
    fileId: "video-file",
    uploadUrl: "https://store/single",
    formFields: [{ key: "Content-Type", value: "video/mp4" }],
    partUrls: [],
    partSize: 0n,
    ttlSeconds: 3600,
    ...over,
  };
}

const attachment = (fileId: string, fileName: string): AttachmentInfo => ({ fileId, fileName, fileSize: 1n, contentType: "image/webp", downloadUrl: null });

function input(over: Partial<VideoUploadInput> = {}): VideoUploadInput {
  return {
    blob: new Blob([MP4], { type: "video/mp4" }),
    width: 1280,
    height: 720,
    durationMs: 10_000,
    hasAudio: true,
    codecString: "avc1.64001f",
    mode: "transcode",
    fileName: "clip.mov",
    poster: { blob: new Blob(["poster"], { type: "image/webp" }), width: 720, height: 404, thumbHash: "hash" },
    storyboard: {
      blob: new Blob(["board"], { type: "image/webp" }),
      storyboard: { frameWidth: 160, frameHeight: 90, columns: 10, frameCount: 10, intervalMs: 1000 },
    },
    ...over,
  };
}

/** One fake service: attachments go through PrepareUploadAttachment → UploadRequired, ids per file name. */
function service() {
  return {
    PrepareUploadAttachment: vi.fn(async (...args: unknown[]) => new UploadRequired(`blob:${String(args.at(-1))}`, "https://store/img", [], 60) as never),
    BeginUploadAttachment: vi.fn(),
    CompleteUploadAttachment: vi.fn(async (...args: unknown[]) => {
      const blobId = String(args.at(-1));
      return attachment(blobId.includes("poster") ? "poster-file" : "board-file", blobId);
    }),
    PrepareVideoUpload: vi.fn(async (..._args: unknown[]) => new VideoUploadRequired(ticket()) as never),
    CompleteVideoUpload: vi.fn(async (..._args: unknown[]) => new VideoStored(info()) as never),
    AbortVideoUpload: vi.fn(async (..._args: unknown[]) => {}),
  };
}

function fakeApi() {
  const channel = service();
  const dm = service();
  const api = { channelInteraction: channel, userChatInteractions: dm } as unknown as VideoUploadApi;
  return { api, channel, dm };
}

const target = { kind: "channel", spaceId: SPACE, channelId: CHANNEL } as const;
const declarationOf = (calls: unknown[][]) => calls[0].at(-1) as VideoUploadDeclaration;

beforeEach(() => {
  uploadFile.mockReset();
  uploadFile.mockImplementation(async (begin: { blobId: string }, _blob: Blob, _ctx: string, options?: { onProgress?: (f: number) => void }) => {
    options?.onProgress?.(1);
    return { blobId: begin.blobId };
  });
  count.mockReset();
  distribution.mockReset();
});

/** A multipart ticket as the server issues them now: no upload URL, no form fields, part URLs. */
const multipart = (count: number, partSize: number) =>
  new VideoUploadRequired(
    ticket({ uploadUrl: null, formFields: [], partUrls: Array.from({ length: count }, (_, i) => `https://store/p/${i + 1}`), partSize: BigInt(partSize) }),
  ) as never;

/** An MP4 whose header the server cannot reach: moov past the 64 KiB head, or ending past 32 MiB. */
function unreachable(kind: "late" | "huge"): Blob {
  if (kind === "late") return new Blob([new Uint8Array([...box("ftyp", 32), ...box("free", 70_000), ...box("moov", 200), ...box("mdat", 64)])], { type: "video/mp4" });
  const moovHeader = [...be32(33 * 1024 * 1024), ...ascii("moov")];
  return new Blob([new Uint8Array([...box("ftyp", 32), ...moovHeader, ...new Array(1024).fill(0)])], { type: "video/mp4" });
}

describe("review fixes", () => {
  test("a one-part ticket (the server's ≤ 16 MiB case) sends the whole file as part 1", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(multipart(1, 16 * 1024 * 1024));
    const bodies: number[] = [];
    const put = vi.fn<PartPut>(async (_url, body) => {
      bodies.push(body.size);
      return { status: 200, etag: '"only"' };
    });

    await uploadVideo(target, input(), { api, put });

    expect(bodies).toEqual([MP4.length]);
    expect(channel.CompleteVideoUpload).toHaveBeenCalledWith(SPACE, CHANNEL, "ticket-1", [{ partNumber: 1, etag: "only" }]);
    expect(uploadFile.mock.calls.some(([begin]) => begin.uploadUrl === "https://store/single")).toBe(false);
  });

  test("POSTER_REJECTED: declared once more without poster, storyboard and thumbHash", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(new FailedVideoUpload(VideoUploadError.POSTER_REJECTED) as never);

    const result = await uploadVideo(target, input(), { api });

    expect(result).toEqual(info());
    expect(channel.PrepareVideoUpload).toHaveBeenCalledTimes(2);
    const [first, second] = channel.PrepareVideoUpload.mock.calls.map((c) => c.at(-1) as VideoUploadDeclaration);
    expect(first).toMatchObject({ posterFileId: "poster-file", storyboardFileId: "board-file", thumbHash: "hash" });
    expect(second).toMatchObject({ posterFileId: null, storyboardFileId: null, storyboard: null, thumbHash: null, fileName: "clip.mp4" });
    expect(second.sha256).toEqual(first.sha256);
  });

  test("POSTER_REJECTED twice fails with that code", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValue(new FailedVideoUpload(VideoUploadError.POSTER_REJECTED) as never);
    await expect(uploadVideo(target, input(), { api })).rejects.toMatchObject({ code: VideoUploadError.POSTER_REJECTED });
    expect(channel.PrepareVideoUpload).toHaveBeenCalledTimes(2);
  });

  test.each(["late", "huge"] as const)("a header the server cannot reach (%s moov) fails before anything is sent", async (kind) => {
    const { api, channel } = fakeApi();
    const error = await uploadVideo(target, input({ blob: unreachable(kind) }), { api }).catch((e) => e);

    expect(error).toBeInstanceOf(VideoUploadFailure);
    expect(error.code).toBe(VideoUploadError.NOT_STREAMABLE);
    expect(channel.PrepareUploadAttachment).not.toHaveBeenCalled();
    expect(channel.PrepareVideoUpload).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "none", result: "failed", error: "NOT_STREAMABLE" });
  });

  test("a 403 on a part is forbidden, not network, and the ticket is given back", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(multipart(2, 1000));
    const put = vi.fn<PartPut>(async () => ({ status: 403, etag: null }));

    await expect(uploadVideo(target, input(), { api, put, backoffMs: () => 0 })).rejects.toMatchObject({ code: "forbidden" });
    expect(channel.AbortVideoUpload).toHaveBeenCalledWith(SPACE, CHANNEL, "ticket-1");
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "multipart", result: "failed", error: "forbidden" });
  });

  test("another 4xx on a part is a storage refusal", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(multipart(1, 5000));
    const put = vi.fn<PartPut>(async () => ({ status: 400, etag: null }));
    await expect(uploadVideo(target, input(), { api, put })).rejects.toMatchObject({ code: "storage" });
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("the single PUT of an older server: a 4xx is not retried, a 403 is forbidden", async () => {
    const { api } = fakeApi();
    const refused = Object.assign(new Error("Upload failed (403): denied"), { name: "UploadHttpError", status: 403 });
    uploadFile.mockImplementation(async (begin: { blobId: string; uploadUrl: string }, _blob: Blob, _ctx: string, options?: { onProgress?: (f: number) => void }) => {
      if (begin.uploadUrl === "https://store/single") throw refused;
      options?.onProgress?.(1);
      return { blobId: begin.blobId };
    });

    await expect(uploadVideo(target, input(), { api, retries: 3, backoffMs: () => 0 })).rejects.toMatchObject({ code: "forbidden" });
    expect(uploadFile.mock.calls.filter(([begin]) => begin.uploadUrl === "https://store/single")).toHaveLength(1);
  });

  test("the single PUT is retried after a 5xx, with a timeout, and its progress never goes back", async () => {
    const { api } = fakeApi();
    let attempts = 0;
    const timeouts: unknown[] = [];
    uploadFile.mockImplementation(
      async (begin: { blobId: string; uploadUrl: string }, _blob: Blob, _ctx: string, options?: { onProgress?: (f: number) => void; timeout?: number }) => {
        if (begin.uploadUrl === "https://store/single") {
          timeouts.push(options?.timeout);
          options?.onProgress?.(attempts === 0 ? 0.7 : 0.3);
          if (attempts++ === 0) throw Object.assign(new Error("Upload failed (502)"), { name: "UploadHttpError", status: 502 });
          options?.onProgress?.(0.9);
        }
        return { blobId: begin.blobId };
      },
    );
    const video: number[] = [];

    await uploadVideo(target, input(), { api, backoffMs: () => 0, onProgress: (stage, f) => stage === "video" && video.push(f) });

    expect(attempts).toBe(2);
    expect(timeouts.every((t) => typeof t === "number" && t >= 60_000)).toBe(true);
    for (let i = 1; i < video.length; i++) expect(video[i]).toBeGreaterThanOrEqual(video[i - 1]);
    expect(video.at(-1)).toBe(1);
    expect(video).not.toContain(0.3);
  });

  test("the video stage's progress never goes back across part retries (three in flight)", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(multipart(4, 400));
    const retried = new Set<string>();
    const put: PartPut = async (url, body, { onProgress }) => {
      onProgress?.(body.size - 1);
      await new Promise((r) => setTimeout(r, 0));
      if (!retried.has(url) && url.endsWith("2")) {
        retried.add(url);
        throw new VideoPartUploadError("network");
      }
      return { status: 200, etag: "e" };
    };
    const video: number[] = [];

    await uploadVideo(target, input(), { api, put, parallel: 3, backoffMs: () => 0, onProgress: (stage, f) => stage === "video" && video.push(f) });

    expect(retried.size).toBe(1);
    for (let i = 1; i < video.length; i++) expect(video[i]).toBeGreaterThanOrEqual(video[i - 1]);
    expect(video.at(-1)).toBe(1);
  });
});

describe("uploadVideo", () => {
  test("single PUT: poster and storyboard, the declaration, the bytes, the completion", async () => {
    const { api, channel } = fakeApi();
    const finished = new Set<string>();

    const result = await uploadVideo(target, input(), { api, onProgress: (stage, f) => f === 1 && finished.add(stage) });

    expect(result).toEqual(info());
    expect([...finished]).toEqual(["poster", "storyboard", "video"]);

    // The poster and storyboard are attachments of the same channel, named after the video.
    expect(channel.PrepareUploadAttachment.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      [SPACE, CHANNEL],
      [SPACE, CHANNEL],
    ]);
    expect(channel.PrepareUploadAttachment.mock.calls.map((c) => c.at(-1))).toEqual(["clip.poster.webp", "clip.storyboard.webp"]);

    const declaration = declarationOf(channel.PrepareVideoUpload.mock.calls);
    expect(channel.PrepareVideoUpload.mock.calls[0].slice(0, 2)).toEqual([SPACE, CHANNEL]);
    expect(declaration).toMatchObject({
      fileName: "clip.mp4",
      contentType: "video/mp4",
      size: BigInt(MP4.length),
      width: 1280,
      height: 720,
      durationMs: 10_000,
      hasAudio: true,
      codec: "avc1.64001f",
      thumbHash: "hash",
      posterFileId: "poster-file",
      storyboardFileId: "board-file",
      storyboard: { frameWidth: 160, frameHeight: 90, columns: 10, frameCount: 10, intervalMs: 1000 },
    });
    expect(declaration.sha256).toBeInstanceOf(Uint8Array);
    expect(declaration.sha256).toHaveLength(32);
    // moov ends at 232; 1.5 s at the file's ~1 kbps adds 190 bytes.
    expect(declaration.preloadPrefixSize).toBe(232n + BigInt(Math.ceil((((MP4.length * 8) / 10) * 1.5) / 8)));

    // The video bytes went through uploadFile with the ticket's URL and headers.
    const videoPut = uploadFile.mock.calls.find(([begin]) => begin.uploadUrl === "https://store/single")!;
    expect(videoPut[0]).toMatchObject({ blobId: "video-file", formFields: [{ key: "Content-Type", value: "video/mp4" }] });
    expect(videoPut[1]).toBeInstanceOf(Blob);

    expect(channel.CompleteVideoUpload).toHaveBeenCalledWith(SPACE, CHANNEL, "ticket-1", []);
    expect(channel.AbortVideoUpload).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "single", result: "ok", error: undefined });
    expect(distribution).toHaveBeenCalledWith("video.upload.duration", expect.any(Number), "millisecond", { transport: "single", result: "ok" });
  });

  test("multipart: the parts' ETags go back in order", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(
      new VideoUploadRequired(ticket({ uploadUrl: null, partUrls: ["https://store/p/1", "https://store/p/2", "https://store/p/3"], partSize: 500n })) as never,
    );
    const put = vi.fn<PartPut>(async (url) => ({ status: 200, etag: `"e${url.at(-1)}"` }));

    await uploadVideo(target, input(), { api, put, backoffMs: () => 0 });

    expect(put).toHaveBeenCalledTimes(3);
    expect(channel.CompleteVideoUpload).toHaveBeenCalledWith(SPACE, CHANNEL, "ticket-1", [
      { partNumber: 1, etag: "e1" },
      { partNumber: 2, etag: "e2" },
      { partNumber: 3, etag: "e3" },
    ]);
    expect(uploadFile.mock.calls.some(([begin]) => begin.uploadUrl?.startsWith("https://store/p"))).toBe(false);
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "multipart", result: "ok", error: undefined });
  });

  test("bytes the server already holds: VideoStored, nothing uploaded", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(new VideoStored(info({ fileId: "existing" })) as never);

    const result = await uploadVideo(target, input({ poster: null, storyboard: null }), { api });

    expect(result.fileId).toBe("existing");
    expect(uploadFile).not.toHaveBeenCalled();
    expect(channel.CompleteVideoUpload).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "stored", result: "ok", error: undefined });
  });

  test("a refusal before a ticket: typed code, nothing to give back", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(new FailedVideoUpload(VideoUploadError.TOO_LARGE) as never);

    const error = await uploadVideo(target, input(), { api }).catch((e) => e);

    expect(error).toBeInstanceOf(VideoUploadFailure);
    expect(error.code).toBe(VideoUploadError.TOO_LARGE);
    expect(channel.AbortVideoUpload).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "none", result: "failed", error: "TOO_LARGE" });
  });

  test("a refusal at completion gives the ticket back", async () => {
    const { api, channel } = fakeApi();
    channel.CompleteVideoUpload.mockResolvedValueOnce(new FailedVideoUpload(VideoUploadError.DECLARATION_MISMATCH) as never);

    const error = await uploadVideo(target, input(), { api }).catch((e) => e);

    expect(error.code).toBe(VideoUploadError.DECLARATION_MISMATCH);
    expect(channel.AbortVideoUpload).toHaveBeenCalledWith(SPACE, CHANNEL, "ticket-1");
  });

  test("a part that keeps failing: network, ticket given back", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(
      new VideoUploadRequired(ticket({ uploadUrl: null, partUrls: ["https://store/p/1", "https://store/p/2"], partSize: 1000n })) as never,
    );
    const put = vi.fn<PartPut>(async () => ({ status: 502, etag: null }));

    const error = await uploadVideo(target, input(), { api, put, retries: 1, backoffMs: () => 0 }).catch((e) => e);

    expect(error).toMatchObject({ code: "network" });
    expect(channel.AbortVideoUpload).toHaveBeenCalledWith(SPACE, CHANNEL, "ticket-1");
    expect(channel.CompleteVideoUpload).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "multipart", result: "failed", error: "network" });
  });

  test("a bucket that hides the ETag is its own code", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(
      new VideoUploadRequired(ticket({ uploadUrl: null, partUrls: ["https://store/p/1"], partSize: 5000n })) as never,
    );
    const put = vi.fn<PartPut>(async () => ({ status: 200, etag: null }));

    await expect(uploadVideo(target, input(), { api, put })).rejects.toMatchObject({ code: "etag-unavailable" });
    expect(channel.AbortVideoUpload).toHaveBeenCalled();
  });

  test("a cancel while the parts are going up: aborted, ticket given back", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockResolvedValueOnce(
      new VideoUploadRequired(ticket({ uploadUrl: null, partUrls: ["https://store/p/1", "https://store/p/2"], partSize: 1000n })) as never,
    );
    const controller = new AbortController();
    const put: PartPut = (_url, _body, { signal }) =>
      new Promise((_, reject) => {
        controller.abort();
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        if (signal.aborted) reject(new DOMException("aborted", "AbortError"));
      });

    const error = await uploadVideo(target, input(), { api, put, signal: controller.signal }).catch((e) => e);

    expect(error).toMatchObject({ code: "aborted", name: "AbortError" });
    expect(channel.AbortVideoUpload).toHaveBeenCalledWith(SPACE, CHANNEL, "ticket-1");
    expect(count).toHaveBeenCalledWith("video.upload", { transport: "multipart", result: "aborted", error: "aborted" });
  });

  test("cancelled before anything: nothing is called", async () => {
    const { api, channel } = fakeApi();
    const controller = new AbortController();
    controller.abort();

    await expect(uploadVideo(target, input(), { api, signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(channel.PrepareUploadAttachment).not.toHaveBeenCalled();
    expect(channel.PrepareVideoUpload).not.toHaveBeenCalled();
  });

  test("a direct chat goes through the DM service with the peer", async () => {
    const { api, channel, dm } = fakeApi();

    await uploadVideo({ kind: "dm", peerId: "peer-1" }, input(), { api });

    expect(dm.PrepareUploadAttachment.mock.calls.map((c) => c[0])).toEqual(["peer-1", "peer-1"]);
    expect(dm.PrepareVideoUpload.mock.calls[0][0]).toBe("peer-1");
    expect(dm.CompleteVideoUpload).toHaveBeenCalledWith("peer-1", "ticket-1", []);
    expect(channel.PrepareVideoUpload).not.toHaveBeenCalled();
  });

  test("a poster that fails to upload is left out; the video still goes", async () => {
    const { api, channel } = fakeApi();
    uploadFile.mockImplementationOnce(async () => {
      throw new Error("Upload failed (500)");
    });

    await uploadVideo(target, input(), { api });

    const declaration = declarationOf(channel.PrepareVideoUpload.mock.calls);
    expect(declaration.posterFileId).toBeNull();
    expect(declaration.storyboardFileId).toBe("board-file");
    expect(declaration.thumbHash).toBe("hash");
  });

  test("a poster the server already has is linked, not uploaded", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareUploadAttachment.mockResolvedValueOnce(new AlreadyStored(attachment("known-poster", "p.webp")) as never);

    await uploadVideo(target, input({ storyboard: null }), { api });

    expect(declarationOf(channel.PrepareVideoUpload.mock.calls).posterFileId).toBe("known-poster");
    expect(declarationOf(channel.PrepareVideoUpload.mock.calls).storyboard).toBeNull();
    expect(uploadFile.mock.calls.filter(([begin]) => begin.uploadUrl === "https://store/img")).toHaveLength(0);
  });

  test("an RPC that throws is a network failure", async () => {
    const { api, channel } = fakeApi();
    channel.PrepareVideoUpload.mockRejectedValueOnce(new Error("socket closed"));
    await expect(uploadVideo(target, input(), { api })).rejects.toMatchObject({ code: "network", message: "socket closed" });
  });
});

test("mp4FileName", () => {
  expect(mp4FileName("clip.mov")).toBe("clip.mp4");
  expect(mp4FileName("Clip.MP4")).toBe("Clip.MP4");
  expect(mp4FileName("holiday.2024.webm")).toBe("holiday.2024.mp4");
  expect(mp4FileName("noext")).toBe("noext.mp4");
  expect(mp4FileName(".mkv")).toBe("video.mp4");
});
