/**
 * The bounds a wearer's weight and letter spacing are held to before they reach the server: weight
 * 100–900 in hundreds, letter spacing −10…50 hundredths of an em. Anything past them would come
 * back as VALUE_OUT_OF_RANGE.
 */

import {
  describe,
  expect,
  test,
} from "vitest";

import {
  emptyNicknameStyleTuning,
  parseNicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import {
  withLetterSpacing,
  withWeight,
} from "@/cosmetics/tuning/nicknameTuningEdits";

describe("weight", () => {
  test("snaps to hundreds within 100–900", () => {
    const tuning = emptyNicknameStyleTuning();

    expect(withWeight(tuning, 640).weight).toBe(600);
    expect(withWeight(tuning, 20).weight).toBe(100);
    expect(withWeight(tuning, 1500).weight).toBe(900);
    expect(withWeight(tuning, Number.NaN).weight).toBeNull();
    expect(withWeight(withWeight(tuning, 700), null).weight).toBeNull();
  });
});

describe("letter spacing", () => {
  test("whole hundredths of an em within −10…50", () => {
    const tuning = emptyNicknameStyleTuning();

    expect(withLetterSpacing(tuning, 12.4).letterSpacingCentiEm).toBe(12);
    expect(withLetterSpacing(tuning, -40).letterSpacingCentiEm).toBe(-10);
    expect(withLetterSpacing(tuning, 80).letterSpacingCentiEm).toBe(50);
    expect(withLetterSpacing(withLetterSpacing(tuning, 5), null).letterSpacingCentiEm).toBeNull();
  });

  test("whatever the editor produces, the upstream parser accepts", () => {
    const tuning = withLetterSpacing(withWeight(emptyNicknameStyleTuning(), 9999), -999);

    expect(parseNicknameStyleTuning(tuning)).toEqual(tuning);
  });
});
