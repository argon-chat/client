/**
 * The account's memory of what it has uploaded, by content hash: answered from memory, then from
 * IndexedDB, never after it has aged out, and forgotten on request.
 */
import "fake-indexeddb/auto";
import { describe, test, expect, beforeEach } from "vitest";
import { db } from "@/store/db/dexie";
import { findUpload, forgetUpload, rememberUpload, resetUploadPoolMemory } from "@/lib/attachments/uploadPool";

const ID = "0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b";
const SHA = "a".repeat(64);

const cat = { sha256: SHA, fileId: ID, fileName: "cat.png", fileSize: 12, contentType: "image/png", width: 1, height: 1, thumbHash: null };

describe("upload pool", () => {
  beforeEach(async () => {
    resetUploadPoolMemory();
    await db.uploadedFiles.clear();
  });

  test("remembers an upload and finds it again, from memory and from the database", async () => {
    await rememberUpload(cat);

    expect(await findUpload(SHA)).toMatchObject(cat);

    resetUploadPoolMemory();
    expect(await findUpload(SHA)).toMatchObject(cat);
    expect(await findUpload("b".repeat(64))).toBeNull();
  });

  test("an entry past its month is gone, and removed on the way out", async () => {
    await rememberUpload(cat);
    await db.uploadedFiles.update(SHA, { uploadedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    resetUploadPoolMemory();

    expect(await findUpload(SHA)).toBeNull();
    expect(await db.uploadedFiles.get(SHA)).toBeUndefined();
  });

  test("a forgotten upload is not offered again", async () => {
    await rememberUpload(cat);
    await forgetUpload(SHA);

    expect(await findUpload(SHA)).toBeNull();
    expect(await db.uploadedFiles.get(SHA)).toBeUndefined();
  });
});
