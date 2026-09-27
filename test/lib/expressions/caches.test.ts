/**
 * The render stack's caches: the byte-bounded LRU, the sticker bytes and first-frame caches built
 * on it, and the workers' shared frame cache.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ByteLru } from "@/lib/expressions/lru";
import { bytesCache, getPreview, loadExpressionBytes, previewCache, putPreview } from "@/lib/expressions/files";
import { FrameCache } from "@/lib/expressions/lottie/frameCache";

const bitmap = (width: number, height = width) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;

describe("ByteLru", () => {
  const make = (maxEntries: number, maxBytes: number) => {
    const evicted: string[] = [];
    const lru = new ByteLru<string, string>({
      maxEntries,
      maxBytes,
      sizeOf: (v) => v.length,
      onEvict: (v) => evicted.push(v),
    });
    return { lru, evicted };
  };

  test("drops the least recently used past the entry limit", () => {
    const { lru, evicted } = make(2, 100);
    lru.set("a", "A");
    lru.set("b", "B");
    lru.get("a");
    lru.set("c", "C");
    expect(evicted).toEqual(["B"]);
    expect([...["a", "b", "c"].filter((k) => lru.has(k))]).toEqual(["a", "c"]);
  });

  test("drops as many as needed past the byte limit", () => {
    const { lru, evicted } = make(10, 10);
    lru.set("a", "aaaa");
    lru.set("b", "bbbb");
    lru.set("c", "cccccccc");
    expect(evicted).toEqual(["aaaa", "bbbb"]);
    expect(lru.bytes).toBe(8);
    expect(lru.size).toBe(1);
  });

  test("a value larger than the whole budget is refused and left to the caller", () => {
    const { lru, evicted } = make(10, 4);
    expect(lru.set("a", "12345")).toBe(false);
    expect(lru.has("a")).toBe(false);
    expect(evicted).toEqual([]);
  });

  test("replacing, deleting and clearing hand the old values to onEvict", () => {
    const { lru, evicted } = make(10, 100);
    lru.set("a", "one");
    lru.set("a", "two");
    lru.set("b", "three");
    lru.delete("b");
    lru.clear();
    expect(evicted).toEqual(["one", "three", "two"]);
    expect(lru.bytes).toBe(0);
  });

  test("peek does not refresh recency", () => {
    const { lru, evicted } = make(2, 100);
    lru.set("a", "A");
    lru.set("b", "B");
    lru.peek("a");
    lru.set("c", "C");
    expect(evicted).toEqual(["A"]);
  });
});

describe("loadExpressionBytes", () => {
  beforeEach(() => {
    bytesCache.clear();
    vi.unstubAllGlobals();
  });

  test("one request for concurrent callers, then served from memory", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([loadExpressionBytes("f1", "u1"), loadExpressionBytes("f1", "u1")]);
    expect(a).toBe(b);
    expect(new Uint8Array(a)).toEqual(new Uint8Array([1, 2, 3]));
    await loadExpressionBytes("f1", "u1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a failed response is not cached", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadExpressionBytes("f2", "u2")).rejects.toThrow(/404/);
    await expect(loadExpressionBytes("f2", "u2")).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("a URL that cannot be fetched at all falls back", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "app://cdn/f3") throw new TypeError("Failed to fetch");
      return new Response(new Uint8Array([9]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await loadExpressionBytes("f3", "app://cdn/f3", "https://api/files/f3");
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([9]));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["app://cdn/f3", "https://api/files/f3"]);
  });

  test("keeps 32 files at most", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(10))));
    for (let i = 0; i < 40; i++) await loadExpressionBytes(`file-${i}`, `u${i}`);
    expect(bytesCache.size).toBe(32);
    expect(bytesCache.has("file-0")).toBe(false);
    expect(bytesCache.has("file-39")).toBe(true);
  });
});

describe("previewCache", () => {
  beforeEach(() => previewCache.clear());

  test("keeps the largest first frame per file and tone, closing the others", () => {
    const small = bitmap(50);
    const large = bitmap(100);
    const smaller = bitmap(20);
    putPreview("s", 0, small);
    putPreview("s", 0, large);
    putPreview("s", 0, smaller);
    expect(getPreview("s", 0)).toBe(large);
    expect(small.close).toHaveBeenCalled();
    expect(smaller.close).toHaveBeenCalled();
    expect(large.close).not.toHaveBeenCalled();
    expect(getPreview("s", 2)).toBeUndefined();
    expect(getPreview("s", null)).toBe(large); // no tone is tone 0
  });

  test("is bounded to 8 MiB, closing what it drops", () => {
    const first = bitmap(1024); // 4 MiB
    putPreview("a", 0, first);
    putPreview("b", 0, bitmap(1024));
    putPreview("c", 0, bitmap(1024));
    expect(previewCache.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(getPreview("a", 0)).toBeUndefined();
    expect(first.close).toHaveBeenCalled();
  });
});

describe("FrameCache", () => {
  const frame = (bytes: number) => ({ bytes, close: vi.fn() });
  const make = (budget: number) => new FrameCache<{ bytes: number; close: () => void }>((f) => f.bytes, budget);

  test("players of one key share the entry and its frames", () => {
    const cache = make(100);
    const a = cache.acquire("k", 1);
    const b = cache.acquire("k", 2);
    expect(a).toBe(b);
    const f = frame(10);
    expect(cache.put(a, 0, f)).toBe(true);
    expect(cache.get(b, 0)).toBe(f);
    expect(cache.put(a, 0, frame(10))).toBe(false); // already there: the caller keeps its own
  });

  test("an entry nobody references survives until the budget needs its room", () => {
    const cache = make(30);
    const old = cache.acquire("old", 1);
    const oldFrame = frame(20);
    cache.put(old, 0, oldFrame);
    cache.release(old, 1);
    expect(cache.peek("old")).toBe(old);
    expect(oldFrame.close).not.toHaveBeenCalled();

    const next = cache.acquire("new", 2);
    expect(cache.put(next, 0, frame(20))).toBe(true);
    expect(cache.peek("old")).toBeUndefined();
    expect(oldFrame.close).toHaveBeenCalled();
    expect(cache.totalBytes).toBe(20);
  });

  test("least recently used unreferenced entries go first", () => {
    const cache = make(30);
    for (const key of ["a", "b"]) {
      const e = cache.acquire(key, 1);
      cache.put(e, 0, frame(10));
      cache.release(e, 1);
    }
    cache.get(cache.acquire("a", 3), 0); // touch a
    cache.release(cache.peek("a")!, 3);
    const c = cache.acquire("c", 4);
    cache.put(c, 0, frame(15));
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("a")).toBeDefined();
  });

  test("referenced entries are never evicted: new frames are refused instead", () => {
    const cache = make(25);
    const a = cache.acquire("a", 1);
    const b = cache.acquire("b", 2);
    expect(cache.put(a, 0, frame(20))).toBe(true);
    const refused = frame(10);
    expect(cache.put(b, 0, refused)).toBe(false);
    expect(refused.close).not.toHaveBeenCalled();
    expect(cache.get(a, 0)).toBeDefined();
  });

  test("a lower budget evicts at once", () => {
    const cache = make(100);
    const e = cache.acquire("a", 1);
    const f = frame(50);
    cache.put(e, 0, f);
    cache.release(e, 1);
    cache.setBudget(10);
    expect(f.close).toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });
});
