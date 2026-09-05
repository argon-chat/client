/**
 * How a recorded key combination is stored and shown.
 *
 * The labels are what people read in the settings screen; the ordering and the naming of
 * right-side modifiers, raw keycodes and mouse buttons are the parts that are easy to get
 * subtly wrong and impossible to notice in a type check.
 */

import { describe, expect, test } from "vitest";
import {
  KEYBOARD,
  MOUSE,
  RAW_KEY_FLAG,
  chordEquals,
  chordLabels,
  chordText,
  isEmptyChord,
  normalizeChord,
  type HotkeyChord,
} from "@/lib/hotkeys/chord";

const kb = (...codes: number[]): HotkeyChord => ({ buttons: codes.map((code) => ({ device: KEYBOARD, code })) });
const mouse = (button: number) => ({ device: MOUSE, code: button });

const VK = { SHIFT_L: 0xa0, SHIFT_R: 0xa1, CTRL_L: 0xa2, CTRL_R: 0xa3, ALT_L: 0xa4, WIN_L: 0x5b, M: 0x4d, F5: 0x74, NUM7: 0x67 };

describe("labels", () => {
  test("modifiers come first, in Ctrl, Alt, Shift, Win order, then keys as pressed", () => {
    expect(chordLabels(kb(VK.M, VK.SHIFT_L, VK.WIN_L, VK.ALT_L, VK.CTRL_L), "win")).toEqual([
      "Ctrl", "Alt", "Shift", "Win", "M",
    ]);
  });

  test("right-side modifiers say so, since they are what people bind push-to-talk to", () => {
    expect(chordLabels(kb(VK.CTRL_R), "win")).toEqual(["Right Ctrl"]);
    expect(chordLabels(kb(VK.SHIFT_R, VK.F5), "win")).toEqual(["Right Shift", "F5"]);
  });

  test("macOS gets its own symbols", () => {
    expect(chordLabels(kb(VK.M, VK.WIN_L, VK.CTRL_L), "mac")).toEqual(["⌃", "⌘", "M"]);
    expect(chordLabels(kb(VK.ALT_L), "mac")).toEqual(["⌥"]);
  });

  test("keys VK has no code for are named from their raw keycode", () => {
    expect(chordLabels({ buttons: [{ device: KEYBOARD, code: RAW_KEY_FLAG | 0x0e1c }] }, "win")).toEqual(["Num Enter"]);
    expect(chordLabels({ buttons: [{ device: KEYBOARD, code: RAW_KEY_FLAG | 0xee47 }] }, "win")).toEqual(["Num Home"]);
    expect(chordLabels({ buttons: [{ device: KEYBOARD, code: RAW_KEY_FLAG | 0xabcd }] }, "win")).toEqual(["Key ABCD"]);
  });

  test("mouse buttons are named by number and sort after keys", () => {
    expect(chordLabels({ buttons: [mouse(4), { device: KEYBOARD, code: VK.CTRL_L }] }, "win")).toEqual(["Ctrl", "Mouse 4"]);
    expect(chordLabels({ buttons: [mouse(3)] }, "win")).toEqual(["Middle Click"]);
  });

  test("the numpad and function keys read as such", () => {
    expect(chordText(kb(VK.NUM7), "win")).toBe("Num 7");
    expect(chordText(kb(0x7b), "win")).toBe("F12");
    expect(chordText(kb(0x87), "win")).toBe("F24");
  });

  test("an empty chord has no labels", () => {
    expect(chordLabels(null)).toEqual([]);
    expect(chordLabels({ buttons: [] })).toEqual([]);
    expect(chordText(undefined)).toBe("");
  });
});

describe("equality and normalisation", () => {
  test("the same buttons in any order are the same chord", () => {
    expect(chordEquals(kb(VK.CTRL_L, VK.M), kb(VK.M, VK.CTRL_L))).toBe(true);
    expect(chordEquals(kb(VK.CTRL_L, VK.M), kb(VK.CTRL_R, VK.M))).toBe(false);
    expect(chordEquals(kb(VK.M), { buttons: [mouse(4)] })).toBe(false);
  });

  test("a keyboard key and a mouse button with the same number are different", () => {
    expect(chordEquals({ buttons: [{ device: KEYBOARD, code: 4 }] }, { buttons: [mouse(4)] })).toBe(false);
  });

  test("empty chords equal each other and nothing else", () => {
    expect(chordEquals(null, { buttons: [] })).toBe(true);
    expect(chordEquals(null, kb(VK.M))).toBe(false);
    expect(isEmptyChord(kb(VK.M))).toBe(false);
  });

  test("normalising drops duplicates and stores the display order", () => {
    const chord = normalizeChord({
      buttons: [
        { device: KEYBOARD, code: VK.M },
        { device: KEYBOARD, code: VK.CTRL_L },
        { device: KEYBOARD, code: VK.M },
        mouse(5),
      ],
    });
    expect(chord.buttons).toEqual([
      { device: KEYBOARD, code: VK.CTRL_L },
      { device: KEYBOARD, code: VK.M },
      mouse(5),
    ]);
  });
});
