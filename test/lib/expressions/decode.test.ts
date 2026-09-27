/**
 * What the Lottie worker is handed: a TGS (gzipped JSON) or plain JSON, told apart by the gzip
 * magic bytes, and never inflated past the cap.
 */

import { describe, test, expect } from "vitest";
import { decodeLottieBytes, isGzip, LottieTooLargeError } from "@/lib/expressions/lottie/decode";

async function gzip(text: string): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  const buffer = await new Response(
    source.pipeThrough(new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>),
  ).arrayBuffer();
  return new Uint8Array(buffer);
}

describe("decodeLottieBytes", () => {
  test("plain JSON passes through", async () => {
    const json = '{"v":"5.7.4","fr":30}';
    expect(await decodeLottieBytes(new TextEncoder().encode(json).buffer)).toBe(json);
  });

  test("a TGS is gunzipped", async () => {
    const json = JSON.stringify({ v: "5.7.4", layers: new Array(100).fill({ ty: 4 }) });
    const tgs = await gzip(json);
    expect(isGzip(tgs)).toBe(true);
    expect(await decodeLottieBytes(tgs)).toBe(json);
  });

  test("inflating past the cap stops with an error", async () => {
    const tgs = await gzip("x".repeat(10_000));
    await expect(decodeLottieBytes(tgs, 1000)).rejects.toBeInstanceOf(LottieTooLargeError);
  });

  test("plain JSON past the cap is refused", async () => {
    await expect(decodeLottieBytes(new Uint8Array(2000), 1000)).rejects.toBeInstanceOf(LottieTooLargeError);
  });

  test("gzip is recognised by its magic bytes only", () => {
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 8]))).toBe(true);
    expect(isGzip(new Uint8Array([0x7b, 0x22]))).toBe(false);
    expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
  });
});
