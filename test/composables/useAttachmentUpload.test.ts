/**
 * What the composer sends for an attachment: a copy of a file the server already has when it knows
 * of one — from the upload pool or a reference — and the bytes otherwise, or when the copy is refused.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  attach: vi.fn(),
  prepare: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  upload: vi.fn(),
  find: vi.fn(),
  remember: vi.fn(),
  forget: vi.fn(),
  count: vi.fn(),
  sha: vi.fn(),
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: {
      AttachExistingFile: h.attach,
      PrepareUploadAttachment: h.prepare,
      BeginUploadAttachment: h.begin,
      CompleteUploadAttachment: h.complete,
    },
    userChatInteractions: {},
  }),
}));
vi.mock("@/lib/uploadFile", () => ({ uploadFile: h.upload }));
vi.mock("@/lib/attachments/uploadPool", () => ({ findUpload: h.find, rememberUpload: h.remember, forgetUpload: h.forget }));
vi.mock("@/lib/attachments/hash", () => ({ sha256Hex: h.sha }));
vi.mock("@/store/system/fileStorage", () => ({ cdnFetchUrl: (id: string) => `https://api.test/files/${id}` }));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count: h.count, distribution: vi.fn(), startTimer: () => ({ end: vi.fn() }) },
  errorKind: () => "error",
}));

import { useAttachmentUpload } from "@/composables/useAttachmentUpload";
import {
  AlreadyStored,
  AttachExistingFileError,
  FailedAttachExistingFile,
  FailedPrepareUpload,
  MessageEntityAttachment,
  PrepareUploadError,
  SuccessAttachExistingFile,
  SuccessUploadFile,
  UploadRequired,
  type AttachmentInfo,
} from "@argon/glue";

const SHA = "c".repeat(64);
const POOLED = "0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b";
const COPY = "0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c";
const UPLOADED = "0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5d";
const target = { kind: "channel", spaceId: "s1", channelId: "c1" } as const;

function info(fileId: string, fileName: string): AttachmentInfo {
  return { fileId, fileName, fileSize: 3n, contentType: "text/plain", downloadUrl: null } as unknown as AttachmentInfo;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sha.mockResolvedValue(SHA);
  h.find.mockResolvedValue(null);
  // A server that predates PrepareUploadAttachment, unless a test says otherwise.
  h.prepare.mockRejectedValue(new Error("unknown method"));
  h.begin.mockResolvedValue(new SuccessUploadFile("blob-1", "https://upload", [], 60));
  h.upload.mockResolvedValue({ blobId: "blob-1" });
  h.complete.mockResolvedValue(info(UPLOADED, "a.txt"));
});

describe("describing the bytes to the server first", () => {
  test("a server that already holds them where the account can see answers with a copy, and nothing is uploaded", async () => {
    h.prepare.mockResolvedValue(new AlreadyStored(info(COPY, "a.txt")));

    const attachments = useAttachmentUpload();
    await attachments.addFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);
    const entities = await attachments.uploadAll(target);

    const [spaceId, channelId, sha, size, type, name] = h.prepare.mock.calls[0];
    expect([spaceId, channelId, size, type, name]).toEqual(["s1", "c1", 3n, "text/plain", "a.txt"]);
    expect(Array.from(sha as Uint8Array).length).toBe(32);
    expect(h.begin).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect((entities[0] as MessageEntityAttachment).fileId).toBe(COPY);
    expect(h.count).toHaveBeenCalledWith("attachment.dedup", expect.objectContaining({ source: "server", result: "linked" }));
    expect(h.remember).toHaveBeenCalledWith(expect.objectContaining({ sha256: SHA, fileId: COPY }));
  });

  test("otherwise the ticket it hands back is the one the bytes go to", async () => {
    h.prepare.mockResolvedValue(new UploadRequired("blob-9", "https://upload-9", [], 60));
    h.upload.mockResolvedValue({ blobId: "blob-9" });

    const attachments = useAttachmentUpload();
    await attachments.addFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);
    await attachments.uploadAll(target);

    expect(h.begin).not.toHaveBeenCalled();
    expect((h.upload.mock.calls[0][0] as SuccessUploadFile).blobId).toBe("blob-9");
    expect(h.complete).toHaveBeenCalledWith("s1", "c1", "blob-9");
  });

  test("a refusal up front is the attachment's error, with no ticket asked for", async () => {
    h.prepare.mockResolvedValue(new FailedPrepareUpload(PrepareUploadError.TOO_LARGE));

    const attachments = useAttachmentUpload();
    await attachments.addFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);
    const entities = await attachments.uploadAll(target);

    expect(entities).toEqual([]);
    expect(attachments.pendingFiles.value[0].status).toBe("error");
    expect(attachments.pendingFiles.value[0].error).toBe("TOO_LARGE");
    expect(h.begin).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
  });

  test("an older server without the method gets the plain Begin", async () => {
    const attachments = useAttachmentUpload();
    await attachments.addFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);
    const entities = await attachments.uploadAll(target);

    expect(h.begin).toHaveBeenCalledTimes(1);
    expect((entities[0] as MessageEntityAttachment).fileId).toBe(UPLOADED);
  });
});

describe("bytes the account has sent before", () => {
  test("go out as a copy of that upload, without a PUT", async () => {
    h.find.mockResolvedValue({ sha256: SHA, fileId: POOLED, fileName: "old.txt", fileSize: 3, contentType: "text/plain", width: null, height: null, thumbHash: null, uploadedAt: 1 });
    h.attach.mockResolvedValue(new SuccessAttachExistingFile(info(COPY, "a.txt")));

    const attachments = useAttachmentUpload();
    await attachments.addFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);

    expect(attachments.pendingFiles.value[0].link).toEqual({ fileId: POOLED, fileName: "a.txt", origin: "pool" });

    const entities = await attachments.uploadAll(target);

    expect(h.attach).toHaveBeenCalledWith("s1", "c1", POOLED, "a.txt");
    expect(h.upload).not.toHaveBeenCalled();
    expect((entities[0] as MessageEntityAttachment).fileId).toBe(COPY);
    expect(h.remember).toHaveBeenCalledWith(expect.objectContaining({ sha256: SHA, fileId: COPY }));
    expect(h.count).toHaveBeenCalledWith("attachment.dedup", expect.objectContaining({ source: "pool", result: "linked" }));
  });

  test("are uploaded after all when the server no longer has the file, which is then forgotten", async () => {
    h.find.mockResolvedValue({ sha256: SHA, fileId: POOLED, fileName: "old.txt", fileSize: 3, contentType: "text/plain", width: null, height: null, thumbHash: null, uploadedAt: 1 });
    h.attach.mockResolvedValue(new FailedAttachExistingFile(AttachExistingFileError.SOURCE_NOT_FOUND));

    const attachments = useAttachmentUpload();
    await attachments.addFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);
    const entities = await attachments.uploadAll(target);

    expect(h.forget).toHaveBeenCalledWith(SHA);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect((entities[0] as MessageEntityAttachment).fileId).toBe(UPLOADED);
    expect(h.count).toHaveBeenCalledWith("attachment.dedup", expect.objectContaining({ source: "pool", result: "fallback" }));
    expect(h.remember).toHaveBeenCalledWith(expect.objectContaining({ sha256: SHA, fileId: UPLOADED }));
  });

  test("a first upload is remembered for the next time", async () => {
    const attachments = useAttachmentUpload();
    await attachments.addFiles([new File(["abc"], "a.txt", { type: "text/plain" })]);
    await attachments.uploadAll(target);

    expect(h.attach).not.toHaveBeenCalled();
    expect(h.remember).toHaveBeenCalledWith(expect.objectContaining({ sha256: SHA, fileId: UPLOADED, fileName: "a.txt" }));
  });
});

describe("a reference to a file the server has", () => {
  test("is fetched for its preview and sent as a copy", async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(["abc"], { type: "text/plain" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    h.attach.mockResolvedValue(new SuccessAttachExistingFile(info(COPY, "doc.txt")));

    const attachments = useAttachmentUpload();
    const errors = await attachments.addReferences(
      [{ fileId: POOLED, fileName: "doc.txt", fileSize: 3, contentType: "text/plain", width: null, height: null, thumbHash: null }],
      null,
      "clipboard",
    );

    expect(errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(`https://api.test/files/${POOLED}`);
    expect(attachments.pendingFiles.value[0].file.name).toBe("doc.txt");

    const entities = await attachments.uploadAll(target);

    expect(h.attach).toHaveBeenCalledWith("s1", "c1", POOLED, "doc.txt");
    expect(h.upload).not.toHaveBeenCalled();
    expect((entities[0] as MessageEntityAttachment).fileId).toBe(COPY);

    vi.unstubAllGlobals();
  });

  test("an older server without the method gets the bytes instead", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["abc"], { type: "text/plain" }), { status: 200 })));
    h.attach.mockRejectedValue(new Error("unknown method"));

    const attachments = useAttachmentUpload();
    await attachments.addReferences(
      [{ fileId: POOLED, fileName: "doc.txt", fileSize: null, contentType: null, width: null, height: null, thumbHash: null }],
      null,
      "drag",
    );
    const entities = await attachments.uploadAll(target);

    expect(h.upload).toHaveBeenCalledTimes(1);
    expect((entities[0] as MessageEntityAttachment).fileId).toBe(UPLOADED);
    expect(h.count).toHaveBeenCalledWith("attachment.dedup", expect.objectContaining({ source: "drag", result: "fallback" }));

    vi.unstubAllGlobals();
  });
});
