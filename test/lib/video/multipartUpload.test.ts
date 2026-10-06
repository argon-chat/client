/**
 * The parts of a multipart video upload: each part's exact byte range, a bounded number in flight,
 * retries with backoff on a 5xx or a dropped connection (and not on a 4xx), the ETags back in part
 * order, a cancel that stops everything, and a bucket whose CORS hides the ETag named as such.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import type { VideoUploadTicket } from "@argon/glue";
import { partRanges, stripEtagQuotes, uploadVideoParts, type PartPut } from "@/lib/video/multipartUpload";
import { VideoPartUploadError } from "@/lib/video/errors";

const PAYLOAD = "abcdefghijklmnopqrstuvwxyz0123456789"; // 36 bytes

function ticket(partSize: number, count: number): VideoUploadTicket {
  return {
    ticketId: "t-1",
    fileId: "f-1",
    uploadUrl: null,
    formFields: [],
    partUrls: Array.from({ length: count }, (_, i) => `https://store/part/${i + 1}`),
    partSize: BigInt(partSize),
    ttlSeconds: 3600,
  };
}

const partNo = (url: string) => Number(url.split("/").at(-1));
const noWait = () => 0;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("partRanges", () => {
  test("part n is [(n - 1) · size, n · size), the last one shorter", () => {
    expect(partRanges(10, 4)).toEqual([
      { partNumber: 1, start: 0, end: 4 },
      { partNumber: 2, start: 4, end: 8 },
      { partNumber: 3, start: 8, end: 10 },
    ]);
    expect(partRanges(8, 4)).toHaveLength(2);
    expect(partRanges(3, 4)).toEqual([{ partNumber: 1, start: 0, end: 3 }]);
  });

  test("a part size of 0 is a broken ticket", () => {
    expect(() => partRanges(10, 0)).toThrow(VideoPartUploadError);
  });
});

test("stripEtagQuotes", () => {
  expect(stripEtagQuotes('"9b2cf535f27731c974343645a3985328"')).toBe("9b2cf535f27731c974343645a3985328");
  expect(stripEtagQuotes("plain")).toBe("plain");
});

describe("uploadVideoParts", () => {
  test("sends each part's bytes to its URL and returns the ETags in part order", async () => {
    const bodies = new Map<number, string>();
    // Later parts answer first, so the order of the result cannot come from completion order.
    const put: PartPut = async (url, body) => {
      const n = partNo(url);
      bodies.set(n, await body.text());
      await new Promise((r) => setTimeout(r, (5 - n) * 3));
      return { status: 200, etag: `"etag-${n}"` };
    };

    const parts = await uploadVideoParts(new Blob([PAYLOAD]), ticket(10, 4), { put, backoffMs: noWait });

    expect(parts).toEqual([1, 2, 3, 4].map((n) => ({ partNumber: n, etag: `etag-${n}` })));
    expect([...bodies.entries()].sort(([a], [b]) => a - b).map(([, text]) => text)).toEqual([
      "abcdefghij",
      "klmnopqrst",
      "uvwxyz0123",
      "456789",
    ]);
  });

  test("keeps at most `parallel` parts in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const put: PartPut = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { status: 200, etag: "e" };
    };

    await uploadVideoParts(new Blob([PAYLOAD]), ticket(4, 9), { put, parallel: 2 });
    expect(peak).toBe(2);
  });

  test("retries a 5xx and a dropped connection, with backoff", async () => {
    const answers = new Map<number, Array<"503" | "drop" | "ok">>([
      [1, ["503", "ok"]],
      [2, ["drop", "drop", "ok"]],
    ]);
    const calls: number[] = [];
    const put: PartPut = async (url) => {
      const n = partNo(url);
      calls.push(n);
      const next = answers.get(n)!.shift();
      if (next === "drop") throw new VideoPartUploadError("network");
      return next === "503" ? { status: 503, etag: null } : { status: 200, etag: `e${n}` };
    };
    const backoffMs = vi.fn((_attempt: number) => 0);

    const parts = await uploadVideoParts(new Blob([PAYLOAD]), ticket(18, 2), { put, retries: 3, backoffMs });

    expect(parts.map((p) => p.etag)).toEqual(["e1", "e2"]);
    expect(calls.filter((n) => n === 1)).toHaveLength(2);
    expect(calls.filter((n) => n === 2)).toHaveLength(3);
    expect(backoffMs.mock.calls.map(([attempt]) => attempt).sort()).toEqual([0, 0, 1]);
  });

  test("gives up after the retries", async () => {
    const put = vi.fn<PartPut>(async () => ({ status: 500, etag: null }));
    const error = await uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { put, retries: 2, backoffMs: noWait }).catch((e) => e);

    expect(error).toBeInstanceOf(VideoPartUploadError);
    expect(error).toMatchObject({ code: "http", status: 500, partNumber: 1 });
    expect(put).toHaveBeenCalledTimes(3);
  });

  test("does not retry a refusal", async () => {
    const put = vi.fn<PartPut>(async () => ({ status: 400, etag: null }));
    const error = await uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { put, retries: 3, backoffMs: noWait }).catch((e) => e);

    expect(error).toMatchObject({ code: "http", status: 400 });
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("a stored part without a readable ETag names the CORS header, and is not retried", async () => {
    const put = vi.fn<PartPut>(async () => ({ status: 200, etag: null }));
    const error = await uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { put, retries: 3, backoffMs: noWait }).catch((e) => e);

    expect(error).toMatchObject({ code: "etag-unavailable", partNumber: 1 });
    expect(error.message).toContain("Access-Control-Expose-Headers: ETag");
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("a ticket whose URLs do not match the size is refused before anything is sent", async () => {
    const put = vi.fn<PartPut>();
    const error = await uploadVideoParts(new Blob([PAYLOAD]), ticket(10, 3), { put }).catch((e) => e);
    expect(error).toMatchObject({ code: "bad-ticket" });
    expect(put).not.toHaveBeenCalled();
  });

  test("a cancel aborts the parts in flight and rejects as aborted", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const put: PartPut = (_url, _body, { signal }) =>
      new Promise((_, reject) => {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new VideoPartUploadError("aborted")));
      });

    const upload = uploadVideoParts(new Blob([PAYLOAD]), ticket(10, 4), { put, parallel: 2, signal: controller.signal });
    await tick();
    controller.abort();
    const error = await upload.catch((e) => e);

    expect(error).toMatchObject({ code: "aborted", name: "AbortError" });
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  test("one part failing stops the others", async () => {
    const signals: AbortSignal[] = [];
    const put: PartPut = (url, _body, { signal }) => {
      signals.push(signal);
      if (partNo(url) === 1) return Promise.resolve({ status: 400, etag: null });
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new VideoPartUploadError("aborted"))));
    };

    const error = await uploadVideoParts(new Blob([PAYLOAD]), ticket(10, 4), { put, parallel: 3 }).catch((e) => e);
    expect(error).toMatchObject({ code: "http", status: 400 });
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  test("reports bytes sent across parts, ending at the total", async () => {
    const seen: Array<[number, number]> = [];
    const put: PartPut = async (_url, body, { onProgress }) => {
      onProgress?.(Math.floor(body.size / 2));
      return { status: 200, etag: "e" };
    };

    await uploadVideoParts(new Blob([PAYLOAD]), ticket(10, 4), { put, parallel: 1, onProgress: (sent, total) => seen.push([sent, total]) });

    expect(seen.every(([, total]) => total === 36)).toBe(true);
    expect(seen.at(-1)).toEqual([36, 36]);
    const sent = seen.map(([s]) => s);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
  });
});


describe("review fixes", () => {
  test("weak and quoted ETags are stripped", async () => {
    expect(stripEtagQuotes('W/"abc"')).toBe("abc");
    expect(stripEtagQuotes(' w/"abc" ')).toBe("abc");
    const put: PartPut = async () => ({ status: 200, etag: 'W/"weak-1"' });
    expect(await uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { put })).toEqual([{ partNumber: 1, etag: "weak-1" }]);
  });

  test("a 403 is forbidden, not retried, not network", async () => {
    const put = vi.fn<PartPut>(async () => ({ status: 403, etag: null }));
    const error = await uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { put, retries: 3, backoffMs: noWait }).catch((e) => e);
    expect(error).toMatchObject({ code: "forbidden", status: 403, partNumber: 1 });
    expect(put).toHaveBeenCalledTimes(1);
  });

  test("each part gets the timeout; a timed-out part is retried", async () => {
    const timeouts: number[] = [];
    let calls = 0;
    const put: PartPut = async (_url, _body, { timeoutMs }) => {
      timeouts.push(timeoutMs);
      if (calls++ === 0) throw new VideoPartUploadError("network", "The part upload timed out");
      return { status: 200, etag: "e" };
    };
    await uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { put, timeoutMs: 1_234, backoffMs: noWait });
    expect(timeouts).toEqual([1_234, 1_234]);
  });

  test("progress never goes back, with three parts in flight and parts retried halfway", async () => {
    const failedOnce = new Set<number>();
    const put: PartPut = async (url, body, { onProgress }) => {
      const n = partNo(url);
      onProgress?.(Math.floor(body.size / 2));
      await tick();
      if ((n === 2 || n === 3) && !failedOnce.has(n)) {
        failedOnce.add(n);
        return { status: 503, etag: null };
      }
      onProgress?.(body.size);
      return { status: 200, etag: `e${n}` };
    };
    const seen: number[] = [];

    const parts = await uploadVideoParts(new Blob([PAYLOAD]), ticket(8, 5), {
      put,
      parallel: 3,
      backoffMs: noWait,
      onProgress: (sent) => seen.push(sent),
    });

    expect(parts.map((p) => p.etag)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(failedOnce).toEqual(new Set([2, 3]));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.at(-1)).toBe(36);
  });
});

describe("the XMLHttpRequest transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  interface Sent {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: Blob;
    timeout: number;
  }

  /** Each request answers with the next script entry (the last one repeats). */
  function fakeXhr(script: Array<{ status: number; etag: string | null } | "timeout">) {
    const sent: Sent[] = [];
    let call = 0;
    class FakeXhr {
      status = 0;
      timeout = 0;
      private method = "";
      private url = "";
      private headers: Record<string, string> = {};
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      private answer: { status: number; etag: string | null } | "timeout" = "timeout";
      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }
      getResponseHeader(name: string) {
        return name.toLowerCase() === "etag" && this.answer !== "timeout" ? this.answer.etag : null;
      }
      abort() {
        this.onabort?.();
      }
      send(body: Blob) {
        this.answer = script[Math.min(call++, script.length - 1)];
        sent.push({ method: this.method, url: this.url, headers: { ...this.headers }, body, timeout: this.timeout });
        setTimeout(() => {
          if (this.answer === "timeout") {
            this.ontimeout?.();
            this.onloadend?.();
            return;
          }
          this.upload.onprogress?.({ lengthComputable: true, loaded: body.size });
          this.status = this.answer.status;
          this.onload?.();
          this.onloadend?.();
        }, 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    return sent;
  }

  test("PUTs exactly each slot's bytes, untyped and with no headers of its own, and reads the ETag", async () => {
    const sent = fakeXhr([{ status: 200, etag: '"abc"' }]);
    const parts = await uploadVideoParts(new Blob([PAYLOAD], { type: "video/mp4" }), ticket(20, 2));

    expect(parts).toEqual([
      { partNumber: 1, etag: "abc" },
      { partNumber: 2, etag: "abc" },
    ]);
    const byUrl = [...sent].sort((a, b) => a.url.localeCompare(b.url));
    expect(byUrl.map((s) => `${s.method} ${s.url}`)).toEqual(["PUT https://store/part/1", "PUT https://store/part/2"]);
    expect(byUrl.map((s) => s.body.size)).toEqual([20, 16]);
    expect(await byUrl[1].body.text()).toBe(PAYLOAD.slice(20));
    expect(byUrl.every((s) => s.body.type === "" && Object.keys(s.headers).length === 0)).toBe(true);
    expect(byUrl.every((s) => s.timeout === 60_000)).toBe(true);
  });

  test("a timed-out PUT is retried", async () => {
    const sent = fakeXhr(["timeout", { status: 200, etag: "e" }]);
    const parts = await uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { backoffMs: noWait, timeoutMs: 5_000 });
    expect(parts).toEqual([{ partNumber: 1, etag: "e" }]);
    expect(sent).toHaveLength(2);
    expect(sent[0].timeout).toBe(5_000);
  });

  test("a hidden ETag header is etag-unavailable", async () => {
    fakeXhr([{ status: 200, etag: null }]);
    await expect(uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1))).rejects.toMatchObject({ code: "etag-unavailable" });
  });

  test("a 403 from the storage is forbidden", async () => {
    fakeXhr([{ status: 403, etag: null }]);
    await expect(uploadVideoParts(new Blob([PAYLOAD]), ticket(36, 1), { backoffMs: noWait })).rejects.toMatchObject({ code: "forbidden" });
  });
});
