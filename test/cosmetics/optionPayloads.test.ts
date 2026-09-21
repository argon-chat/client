import { describe, expect, it } from "vitest";
import { parseAvatarDecorationPayload } from "@/cosmetics/kinds/avatar-decoration";
import { parseFontOptionPayload } from "@/cosmetics/kinds/option-font";
import { parseSwatchOptionPayload } from "@/cosmetics/kinds/option-swatch";
import {
  emptyNicknameStyleTuning,
  isNicknameStyleTuningEmpty,
  parseNicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";

/**
 * The small payloads, and the rules they share with the server that stores them.
 *
 * Each of these is checked twice on purpose — once where it is written and once where it is drawn —
 * because the two ends are released separately and a client older than a row has to refuse it
 * rather than render something nobody authored.
 */

describe("avatar decoration", () => {
  it("takes a whole-percent inset within reason", () => {
    expect(parseAvatarDecorationPayload({ insetPct: 12, beneath: true }))
      .toEqual({ insetPct: 12, beneath: true });

    expect(parseAvatarDecorationPayload({ insetPct: 0 })).toEqual({ insetPct: 0, beneath: false });
    expect(parseAvatarDecorationPayload({ insetPct: 41 })).toBeNull();
    expect(parseAvatarDecorationPayload({ insetPct: -1 })).toBeNull();

    // It was a double. A fraction of a percent of a forty-pixel avatar is not a measurement.
    expect(parseAvatarDecorationPayload({ insetPct: 12.5 })).toBeNull();
  });
});

describe("swatch option", () => {
  it("takes a colour as the integer it is", () => {
    expect(parseSwatchOptionPayload({ argb: 0xff112233 })).toEqual({ argb: 0xff112233 });
    expect(parseSwatchOptionPayload({ argb: -15729101 })).toEqual({ argb: -15729101 });
  });

  it("refuses a hex string, which is what it used to be", () => {
    expect(parseSwatchOptionPayload({ hex: "#112233" })).toBeNull();
    expect(parseSwatchOptionPayload({ argb: "#112233" })).toBeNull();
  });

  it("refuses a colour nobody can see", () => {
    expect(parseSwatchOptionPayload({ argb: 0x00112233 })).toBeNull();
  });
});

describe("font option", () => {
  it("takes a family name and nothing that reads as syntax", () => {
    expect(parseFontOptionPayload({ cssFamily: "Noto Sans JP" })).toEqual({ cssFamily: "Noto Sans JP" });
    expect(parseFontOptionPayload({ cssFamily: "Inter-Tight" })).toEqual({ cssFamily: "Inter-Tight" });

    expect(parseFontOptionPayload({ cssFamily: "Inter; } body {" })).toBeNull();
    expect(parseFontOptionPayload({ cssFamily: '"Inter"' })).toBeNull();
    expect(parseFontOptionPayload({ cssFamily: "" })).toBeNull();
    expect(parseFontOptionPayload({ cssFamily: "x".repeat(97) })).toBeNull();
  });
});

describe("nickname style tuning", () => {
  it("starts with nothing chosen", () => {
    const empty = emptyNicknameStyleTuning();

    expect(isNicknameStyleTuningEmpty(empty)).toBe(true);
    expect(empty.colors).toBeNull();
  });

  it("takes up to six colours as integers", () => {
    expect(parseNicknameStyleTuning({ colors: [1, 2, 3, 4, 5, 6] })?.colors).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseNicknameStyleTuning({ colors: [] })?.colors).toBeNull();
  });

  it("refuses a seventh colour rather than trimming to six", () => {
    // Trimming would draw a gradient its wearer did not choose and say nothing about it.
    expect(parseNicknameStyleTuning({ colors: [1, 2, 3, 4, 5, 6, 7] })).toBeNull();
  });

  it("refuses hex strings, which is what the colours used to be", () => {
    expect(parseNicknameStyleTuning({ colors: ["#112233"] })?.colors).toBeNull();
  });

  it("keeps a shape it knows and drops one it does not", () => {
    expect(parseNicknameStyleTuning({ shape: "conic" })?.shape).toBe("conic");
    expect(parseNicknameStyleTuning({ shape: "spiral" })?.shape).toBeNull();
  });

  it("bounds the weight and the letter spacing", () => {
    expect(parseNicknameStyleTuning({ weight: 700 })?.weight).toBe(700);
    expect(parseNicknameStyleTuning({ weight: 1000 })?.weight).toBeNull();

    expect(parseNicknameStyleTuning({ letterSpacingCentiEm: 8 })?.letterSpacingCentiEm).toBe(8);
    expect(parseNicknameStyleTuning({ letterSpacingCentiEm: -4 })?.letterSpacingCentiEm).toBe(-4);
    expect(parseNicknameStyleTuning({ letterSpacingCentiEm: 80 })?.letterSpacingCentiEm).toBeNull();
  });

  it("is not a payload: the kind is bare and has no catalogue rows", () => {
    expect(parseNicknameStyleTuning(null)).toBeNull();
    expect(parseNicknameStyleTuning("linear")).toBeNull();
  });
});
