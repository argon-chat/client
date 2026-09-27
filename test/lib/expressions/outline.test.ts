/**
 * Sticker outlines: the packed path format Telegram uses for vector thumbnails. A byte is a lookup
 * character (≥192), a number after ',' (≥128) or '-' (≥64), or a bare number (<64).
 */

import { describe, test, expect } from "vitest";
import { decodeOutline, outlineDataUrl, outlineSvg } from "@/lib/expressions/outline";

const char = (index: number) => 192 + index;

describe("decodeOutline", () => {
  test("no bytes is an empty path", () => {
    expect(decodeOutline(new Uint8Array([]))).toBe("Mz");
  });

  test("numbers, separators and commands", () => {
    // 12 ,34 l -5 ,6 z  (37 = 'l', 51 = 'z' in the lookup table)
    const bytes = new Uint8Array([12, 128 | 34, char(37), 64 | 5, 128 | 6, char(51)]);
    expect(decodeOutline(bytes)).toBe("M12,34l-5,6zz");
  });

  test("every lookup character", () => {
    const table = "AACAAAAHAAALMAAAQASTAVAAAZaacaaaahaaalmaaaqastava.az0123456789-,";
    const bytes = new Uint8Array(Array.from({ length: 64 }, (_, i) => char(i)));
    expect(decodeOutline(bytes)).toBe(`M${table}z`);
  });

  test("digits from the table extend a number past 63", () => {
    // 1, '0', '0' → 100; then ',' 63 → ",63"
    const bytes = new Uint8Array([1, char(52), char(52), 128 | 63]);
    expect(decodeOutline(bytes)).toBe("M100,63z");
  });

  test("a bare zero and the largest bare number", () => {
    expect(decodeOutline(new Uint8Array([0, 63]))).toBe("M063z");
  });
});

describe("outlineSvg", () => {
  test("wraps the path in a 512 view box by default", () => {
    const svg = outlineSvg(new Uint8Array([12, 128 | 34]));
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('d="M12,34z"');
    expect(svg.startsWith("<svg")).toBe(true);
  });

  test("custom size and a data URL", () => {
    expect(outlineSvg(new Uint8Array([]), 100, 50)).toContain('viewBox="0 0 100 50"');
    const url = outlineDataUrl(new Uint8Array([1]));
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(url)).toContain('d="M1z"');
  });
});
