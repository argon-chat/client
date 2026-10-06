/**
 * Where a video plays from: the direct storage URL the server names at `/files/{id}/url`, kept for
 * its ttl and shared between concurrent asks; the redirecting `/files/{id}` when that fails.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/store/system/fileStorage", () => ({ cdnFetchUrl: (id: string) => `https://api.test/files/${id}` }));
vi.mock("@argon/core", () => ({ logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } }));

import { clearMediaUrlCache, invalidateMediaUrl, resolveMediaUrl } from "@/lib/media/mediaUrl";

const DIRECT = "https://s3.eu.test/bucket/f1?X-Amz-Signature=abc";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(impl);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  clearMediaUrlCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveMediaUrl", () => {
  test("asks the url endpoint anonymously and answers with the direct url", async () => {
    const fetch = stubFetch(async () => json({ url: DIRECT, ttlSeconds: 300 }));
    await expect(resolveMediaUrl("f1")).resolves.toBe(DIRECT);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.test/files/f1/url");
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  });

  test("keeps the answer for its ttl less a margin, then asks again", async () => {
    const fetch = stubFetch(async () => json({ url: DIRECT, ttlSeconds: 300 }));
    await resolveMediaUrl("f1");
    vi.setSystemTime(Date.now() + 260_000);
    await resolveMediaUrl("f1");
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 20_000);
    await resolveMediaUrl("f1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("concurrent asks for one file share a request", async () => {
    let answer!: (r: Response) => void;
    const fetch = stubFetch(() => new Promise<Response>((resolve) => (answer = resolve)));
    const a = resolveMediaUrl("f1");
    const b = resolveMediaUrl("f1");
    answer(json({ url: DIRECT, ttlSeconds: 300 }));
    await expect(Promise.all([a, b])).resolves.toEqual([DIRECT, DIRECT]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("different files are asked separately", async () => {
    const fetch = stubFetch(async (url) => json({ url: url.replace("https://api.test/files/", "https://s3.test/").replace("/url", ""), ttlSeconds: 60 }));
    await expect(resolveMediaUrl("a")).resolves.toBe("https://s3.test/a");
    await expect(resolveMediaUrl("b")).resolves.toBe("https://s3.test/b");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("an endpoint that fails falls back to the file redirect, for half a minute", async () => {
    const fetch = stubFetch(async () => json({ error: "nope" }, 404));
    await expect(resolveMediaUrl("f1")).resolves.toBe("https://api.test/files/f1");
    await resolveMediaUrl("f1");
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31_000);
    await resolveMediaUrl("f1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a network error falls back too", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(resolveMediaUrl("f1")).resolves.toBe("https://api.test/files/f1");
  });

  test("an answer without a url, or with a scheme that is not http, is refused", async () => {
    stubFetch(async () => json({ ttlSeconds: 300 }));
    await expect(resolveMediaUrl("f1")).resolves.toBe("https://api.test/files/f1");
    clearMediaUrlCache();
    stubFetch(async () => json({ url: "javascript:alert(1)", ttlSeconds: 300 }));
    await expect(resolveMediaUrl("f1")).resolves.toBe("https://api.test/files/f1");
  });

  test("a relative url is taken against the api", async () => {
    stubFetch(async () => json({ url: "/mirror/f1", ttlSeconds: 300 }));
    await expect(resolveMediaUrl("f1")).resolves.toBe("https://api.test/mirror/f1");
  });

  test("a request that hangs gives up after 8 s, and everyone waiting on it gets the fallback", async () => {
    const timer = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timer.signal);
    const fetch = stubFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation timed out.", "TimeoutError"))),
        ),
    );
    const a = resolveMediaUrl("f1");
    const b = resolveMediaUrl("f1");
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(fetch.mock.calls[0][1]?.signal).toBe(timer.signal);
    timer.abort();
    await expect(Promise.all([a, b])).resolves.toEqual(["https://api.test/files/f1", "https://api.test/files/f1"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("invalidate forgets the answer", async () => {
    const fetch = stubFetch(async () => json({ url: DIRECT, ttlSeconds: 300 }));
    await resolveMediaUrl("f1");
    invalidateMediaUrl("f1");
    await resolveMediaUrl("f1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
