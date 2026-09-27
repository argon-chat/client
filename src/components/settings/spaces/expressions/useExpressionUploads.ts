import { computed, getCurrentScope, onScopeDispose, reactive, ref } from "vue";
import type { ExpressionItem, ExpressionKind } from "@argon/glue";
import { ExpressionRefusal } from "@/lib/refusals";
import { isRejection, prepareExpressionUpload, suggestItemName, type PreparedUpload, type UploadRejection } from "@/lib/expressions/uploadPrep";
import { isFixableInWorkbench, isWorkbenchImage } from "@/lib/expressions/workbench/entry";
import type { UploadExpressionOptions } from "@/store/data/expressionsStore";

/** `pending`: waiting for the user — held for editing, or refused for something the workbench fixes. */
export type UploadStatus = "queued" | "checking" | "uploading" | "done" | "failed" | "pending";

export interface UploadRow {
  id: number;
  fileName: string;
  packId: string;
  kind: ExpressionKind;
  status: UploadStatus;
  /** 0–1 while uploading. */
  progress: number;
  error: { key: string; params?: Record<string, string | number> } | null;
  /** Failed where trying again can help: the server or the network refused it, or no slot was free. */
  retryable: boolean;
  item: ExpressionItem | null;
  /** A still image: it can be opened in the workbench until it goes up. */
  editable: boolean;
  /** An object URL: the file itself for a still image, its first frame for an animation once made. */
  preview: string | null;
}

export interface UploadTarget {
  spaceId: string;
  packId: string;
  kind: ExpressionKind;
  /** Names already used in the space (emoji names are unique per space). */
  takenNames: () => ReadonlySet<string>;
  /** Free slots left: the pack's and the space's, whichever is fewer. */
  capacity: () => number;
}

export interface ExpressionUploadDeps {
  upload: (options: UploadExpressionOptions) => Promise<ExpressionItem>;
  prepare?: (file: Blob, kind: ExpressionKind) => Promise<PreparedUpload | UploadRejection>;
}

const STILL_IMAGE = /^image\/(png|webp|jpeg|gif|avif|bmp)$/;

function objectUrl(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

function revoke(url: string | null) {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* already gone */
  }
}

/**
 * Files dropped on a pack, uploaded one at a time: each is checked and given its first frame and
 * outline locally, then sent. Each file is a row the pack's grid shows as a cell until it goes up;
 * then the row goes and the store's item takes its place. A still image refused for its size or
 * canvas waits as `pending`, and so does one held for editing; `replace` puts the edited file in its
 * place and sends it round again. A refused upload can be retried or removed.
 */
export function useExpressionUploads(deps: ExpressionUploadDeps) {
  const prepare = deps.prepare ?? prepareExpressionUpload;
  const rows = ref<UploadRow[]>([]);
  let seq = 0;
  let chain: Promise<void> = Promise.resolve();
  // Names handed out in this batch that the store may not have seen yet.
  const pendingNames = new Set<string>();
  // The row's current file (the edited one once replaced) and where it goes.
  const files = new Map<number, File>();
  const targets = new Map<number, UploadTarget>();

  function setPreview(row: UploadRow, blob: Blob | null) {
    revoke(row.preview);
    row.preview = blob ? objectUrl(blob) : null;
  }

  function stillPreview(file: File): Blob | null {
    return STILL_IMAGE.test(file.type) || /\.(png|webp)$/i.test(file.name) ? file : null;
  }

  function fail(row: UploadRow, key: string, params?: Record<string, string | number>, retryable = false) {
    row.status = "failed";
    row.error = { key, params };
    row.retryable = retryable;
  }

  function drop(id: number) {
    const row = find(id);
    if (row) revoke(row.preview);
    rows.value = rows.value.filter((r) => r.id !== id);
    files.delete(id);
    targets.delete(id);
  }

  async function run(row: UploadRow) {
    // Held for editing (or removed) while it waited its turn.
    if (row.status !== "queued") return;
    const file = files.get(row.id);
    const target = targets.get(row.id);
    if (!file || !target) return;
    if (target.capacity() <= 0) {
      fail(row, "expression_settings_upload_no_slots", undefined, true);
      return;
    }
    row.status = "checking";
    const prepared = await prepare(file, target.kind).catch((): UploadRejection => ({ rejected: true, key: "expression_settings_upload_error_corrupt" }));
    // Removed while it was being checked.
    if (files.get(row.id) !== file) return;
    if (isRejection(prepared)) {
      if (row.editable && isFixableInWorkbench(file, prepared.key)) {
        row.status = "pending";
        row.error = { key: prepared.key, params: prepared.params };
        row.retryable = false;
      } else {
        fail(row, prepared.key, prepared.params);
      }
      return;
    }
    if (prepared.thumb) setPreview(row, prepared.thumb);

    row.status = "uploading";
    row.progress = 0;
    const taken = new Set([...target.takenNames(), ...pendingNames]);
    const name = suggestItemName(target.kind, file.name, taken);
    pendingNames.add(name);
    try {
      const item = await deps.upload({
        spaceId: target.spaceId,
        packId: target.packId,
        kind: target.kind,
        format: prepared.format,
        file: prepared.file,
        contentType: prepared.contentType,
        thumb: prepared.thumb,
        name,
        emoji: [],
        keywords: [],
        outline: prepared.outline,
        onProgress: (p) => (row.progress = Math.max(0, Math.min(1, p))),
      });
      row.status = "done";
      row.progress = 1;
      row.item = item;
      // The store has the item now; the grid shows it in the cell's place.
      drop(row.id);
    } catch (e) {
      fail(row, e instanceof ExpressionRefusal ? e.key : "expression_error_unknown", undefined, true);
    } finally {
      pendingNames.delete(name);
    }
  }

  function schedule(row: UploadRow): Promise<void> {
    chain = chain.then(() => run(row)).catch(() => {});
    return chain;
  }

  function enqueue(list: readonly File[], target: UploadTarget): Promise<void> {
    for (const file of list) {
      const row = reactive<UploadRow>({
        id: ++seq,
        fileName: file.name,
        packId: target.packId,
        kind: target.kind,
        status: "queued",
        progress: 0,
        error: null,
        retryable: false,
        item: null,
        editable: isWorkbenchImage(file),
        preview: null,
      });
      setPreview(row, stillPreview(file));
      files.set(row.id, file);
      targets.set(row.id, target);
      rows.value.push(row);
      schedule(row);
    }
    return chain;
  }

  function find(id: number) {
    return rows.value.find((r) => r.id === id);
  }

  /** Takes a waiting still image out of the queue for editing. False when it is past that. */
  function hold(id: number): boolean {
    const row = find(id);
    if (!row?.editable) return false;
    if (row.status === "queued") {
      row.status = "pending";
      return true;
    }
    return row.status === "pending";
  }

  /** Editing was given up: a file held from the queue goes back into it; a refused one waits on. */
  function release(id: number): Promise<void> {
    const row = find(id);
    if (!row || row.status !== "pending" || row.error) return chain;
    row.status = "queued";
    return schedule(row);
  }

  /** The edited file takes the row's place and is checked and sent like a new one. */
  function replace(id: number, file: File): Promise<void> {
    const row = find(id);
    if (!row || row.status !== "pending") return chain;
    files.set(id, file);
    setPreview(row, stillPreview(file));
    row.error = null;
    row.retryable = false;
    row.progress = 0;
    row.status = "queued";
    return schedule(row);
  }

  /** A refused upload goes round again. */
  function retry(id: number): Promise<void> {
    const row = find(id);
    if (!row || row.status !== "failed" || !row.retryable) return chain;
    row.error = null;
    row.retryable = false;
    row.progress = 0;
    row.status = "queued";
    return schedule(row);
  }

  /** Gives up on a file that has not started going up, or that stopped. */
  function remove(id: number) {
    const row = find(id);
    if (!row || row.status === "checking" || row.status === "uploading") return;
    drop(id);
  }

  const fileOf = (id: number): File | null => files.get(id) ?? null;
  const kindOf = (id: number): ExpressionKind | null => targets.get(id)?.kind ?? null;

  const busy = computed(() => rows.value.some((r) => r.status === "queued" || r.status === "checking" || r.status === "uploading"));

  if (getCurrentScope()) {
    onScopeDispose(() => {
      for (const r of rows.value) revoke(r.preview);
    });
  }

  return { rows, enqueue, busy, hold, release, replace, retry, remove, fileOf, kindOf };
}
