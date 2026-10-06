/**
 * The MP4 box scan behind the fast-start check and the preload prefix: top-level box headers only,
 * 32- and 64-bit sizes, a box that runs to the end of the file, and garbage.
 */

import { describe, test, expect } from "vitest";
import { isFastStart, readTopLevelBoxes, scanFastStart } from "@/lib/video/mp4Boxes";
import { computePreloadPrefixSize } from "@/lib/video/preloadPrefix";

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** A box of `size` bytes in total (header included), zero-filled. */
function box(type: string, size: number): number[] {
  return [...be32(size), ...ascii(type), ...new Array(size - 8).fill(0)];
}

/** A box with a 64-bit size field. */
function largeBox(type: string, size: number): number[] {
  return [...be32(1), ...ascii(type), ...be32(Math.floor(size / 2 ** 32)), ...be32(size >>> 0), ...new Array(size - 16).fill(0)];
}

/** A box whose size field is 0: it runs to the end of the file. */
function openBox(type: string, size: number): number[] {
  return [...be32(0), ...ascii(type), ...new Array(size - 8).fill(0)];
}

const file = (...boxes: number[][]) => new Uint8Array(boxes.flat());

describe("readTopLevelBoxes", () => {
  test("lists the boxes with offsets and sizes", async () => {
    const bytes = file(box("ftyp", 32), box("moov", 1000), box("mdat", 5000));
    expect(await readTopLevelBoxes(bytes)).toEqual([
      { type: "ftyp", offset: 0, size: 32, headerSize: 8 },
      { type: "moov", offset: 32, size: 1000, headerSize: 8 },
      { type: "mdat", offset: 1032, size: 5000, headerSize: 8 },
    ]);
  });

  test("reads a Blob the same way, without reading the media", async () => {
    const bytes = file(box("ftyp", 24), box("free", 16), box("moov", 200), largeBox("mdat", 4096));
    const boxes = await readTopLevelBoxes(new Blob([bytes]));
    expect(boxes.map((b) => [b.type, b.offset, b.size, b.headerSize])).toEqual([
      ["ftyp", 0, 24, 8],
      ["free", 24, 16, 8],
      ["moov", 40, 200, 8],
      ["mdat", 240, 4096, 16],
    ]);
  });

  test("a size of 0 runs to the end", async () => {
    const boxes = await readTopLevelBoxes(file(box("ftyp", 16), box("moov", 64), openBox("mdat", 300)));
    expect(boxes.at(-1)).toEqual({ type: "mdat", offset: 80, size: 300, headerSize: 8 });
  });

  test("stops at garbage", async () => {
    const bytes = file(box("ftyp", 16), [0, 0, 0, 4, 1, 2, 3, 4, 9, 9]);
    expect((await readTopLevelBoxes(bytes)).map((b) => b.type)).toEqual(["ftyp"]);
  });

  test("stops where asked", async () => {
    const bytes = file(box("ftyp", 16), box("moov", 64), box("mdat", 64), box("free", 16));
    expect((await readTopLevelBoxes(bytes, { until: (b) => b.type === "moov" })).map((b) => b.type)).toEqual(["ftyp", "moov"]);
  });
});

describe("fast start", () => {
  test.each([
    ["ftyp, moov, mdat", file(box("ftyp", 16), box("moov", 64), box("mdat", 64)), true],
    ["ftyp, free, moov, mdat", file(box("ftyp", 16), box("free", 8), box("moov", 64), box("mdat", 64)), true],
    ["ftyp, mdat, moov", file(box("ftyp", 16), box("mdat", 64), box("moov", 64)), false],
    ["no ftyp first", file(box("moov", 64), box("ftyp", 16), box("mdat", 64)), false],
    ["no moov", file(box("ftyp", 16), box("mdat", 64)), false],
    ["not an MP4", new Uint8Array(ascii("\x1aE\xdf\xa3 webm header bytes")), false],
  ])("%s → %s", async (_, bytes, expected) => {
    expect(isFastStart(await readTopLevelBoxes(bytes))).toBe(expected);
    expect(await scanFastStart(new Blob([bytes]))).toBe(expected);
  });
});

describe("computePreloadPrefixSize", () => {
  const mp4 = file(box("ftyp", 32), box("moov", 1000), box("mdat", 100_008));

  test("the end of moov plus 1.5 s at the bitrate", async () => {
    // 80 kbps → 10 000 B/s → 15 000 B.
    expect(await computePreloadPrefixSize(mp4, 80_000)).toBe(1032 + 15_000);
    expect(await computePreloadPrefixSize(new Blob([mp4]), 80_000)).toBe(1032 + 15_000);
  });

  test("never past the end of the file", async () => {
    expect(await computePreloadPrefixSize(mp4, 8_000_000)).toBe(mp4.length);
  });

  test("just the header without a bitrate", async () => {
    expect(await computePreloadPrefixSize(mp4, 0)).toBe(1032);
    expect(await computePreloadPrefixSize(mp4, Number.NaN)).toBe(1032);
  });

  test("moov at the end: the whole file", async () => {
    const tail = file(box("ftyp", 32), box("mdat", 5000), box("moov", 500));
    expect(await computePreloadPrefixSize(tail, 80_000)).toBe(tail.length);
  });

  test("0 without a moov", async () => {
    expect(await computePreloadPrefixSize(file(box("ftyp", 32), box("mdat", 500)), 80_000)).toBe(0);
  });
});
