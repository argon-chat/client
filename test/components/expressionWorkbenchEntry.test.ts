/**
 * The way into the sticker workbench from the emoji & sticker settings: a still image that waits
 * (held from the queue, or refused for something the workbench fixes) opens in it, and what it
 * saves takes the file's place before the file is checked and uploaded.
 */

import { describe, test, expect, vi } from "vitest";
import { nextTick } from "vue";
import { ExpressionFormat, ExpressionKind, type ExpressionItem } from "@argon/glue";
import { useExpressionUploads, type UploadTarget } from "@/components/settings/spaces/expressions/useExpressionUploads";
import { useExpressionWorkbench } from "@/components/settings/spaces/expressions/useExpressionWorkbench";
import type { PreparedUpload, UploadRejection } from "@/lib/expressions/uploadPrep";
import type { UploadExpressionOptions } from "@/store/data/expressionsStore";

const DIMS: UploadRejection = { rejected: true, key: "expression_settings_upload_error_dims_sticker", params: { width: 800, height: 600 } };

function prepared(file: Blob): PreparedUpload {
  return { type: "webp", format: ExpressionFormat.Static, file, contentType: "image/webp", width: 512, height: 384, thumb: null, outline: null };
}

function target(kind = ExpressionKind.Sticker): UploadTarget {
  return { spaceId: "s1", packId: "p1", kind, takenNames: () => new Set(), capacity: () => 10 };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await nextTick();
  }
}

function setup(options: { prepare?: (file: Blob) => Promise<PreparedUpload | UploadRejection>; upload?: (o: UploadExpressionOptions) => Promise<ExpressionItem>; gpu?: boolean } = {}) {
  const uploaded: UploadExpressionOptions[] = [];
  const upload = vi.fn(
    options.upload ??
      (async (o: UploadExpressionOptions) => {
        uploaded.push(o);
        return { itemId: `i${uploaded.length}`, name: o.name } as unknown as ExpressionItem;
      }),
  );
  const uploads = useExpressionUploads({ upload, prepare: options.prepare ?? (async (file) => prepared(file)) });
  const created: File[] = [];
  let kind = ExpressionKind.Sticker;
  const workbench = useExpressionWorkbench({
    uploads,
    currentKind: () => kind,
    onCreated: (file) => created.push(file),
    probe: async () => options.gpu ?? true,
  });
  return { uploads, workbench, upload, uploaded, created, setKind: (k: ExpressionKind) => (kind = k) };
}

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("sticker workbench entry", () => {
  test("a still image refused for its canvas waits; the edited file replaces it and is what goes up", async () => {
    const original = png("Big Cat.png");
    const edited = new File([new Uint8Array([9, 9])], "Big Cat.webp", { type: "image/webp" });
    const prepare = vi.fn(async (file: Blob) => (file === original ? DIMS : prepared(file)));
    const { uploads, workbench, uploaded } = setup({ prepare });
    await flush();

    await uploads.enqueue([original], target());
    const row = uploads.rows.value[0];
    expect(row).toMatchObject({ status: "pending", editable: true, error: { key: DIMS.key } });
    expect(uploaded).toHaveLength(0);

    expect(workbench.edit(row.id)).toBe(true);
    expect(workbench.session).toMatchObject({ open: true, file: original, kind: ExpressionKind.Sticker, rowId: row.id });

    workbench.done(edited);
    expect(workbench.session.open).toBe(false);
    await vi.waitFor(() => expect(row.status).toBe("done"));

    expect(prepare).toHaveBeenLastCalledWith(edited, ExpressionKind.Sticker);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].file).toBe(edited);
    expect(uploaded[0]).toMatchObject({ name: "Big Cat", contentType: "image/webp", packId: "p1", emoji: [] });
    expect(row.error).toBeNull();
    // Gone up: the row leaves the grid to the store's item.
    expect(uploads.rows.value).toHaveLength(0);
    expect(uploads.fileOf(row.id)).toBeNull();
  });

  test("Edit on a file still in the queue holds it: the queue passes it by until the edit is saved", async () => {
    const first = deferred<ExpressionItem>();
    const calls: UploadExpressionOptions[] = [];
    const { uploads, workbench } = setup({
      upload: (o) => {
        calls.push(o);
        return calls.length === 1 ? first.promise : Promise.resolve({ itemId: "x" } as unknown as ExpressionItem);
      },
    });
    await flush();

    const a = png("a.png");
    const b = png("b.png");
    const run = uploads.enqueue([a, b], target());
    await vi.waitFor(() => expect(uploads.rows.value[0].status).toBe("uploading"));
    const rowB = uploads.rows.value[1];
    expect(rowB.status).toBe("queued");

    expect(workbench.edit(rowB.id)).toBe(true);
    expect(rowB.status).toBe("pending");
    expect(rowB.error).toBeNull();

    first.resolve({ itemId: "a" } as unknown as ExpressionItem);
    await run;
    expect(calls.map((c) => c.file)).toEqual([a]);
    expect(rowB.status).toBe("pending");

    const edited = new File([new Uint8Array([7])], "b.webp", { type: "image/webp" });
    workbench.done(edited);
    await vi.waitFor(() => expect(rowB.status).toBe("done"));
    expect(calls.map((c) => c.file)).toEqual([a, edited]);
  });

  test("giving up puts a held file back in the queue; a refused one keeps waiting", async () => {
    const refused = png("refused.png");
    const { uploads, workbench, uploaded } = setup({ prepare: async (file) => (file === refused ? DIMS : prepared(file)) });
    await flush();

    await uploads.enqueue([refused], target());
    const row = uploads.rows.value[0];
    workbench.edit(row.id);
    workbench.cancel();
    await flush();
    expect(row.status).toBe("pending");
    expect(uploaded).toHaveLength(0);

    // A queued file held and then released is uploaded as it was.
    const gate = deferred<void>();
    const slow = setup({
      prepare: async (file) => {
        await gate.promise;
        return prepared(file);
      },
    });
    await flush();
    const x = png("x.png");
    const y = png("y.png");
    const done = slow.uploads.enqueue([x, y], target());
    const rowY = slow.uploads.rows.value[1];
    expect(slow.workbench.edit(rowY.id)).toBe(true);
    slow.workbench.cancel();
    expect(rowY.status).toBe("queued");
    gate.resolve();
    await done;
    await vi.waitFor(() => expect(rowY.status).toBe("done"));
    expect(slow.uploaded.map((o) => o.file)).toEqual([x, y]);
  });

  test("an animation is never editable, and a file that is past waiting cannot be held", async () => {
    const { uploads, workbench } = setup({
      prepare: async () => ({ rejected: true, key: "expression_settings_upload_error_size" }),
    });
    await flush();
    await uploads.enqueue([new File([new Uint8Array([1])], "party.tgs", { type: "application/x-tgsticker" })], target());
    const row = uploads.rows.value[0];
    expect(row).toMatchObject({ status: "failed", editable: false });
    expect(workbench.edit(row.id)).toBe(false);
    expect(workbench.session.open).toBe(false);

    const ok = setup();
    await flush();
    const running = ok.uploads.enqueue([png("fine.png")], target());
    const fine = ok.uploads.rows.value[0];
    await running;
    expect(fine.status).toBe("done");
    expect(ok.workbench.edit(fine.id)).toBe(false);
  });

  test("a waiting file can be discarded", async () => {
    const { uploads } = setup({ prepare: async () => DIMS });
    await flush();
    await uploads.enqueue([png("a.png")], target());
    const id = uploads.rows.value[0].id;
    uploads.remove(id);
    expect(uploads.rows.value).toHaveLength(0);
    expect(uploads.fileOf(id)).toBeNull();
  });

  test("Create from image opens any picture for the kind on screen and hands back what is saved", async () => {
    const { workbench, created, setKind } = setup();
    await flush();
    setKind(ExpressionKind.Emoji);
    const photo = new File([new Uint8Array([1])], "me.jpg", { type: "image/jpeg" });
    expect(workbench.create(photo)).toBe(true);
    expect(workbench.session).toMatchObject({ open: true, file: photo, kind: ExpressionKind.Emoji, rowId: null });
    const result = new File([new Uint8Array([2])], "me.webp", { type: "image/webp" });
    workbench.done(result);
    expect(created).toEqual([result]);
  });

  test("without WebGPU the workbench is not offered", async () => {
    const { uploads, workbench } = setup({ gpu: false, prepare: async () => DIMS });
    await flush();
    expect(workbench.available.value).toBe(false);
    await uploads.enqueue([png("a.png")], target());
    expect(workbench.edit(uploads.rows.value[0].id)).toBe(false);
    expect(workbench.create(png("b.png"))).toBe(false);
  });
});
