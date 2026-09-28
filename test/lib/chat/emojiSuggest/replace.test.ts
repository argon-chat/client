/**
 * Instant replacements while typing, over the package's real emoticon and shortcode tables: an
 * immediate emoticon (`:)`) at its last character, a letter-ending one (`:D`) only at the next
 * boundary (which stays), `:code:` on its closing colon (a custom emoji of that name first), the
 * text table with `<3` as ❤️ when emoticons are on; never inside `code`. Backspace right after one
 * puts the typed text back.
 */

import { describe, expect, test } from "vitest";
import { emoticonBefore, shortcodeExact } from "@argon-chat/emojix";
import {
  HEART_HEXCODE,
  insideInlineCode,
  replacementBeforeBreak,
  replacementForTyped,
  revertTarget,
  typedAt,
  type ReplaceDeps,
  type TypedInput,
} from "@/lib/chat/emojiSuggest/replace";

const deps = (custom: string[] = []): ReplaceDeps => ({
  emoticonBefore,
  shortcodeExact,
  hasCustomEmoji: (name) => custom.includes(name.toLowerCase()),
});

/** `text` typed up to the caret (default: its end), the last `typed` characters just now. */
function typing(text: string, typed: string, over: Partial<TypedInput> = {}, custom: string[] = []) {
  return replacementForTyped({ text, caret: text.length, typed, emoticons: true, placed: [], ...over }, deps(custom));
}

describe("emoticons", () => {
  test("an immediate one is replaced at its last character; a space follows only when nothing does", () => {
    expect(typing(":)", ")")).toEqual({ start: 0, end: 2, content: { kind: "unicode", hexcode: "1f642" }, keep: 0, trailingSpace: true });
    expect(typing("hi :(", "(")).toMatchObject({ start: 3, end: 5, content: { hexcode: "2639" } });
    expect(typing("hi :) there", ")", { caret: 5 })).toMatchObject({ start: 3, end: 5, trailingSpace: false });
  });

  test("one ending in a letter waits for the next boundary, which stays", () => {
    expect(typing(":D", "D")).toBeNull();
    expect(typing(":D ", " ")).toEqual({ start: 0, end: 2, content: { kind: "unicode", hexcode: "1f604" }, keep: 1, trailingSpace: false });
    expect(typing("so xD,", ",")).toMatchObject({ start: 3, end: 5, keep: 1, content: { hexcode: "1f606" } });
    expect(typing(":Da", "a")).toBeNull();
    expect(typing(":P!", "!")).toMatchObject({ start: 0, end: 2, keep: 1 });
  });

  test("a line break about to be typed replaces the waiting one", () => {
    expect(replacementBeforeBreak(":D", 2, [], deps())).toMatchObject({ start: 0, end: 2, keep: 0, trailingSpace: false });
    expect(replacementBeforeBreak(":)", 2, [], deps())).toBeNull();
    expect(replacementBeforeBreak("`:D", 3, [], deps())).toBeNull();
  });

  test("only at the start or after whitespace", () => {
    expect(typing("a:)", ")")).toBeNull();
    expect(typing("12:30", "0")).toBeNull();
  });

  test("off: emoticons stay as typed", () => {
    expect(typing(":)", ")", { emoticons: false })).toBeNull();
    expect(typing(":D ", " ", { emoticons: false })).toBeNull();
  });
});

describe("`:code:` on the closing colon", () => {
  test("a shortcode becomes its emoji", () => {
    expect(typing(":joy:", ":")).toEqual({ start: 0, end: 5, content: { kind: "unicode", hexcode: "1f602" }, keep: 0, trailingSpace: true });
    expect(typing("so :Joy:", ":")).toMatchObject({ start: 3, content: { hexcode: "1f602" } });
    expect(typing(":+1:", ":")).toMatchObject({ content: { kind: "unicode" } });
  });

  test("a custom emoji of that name comes first", () => {
    expect(typing(":joy:", ":", {}, ["joy"])).toMatchObject({ content: { kind: "custom", name: "joy" } });
    expect(typing(":pepe_cry:", ":", {}, ["pepe_cry"])).toMatchObject({ start: 0, end: 10, content: { kind: "custom", name: "pepe_cry" } });
  });

  test("not an unknown code, a time, or the closing colon of a placeholder", () => {
    expect(typing(":nosuchcode:", ":")).toBeNull();
    expect(typing("12:30:", ":")).toBeNull();
    expect(typing(":wave:joy:", ":", { placed: [{ offset: 0, length: 6 }] })).toBeNull();
    expect(typing(":wave::joy:", ":", { placed: [{ offset: 0, length: 6 }] })).toMatchObject({ start: 6 });
  });

  test("off with emoticons", () => {
    expect(typing(":joy:", ":", { emoticons: false })).toBeNull();
  });
});

describe("the text table", () => {
  test("replaced as typed, no space added", () => {
    expect(typing("a--", "-")).toEqual({ start: 1, end: 3, content: { kind: "text", text: "—" }, keep: 0, trailingSpace: false });
    expect(typing("x->", ">")).toMatchObject({ content: { text: "→" } });
    expect(typing("(shrug)", ")")).toMatchObject({ content: { text: "¯\\_(ツ)_/¯" } });
  });

  test("`<3` is ❤️ with emoticons on, ♥ with them off", () => {
    expect(typing("I<3", "3")).toMatchObject({ start: 1, content: { kind: "unicode", hexcode: HEART_HEXCODE }, trailingSpace: true });
    expect(typing("<3", "3")).toMatchObject({ content: { kind: "unicode" } });
    expect(typing("I<3", "3", { emoticons: false })).toMatchObject({ content: { kind: "text", text: "♥" } });
  });
});

describe("inline code", () => {
  test("nothing is replaced between backticks", () => {
    expect(insideInlineCode("`a")).toBe(true);
    expect(insideInlineCode("`a` b")).toBe(false);
    expect(typing("`:)", ")")).toBeNull();
    expect(typing("`a--", "-")).toBeNull();
    expect(typing("`a` :)", ")")).toMatchObject({ start: 4 });
  });
});

describe("what was typed", () => {
  test("the text inserted right before the caret, and nothing else", () => {
    expect(typedAt("ab", "abc", 3)).toBe("c");
    expect(typedAt("ab", "abb", 2)).toBe("b");
    expect(typedAt("ab", "xab", 1)).toBe("x");
    expect(typedAt("ab", "ab😀", 4)).toBe("😀");
    expect(typedAt("abc", "ab", 2)).toBeNull();
    expect(typedAt("ab", "xy", 2)).toBeNull();
    expect(typedAt("ab", "abc", 2)).toBeNull();
  });
});

describe("Backspace right after a replacement", () => {
  test("puts the typed text back when the caret is still right after it", () => {
    const record = { start: 0, inserted: "🙂 ", original: ":)", keep: 0 };
    expect(revertTarget(record, "🙂 ", 3)).toEqual({ start: 0, end: 3, original: ":)", caret: 2 });
    expect(revertTarget(record, "🙂 ", 2)).toBeNull();
    expect(revertTarget(record, "😀 ", 3)).toBeNull();
  });

  test("the boundary after `:D` stays where it was", () => {
    const record = { start: 3, inserted: "😄", original: ":D", keep: 1 };
    expect(revertTarget(record, "hi 😄 ", 6)).toEqual({ start: 3, end: 5, original: ":D", caret: 6 });
  });

  test("a custom emoji reads as its `:name:`: the text is the same, the placeholder goes", () => {
    const record = { start: 0, inserted: ":joy: ", original: ":joy:", keep: 0 };
    expect(revertTarget(record, ":joy: ", 6)).toEqual({ start: 0, end: 6, original: ":joy:", caret: 5 });
  });
});
