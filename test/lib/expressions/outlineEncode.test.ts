/**
 * encodeOutline is the inverse of decodeOutline, byte for byte the server's OutlineCodec.Encode: a
 * digit run becomes chunks of 0..63 without leading zeros, the first carrying the ',' or '-' before it.
 */

import { describe, test, expect } from "vitest";
import { decodeOutline, encodeOutline } from "@/lib/expressions/outline";

const char = (c: string) => 192 + "AACAAAAHAAALMAAAQASTAVAAAZaacaaaahaaalmaaaqastava.az0123456789-,".indexOf(c);

describe("encodeOutline", () => {
  test("a hand-built vector decodes and encodes back to the same bytes", () => {
    // 12 ,34 l -5 ,6  →  M12,34l-5,6z
    const bytes = new Uint8Array([12, 128 | 34, char("l"), 64 | 5, 128 | 6]);
    expect(decodeOutline(bytes)).toBe("M12,34l-5,6z");
    expect(Array.from(encodeOutline("M12,34l-5,6z"))).toEqual(Array.from(bytes));
  });

  test("numbers past 63 are split into chunks, as the server splits them", () => {
    expect(Array.from(encodeOutline("M512,0z"))).toEqual([51, 2, 128 | 0]);
    expect(Array.from(encodeOutline("M100,640z"))).toEqual([10, 0, 128 | 6, 40]);
    expect(Array.from(encodeOutline("M0,63l-64,63z"))).toEqual([0, 128 | 63, char("l"), 64 | 6, 4, 128 | 63]);
  });

  test("an empty body is no bytes", () => {
    expect(encodeOutline("Mz").length).toBe(0);
  });

  test("round trips: multi-digit numbers, negatives, several rings", () => {
    const paths = [
      "M0,0l512,0,0,512-512,0z",
      "M256,96l93,38,38,93-38,93-93,38-93-38-38-93,38-93,93-38z",
      "M128,64l256,0,0,384-256,0zM192,160l0,192,128,0,0-192z",
      "M1,2l-3,4-5,6,7,8z",
      "M100,100l-100-100,412,412z",
      "M63,64l-63-64,0,0,1000,10000z",
    ];
    for (const path of paths) expect(decodeOutline(encodeOutline(path))).toBe(path);
  });

  test("random paths round trip", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let run = 0; run < 200; run++) {
      let path = `M${rand(513)},${rand(513)}l`;
      const points = 3 + rand(20);
      for (let i = 0; i < points; i++) {
        const dx = rand(1025) - 512;
        const dy = rand(1025) - 512;
        path += i === 0 || dx < 0 ? `${dx}` : `,${dx}`;
        path += dy < 0 ? `${dy}` : `,${dy}`;
      }
      path += "z";
      expect(decodeOutline(encodeOutline(path))).toBe(path);
    }
  });

  test("anything the format cannot hold is refused", () => {
    expect(() => encodeOutline("12,34z")).toThrow();
    expect(() => encodeOutline("M12,34")).toThrow();
    expect(() => encodeOutline("M1 2z")).toThrow();
    expect(() => encodeOutline("M1,2x3z")).toThrow();
  });
});
