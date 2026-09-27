/**
 * The background-removal model is downloaded once, checked against its SHA-256 and kept in
 * IndexedDB; a wrong or truncated file is never used or cached.
 */

import "fake-indexeddb/auto";
import { describe, test, expect, vi } from "vitest";
import { fetchWithProgress, loadModel, sha256Hex, type ModelRef } from "@/lib/expressions/workbench/modelCache";

const bytes = new Uint8Array(1000).map((_, i) => i % 251);

async function modelFor(data: Uint8Array, name: string): Promise<ModelRef> {
  return { name, path: `/models/${name}.onnx`, sha256: await sha256Hex(data.slice().buffer), bytes: data.length };
}

function fakeFetch(data: Uint8Array, chunk = 300) {
  return vi.fn(async (_url: string | URL | Request) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < data.length; at += chunk) controller.enqueue(data.slice(at, at + chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-length": String(data.length) } });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("model cache", () => {
  test("streams with progress to the end", async () => {
    const progress: number[] = [];
    const buffer = await fetchWithProgress("https://app.test/x", { fetchImpl: fakeFetch(bytes), onProgress: (v) => progress.push(v) });
    expect(new Uint8Array(buffer)).toEqual(bytes);
    expect(progress.at(-1)).toBe(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    expect(progress.length).toBeGreaterThan(2);
  });

  test("an HTTP error is an error, not a model", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchWithProgress("https://app.test/x", { fetchImpl })).rejects.toThrow("HTTP 404");
  });

  test("first use downloads from the app's origin and caches; the second comes from IndexedDB", async () => {
    const model = await modelFor(bytes, "first-use");
    const fetchImpl = fakeFetch(bytes);
    const a = await loadModel(model, { origin: "https://app.test", fetchImpl });
    expect(a.from).toBe("network");
    expect(fetchImpl).toHaveBeenCalledWith("https://app.test/models/first-use.onnx", expect.anything());
    expect(new Uint8Array(a.bytes)).toEqual(bytes);

    const b = await loadModel(model, { origin: "https://app.test", fetchImpl });
    expect(b.from).toBe("cache");
    expect(new Uint8Array(b.bytes)).toEqual(bytes);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a download that does not match the checksum is refused and not cached", async () => {
    const model = await modelFor(bytes, "tampered");
    const wrong = bytes.slice(0, 900);
    await expect(loadModel(model, { origin: "https://app.test", fetchImpl: fakeFetch(wrong) })).rejects.toThrow(/checksum mismatch/);
    const fetchImpl = fakeFetch(bytes);
    const again = await loadModel(model, { origin: "https://app.test", fetchImpl });
    expect(again.from).toBe("network");
  });

  test("a new version of the model replaces the old one in the cache", async () => {
    const v1 = await modelFor(bytes, "versioned");
    await loadModel(v1, { origin: "https://app.test", fetchImpl: fakeFetch(bytes) });
    const next = bytes.map((b) => 255 - b);
    const v2 = await modelFor(next, "versioned");
    const loaded = await loadModel(v2, { origin: "https://app.test", fetchImpl: fakeFetch(next) });
    expect(loaded.from).toBe("network");
    // v1 is gone: asking for it again downloads.
    const refetch = fakeFetch(bytes);
    expect((await loadModel(v1, { origin: "https://app.test", fetchImpl: refetch })).from).toBe("network");
  });
});
