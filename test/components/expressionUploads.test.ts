/**
 * Files dropped on a pack in the emoji & sticker settings: each becomes a row the pack's grid shows
 * as a cell, with the file's own picture (a first frame for an animation), its progress, and when it
 * is refused the reason with retry or remove. Once it goes up the row goes; the store's item stands
 * in its place. Associated emoji are left for the edit dialog: none are sent.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ExpressionError, ExpressionFormat, ExpressionKind, type ExpressionItem } from "@argon/glue";
import { useExpressionUploads, type UploadTarget } from "@/components/settings/spaces/expressions/useExpressionUploads";
import { ExpressionRefusal } from "@/lib/refusals";
import type { PreparedUpload, UploadRejection } from "@/lib/expressions/uploadPrep";
import type { UploadExpressionOptions } from "@/store/data/expressionsStore";

const originals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
let made: Blob[] = [];
let revoked: string[] = [];

beforeEach(() => {
  made = [];
  revoked = [];
  URL.createObjectURL = ((blob: Blob) => {
    made.push(blob);
    return `blob:test/${made.length}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => void revoked.push(url)) as typeof URL.revokeObjectURL;
});

afterEach(() => {
  URL.createObjectURL = originals.create;
  URL.revokeObjectURL = originals.revoke;
});

function prepared(file: Blob, extra: Partial<PreparedUpload> = {}): PreparedUpload {
  return { type: "png", format: ExpressionFormat.Static, file, contentType: "image/png", width: 100, height: 100, thumb: null, outline: null, ...extra };
}

function target(overrides: Partial<UploadTarget> = {}): UploadTarget {
  return { spaceId: "s1", packId: "p1", kind: ExpressionKind.Emoji, takenNames: () => new Set(), capacity: () => 10, ...overrides };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
const item = (id: string) => ({ itemId: id }) as unknown as ExpressionItem;

describe("upload rows", () => {
  test("a still image shows itself at once, then its progress; once up the row gives way to the item", async () => {
    const gate = deferred<ExpressionItem>();
    let options: UploadExpressionOptions | null = null;
    const uploads = useExpressionUploads({
      prepare: async (file) => prepared(file),
      upload: (o) => {
        options = o;
        return gate.promise;
      },
    });

    const file = png("Party Face.png");
    const done = uploads.enqueue([file], target());
    const row = uploads.rows.value[0];
    expect(row).toMatchObject({ packId: "p1", kind: ExpressionKind.Emoji, fileName: "Party Face.png", preview: "blob:test/1" });
    expect(made[0]).toBe(file);

    await vi.waitFor(() => expect(row.status).toBe("uploading"));
    expect(options!).toMatchObject({ name: "party_face", emoji: [], keywords: [] });
    options!.onProgress!(0.4);
    expect(row.progress).toBe(0.4);

    gate.resolve(item("i1"));
    await done;
    expect(row.status).toBe("done");
    expect(uploads.rows.value).toHaveLength(0);
    expect(revoked).toEqual(["blob:test/1"]);
  });

  test("an animation shows its first frame once it is made", async () => {
    const thumb = new Blob([new Uint8Array([7])], { type: "image/webp" });
    const gate = deferred<ExpressionItem>();
    const uploads = useExpressionUploads({
      prepare: async (file) => prepared(file, { type: "tgs", format: ExpressionFormat.Lottie, contentType: "application/x-tgsticker", thumb }),
      upload: () => gate.promise,
    });
    void uploads.enqueue([new File([new Uint8Array([0x1f, 0x8b])], "party.tgs")], target());
    const row = uploads.rows.value[0];
    expect(row.preview).toBeNull();
    await vi.waitFor(() => expect(row.status).toBe("uploading"));
    expect(row.preview).toBe("blob:test/1");
    expect(made[0]).toBe(thumb);
    gate.resolve(item("i1"));
  });

  test("a refusal from the server says why and can be tried again", async () => {
    let calls = 0;
    const uploads = useExpressionUploads({
      prepare: async (file) => prepared(file),
      upload: async () => {
        calls++;
        if (calls === 1) throw new ExpressionRefusal(ExpressionError.RATE_LIMITED);
        return item("i1");
      },
    });
    await uploads.enqueue([png("a.png")], target());
    const row = uploads.rows.value[0];
    expect(row).toMatchObject({ status: "failed", retryable: true, error: { key: "expression_error_rate_limited" } });

    await uploads.retry(row.id);
    expect(calls).toBe(2);
    expect(row.status).toBe("done");
    expect(uploads.rows.value).toHaveLength(0);
  });

  test("a file refused before it leaves shows why in its cell, the rest of the batch goes on", async () => {
    const bad: UploadRejection = { rejected: true, key: "expression_settings_upload_error_type" };
    const sent: Blob[] = [];
    const uploads = useExpressionUploads({
      prepare: async (file) => ((file as File).name === "junk.webm" ? bad : prepared(file)),
      upload: async (o) => {
        sent.push(o.file);
        return item("i1");
      },
    });
    const good = png("good.png");
    await uploads.enqueue([new File([new Uint8Array([1])], "junk.webm", { type: "video/webm" }), good], target());
    expect(sent).toEqual([good]);
    expect(uploads.rows.value).toHaveLength(1);
    const row = uploads.rows.value[0];
    expect(row).toMatchObject({ fileName: "junk.webm", status: "failed", retryable: false, error: { key: bad.key } });

    // Trying again cannot help; removing it clears the cell.
    await uploads.retry(row.id);
    expect(row.status).toBe("failed");
    uploads.remove(row.id);
    expect(uploads.rows.value).toHaveLength(0);
  });

  test("with no free slot the file waits with a reason and can be retried later", async () => {
    let free = 0;
    const upload = vi.fn(async () => item("i1"));
    const uploads = useExpressionUploads({ prepare: async (file) => prepared(file), upload });
    await uploads.enqueue([png("a.png")], target({ capacity: () => free }));
    const row = uploads.rows.value[0];
    expect(row).toMatchObject({ status: "failed", retryable: true, error: { key: "expression_settings_upload_no_slots" } });
    expect(upload).not.toHaveBeenCalled();

    free = 1;
    await uploads.retry(row.id);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(uploads.rows.value).toHaveLength(0);
  });

  test("a file removed before its turn is never sent", async () => {
    const gate = deferred<ExpressionItem>();
    const upload = vi.fn((o: UploadExpressionOptions) => (o.name === "first" ? gate.promise : Promise.resolve(item("b"))));
    const uploads = useExpressionUploads({ prepare: async (file) => prepared(file), upload });
    const done = uploads.enqueue([png("first.png"), png("second.png")], target());
    await vi.waitFor(() => expect(uploads.rows.value[0].status).toBe("uploading"));
    const b = uploads.rows.value[1];
    expect(b.status).toBe("queued");
    // One in flight cannot be removed; one waiting can.
    uploads.remove(uploads.rows.value[0].id);
    uploads.remove(b.id);
    expect(uploads.rows.value.map((r) => r.fileName)).toEqual(["first.png"]);
    gate.resolve(item("first"));
    await done;
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
