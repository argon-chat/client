/**
 * Sticker / custom emoji uploads are measured: `expression.upload` counts every upload with its
 * kind, format and result, `expression.upload.duration` times it with the same labels. A failure
 * is recorded with the same metric, `result: "failed"` and a fixed-vocabulary error: the server's
 * refusal reason, or the error's class — never its message.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia, type Pinia } from "pinia";

await vi.hoisted(async () => {
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
});

const h = vi.hoisted(() => ({
  svc: null as any,
  uploadFile: null as any,
  counts: [] as Array<[string, Record<string, unknown>]>,
  timings: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    get spaceExpressionInteraction() {
      return h.svc;
    },
  }),
}));
vi.mock("@/lib/uploadFile", () => ({
  uploadFile: (...args: unknown[]) => h.uploadFile(...args),
}));
vi.mock("@/lib/telemetry/metrics", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/telemetry/metrics")>();
  const metrics = {
    ...real.metrics,
    count: (name: string, attrs: Record<string, unknown> = {}) => h.counts.push([name, attrs]),
    startTimer: (name: string, attrs: Record<string, unknown> = {}) => ({
      elapsed: () => 0,
      end: (extra: Record<string, unknown> = {}) => {
        h.timings.push([name, { ...attrs, ...extra }]);
        return 0;
      },
    }),
  };
  return { ...real, metrics, default: metrics };
});

import {
  ExpressionError,
  ExpressionFormat,
  ExpressionKind,
  FailedItem,
  SuccessItem,
  SuccessUploadFile,
  type ExpressionItem,
} from "@argon/glue";
import { db, ensureDbOpen } from "@/store/db/dexie";
import { useExpressionsStore, type UploadExpressionOptions } from "@/store/data/expressionsStore";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const SPACE = "space-1";

const item = (itemId: string, kind: ExpressionKind, format: ExpressionFormat): ExpressionItem => ({
  itemId,
  packId: "p1",
  spaceId: SPACE,
  kind,
  format,
  name: itemId,
  fileId: `f-${itemId}`,
  thumbFileId: null,
  width: 512,
  height: 512,
  fileSize: 100,
  emoji: [],
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder: 0,
  downloadUrl: null,
  thumbUrl: null,
});

const upload = (kind: ExpressionKind, format: ExpressionFormat): UploadExpressionOptions => ({
  spaceId: SPACE,
  packId: "p1",
  kind,
  format,
  file: new Blob(["x"]),
  contentType: "image/webp",
  name: "n",
  emoji: [],
  keywords: [],
});

let pinia: Pinia;

beforeEach(async () => {
  await ensureDbOpen();
  await db.expressions.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  localStorage.clear();
  h.counts.length = 0;
  h.timings.length = 0;
  h.svc = {
    GetExpressions: vi.fn(async () => ({ version: "v1", packs: [] })),
    BeginUploadExpression: vi.fn(async () => new SuccessUploadFile("blob-0", "https://upload", [], 60)),
    AddItem: vi.fn(),
  };
  h.uploadFile = vi.fn(async () => ({ blobId: "blob-0" }));
});

afterEach(async () => {
  for (const store of (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.values()) store.$dispose();
  await runSessionReset();
});

describe("expression.upload", () => {
  test("a successful upload counts once and is timed, labelled by kind and format", async () => {
    const store = useExpressionsStore();
    h.svc.AddItem.mockResolvedValue(new SuccessItem(item("a", ExpressionKind.Emoji, ExpressionFormat.Lottie)));

    await store.uploadItem(upload(ExpressionKind.Emoji, ExpressionFormat.Lottie));

    expect(h.counts).toEqual([["expression.upload", { kind: "emoji", format: "lottie", result: "ok" }]]);
    expect(h.timings).toEqual([["expression.upload.duration", { kind: "emoji", format: "lottie", result: "ok" }]]);
  });

  test("stickers and video are labelled as such", async () => {
    const store = useExpressionsStore();
    h.svc.AddItem.mockResolvedValue(new SuccessItem(item("s", ExpressionKind.Sticker, ExpressionFormat.Video)));

    await store.uploadItem(upload(ExpressionKind.Sticker, ExpressionFormat.Video));

    expect(h.counts[0]![1]).toMatchObject({ kind: "sticker", format: "video" });
  });

  test("a refusal is a failure labelled with the reason; the error still reaches the caller", async () => {
    const store = useExpressionsStore();
    h.svc.AddItem.mockResolvedValue(new FailedItem(ExpressionError.QUOTA_EXCEEDED));

    await expect(store.uploadItem(upload(ExpressionKind.Sticker, ExpressionFormat.Static))).rejects.toMatchObject({
      error: ExpressionError.QUOTA_EXCEEDED,
    });

    const failed = { kind: "sticker", format: "static", result: "failed", error: "QUOTA_EXCEEDED" };
    expect(h.counts).toEqual([["expression.upload", failed]]);
    expect(h.timings).toEqual([["expression.upload.duration", failed]]);
  });

  test("a transport failure is labelled with the error's class, never its message", async () => {
    const store = useExpressionsStore();
    h.uploadFile.mockRejectedValue(new TypeError("Failed to fetch https://upload/blob-0?sig=secret"));

    await expect(store.uploadItem(upload(ExpressionKind.Emoji, ExpressionFormat.Static))).rejects.toBeInstanceOf(TypeError);

    expect(h.counts).toEqual([["expression.upload", { kind: "emoji", format: "static", result: "failed", error: "TypeError" }]]);
    expect(h.svc.AddItem).not.toHaveBeenCalled();
  });
});
