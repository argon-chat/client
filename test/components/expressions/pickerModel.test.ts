/**
 * The expression picker's model: which sections there are and in what order, what a search shows,
 * the recent row, skin tones, and the layout the virtual grid and the category bar work from.
 */

import { describe, test, expect } from "vitest";
import type { EmojiEntry } from "@argon-chat/emojix";
import { ExpressionFormat, ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";
import {
  activeSectionIndex,
  buildEmojiSections,
  buildSearchSections,
  buildStickerSections,
  cellOffset,
  columnsFor,
  EMOJI_GRID,
  emojiWithTone,
  layoutGrid,
  packCover,
  pushRecentKey,
  recentEmojiCells,
  STICKER_GRID,
  visibleRowRange,
  type PickerSectionData,
} from "@/components/expressions/picker/pickerModel";

const label = (key: string) => `[${key}]`;

const entry = (id: string, codepoints: number[], extra: Partial<EmojiEntry> = {}): EmojiEntry => ({
  id,
  codepoints,
  hexcode: id,
  shortcode: id,
  category: "smileys",
  keywords: [],
  name: id,
  atlasRef: { atlasId: "smileys", x: 0, y: 0, size: 64 },
  ...extra,
});

const item = (itemId: string, kind = ExpressionKind.Emoji, extra: Partial<ExpressionItem> = {}): ExpressionItem => ({
  itemId,
  packId: "p",
  spaceId: "s1",
  kind,
  format: ExpressionFormat.Static,
  name: itemId,
  fileId: `f-${itemId}`,
  thumbFileId: null,
  width: 100,
  height: 100,
  fileSize: 1,
  emoji: ["😀"],
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder: 0,
  downloadUrl: null,
  thumbUrl: null,
  ...extra,
});

const pack = (packId: string, items: ExpressionItem[], extra: Partial<ExpressionPack> = {}): ExpressionPack => ({
  packId,
  spaceId: "s1",
  kind: items[0]?.kind ?? ExpressionKind.Emoji,
  title: `Pack ${packId}`,
  slug: packId,
  coverItemId: null,
  sortOrder: 0,
  version: 1n,
  items,
  ...extra,
});

const grin = entry("1f600", [0x1f600]);
const wave = entry("1f44b", [0x1f44b], { hasSkinTones: true, category: "people" });

describe("sections", () => {
  test("emoji tab: recent, the unicode groups, then the space's packs; empty ones left out", () => {
    const sections = buildEmojiSections({
      recent: [{ type: "unicode", key: "u:1f600", entry: grin }],
      groups: [
        { id: "smileys", entries: [grin] },
        { id: "people", entries: [wave] },
        { id: "flags", entries: [] },
      ],
      packs: [pack("a", [item("x"), item("y")]), pack("empty", [])],
      label,
    });
    expect(sections.map((s) => s.id)).toEqual(["recent", "smileys", "people", "pack:a"]);
    expect(sections[1].title).toBe("[expression_picker_group_smileys]");
    expect(sections[3]).toMatchObject({ title: "Pack a", icon: { type: "pack" } });
    expect(sections[3].cells.map((c) => c.type)).toEqual(["custom", "custom"]);
  });

  test("no recents, no recent section", () => {
    const sections = buildEmojiSections({ recent: [], groups: [{ id: "smileys", entries: [grin] }], packs: [], label });
    expect(sections.map((s) => s.id)).toEqual(["smileys"]);
  });

  test("sticker tab: recent stickers, then packs", () => {
    const s1 = item("s1", ExpressionKind.Sticker);
    const sections = buildStickerSections({ recent: [s1], packs: [pack("st", [s1, item("s2", ExpressionKind.Sticker)])], label });
    expect(sections.map((s) => s.id)).toEqual(["recent", "pack:st"]);
    expect(sections[0].cells[0]).toMatchObject({ type: "sticker", key: "s:s1" });
  });

  test("a pack's cover is its chosen item, else its first", () => {
    const a = item("a");
    const b = item("b");
    expect(packCover(pack("p", [a, b]))?.itemId).toBe("a");
    expect(packCover(pack("p", [a, b], { coverItemId: "b" }))?.itemId).toBe("b");
    expect(packCover(pack("p", [a], { coverItemId: "gone" }))?.itemId).toBe("a");
    expect(packCover(pack("p", []))).toBeNull();
  });
});

describe("search", () => {
  const deps = {
    unicode: (q: string) => (q === "grin" ? [grin] : []),
    custom: (q: string) => (q === "grin" ? [item("grin_custom")] : []),
    stickers: (q: string) => (q === "cat" ? [item("cat", ExpressionKind.Sticker)] : []),
    label,
  };

  test("emoji: the space's own before unicode", () => {
    const sections = buildSearchSections("emoji", " grin ", deps);
    expect(sections.map((s) => s.id)).toEqual(["search:custom", "search:unicode"]);
    expect(sections[0].cells[0]).toMatchObject({ type: "custom", key: "c:grin_custom" });
  });

  test("stickers: one section of matches", () => {
    expect(buildSearchSections("stickers", "cat", deps).map((s) => s.cells.length)).toEqual([1]);
    expect(buildSearchSections("stickers", "dog", deps)).toEqual([]);
  });

  test("an empty query searches nothing", () => {
    expect(buildSearchSections("emoji", "   ", deps)).toEqual([]);
  });
});

describe("recents", () => {
  test("a pick moves to the front, once, within the limit", () => {
    expect(pushRecentKey(["u:a", "c:b"], "c:b")).toEqual(["c:b", "u:a"]);
    expect(pushRecentKey(["u:a", "u:b", "u:c"], "u:d", 3)).toEqual(["u:d", "u:a", "u:b"]);
  });

  test("unicode and custom in pick order; unknown ones skipped; others used elsewhere at the end", () => {
    const x = item("x");
    const y = item("y");
    const cells = recentEmojiCells(
      ["c:x", "u:1f600", "u:gone", "c:gone"],
      { unicode: (id) => (id === "1f600" ? grin : undefined), custom: (id) => (id === "x" ? x : null) },
      [x, y],
    );
    expect(cells.map((c) => c.key)).toEqual(["c:x", "u:1f600", "c:y"]);
  });

  test("the row is capped", () => {
    const keys = Array.from({ length: 50 }, () => "u:1f600");
    expect(recentEmojiCells(keys, { unicode: () => grin, custom: () => null })).toHaveLength(1);
    const many = Array.from({ length: 40 }, (_, i) => item(`i${i}`));
    expect(recentEmojiCells([], { unicode: () => undefined, custom: () => null }, many, 32)).toHaveLength(32);
  });
});

describe("skin tones", () => {
  const cps = (s: string) => Array.from(s, (c) => c.codePointAt(0)!.toString(16));

  test("default and tone-less emoji stay as they are", () => {
    expect(emojiWithTone(wave, "default")).toBe("👋");
    expect(emojiWithTone(grin, "dark")).toBe("😀");
  });

  test("the modifier follows the base, taking the presentation selector's place", () => {
    expect(emojiWithTone(wave, "medium")).toBe("👋🏽");
    const pointUp = entry("261d", [0x261d, 0xfe0f], { hasSkinTones: true });
    expect(cps(emojiWithTone(pointUp, "light"))).toEqual(["261d", "1f3fb"]);
  });

  test("ZWJ sequences: the first person and each joined person", () => {
    const beard = entry("1f9d4-200d-2642-fe0f", [0x1f9d4, 0x200d, 0x2642, 0xfe0f], { hasSkinTones: true });
    expect(cps(emojiWithTone(beard, "dark"))).toEqual(["1f9d4", "1f3ff", "200d", "2642", "fe0f"]);
    const holding = entry("x", [0x1f9d1, 0x200d, 0x1f91d, 0x200d, 0x1f9d1], { hasSkinTones: true });
    expect(cps(emojiWithTone(holding, "mediumDark"))).toEqual(["1f9d1", "1f3fe", "200d", "1f91d", "200d", "1f9d1", "1f3fe"]);
  });
});

describe("layout", () => {
  const sections = (counts: number[]): PickerSectionData[] =>
    counts.map((n, i) => ({ id: `s${i}`, title: "", icon: { type: "recent" }, cells: Array.from({ length: n }, () => ({ type: "unicode" as const, key: "", entry: grin })) }));

  test("columns from the width: 42 px emoji and 72 px stickers with at least 4 px between", () => {
    expect(columnsFor(364, EMOJI_GRID)).toBe(8);
    expect(columnsFor(363, EMOJI_GRID)).toBe(7);
    expect(columnsFor(300, STICKER_GRID)).toBe(4);
    expect(columnsFor(10, STICKER_GRID)).toBe(1);
  });

  test("each section reserves header + rows before anything is mounted", () => {
    const layout = layoutGrid(sections([8, 9, 0]), 364, EMOJI_GRID);
    expect(layout.columns).toBe(8);
    const [a, b, c] = layout.sections;
    expect(a).toMatchObject({ top: 0, rows: 1, height: 32 + 42 + 8 });
    expect(b).toMatchObject({ top: 82, rows: 2, height: 32 + 84 + 8 });
    expect(c).toMatchObject({ top: 206, rows: 0, height: 40 });
    expect(layout.height).toBe(246);
  });

  test("sticker rows are 72 px apart by 4, and the spare width goes between the columns", () => {
    const layout = layoutGrid(sections([10]), 340, STICKER_GRID);
    expect(layout.columns).toBe(4);
    expect(layout.gapX).toBeCloseTo((340 - 4 * 72) / 3);
    expect(layout.sections[0].height).toBe(32 + 3 * 72 + 2 * 4 + 8);
    expect(cellOffset(layout, 0, 5)).toEqual({ top: 32 + 76, bottom: 32 + 76 + 72 });
  });

  test("only the rows near the viewport are mounted", () => {
    const layout = layoutGrid(sections([80]), 364, EMOJI_GRID); // 10 rows of 42
    const s = layout.sections[0];
    expect(visibleRowRange(s, EMOJI_GRID, 0, 100)).toEqual([0, 2]);
    expect(visibleRowRange(s, EMOJI_GRID, 200, 300)).toEqual([4, 7]);
    expect(visibleRowRange(s, EMOJI_GRID, 200, 300, 42)).toEqual([3, 8]);
    expect(visibleRowRange(s, EMOJI_GRID, 1000, 1200)).toEqual([0, 0]);
  });

  test("the current section is the one whose header sticks; at the very end, the last one", () => {
    const layout = layoutGrid(sections([80, 80, 8]), 364, EMOJI_GRID);
    const [, second, third] = layout.sections;
    expect(activeSectionIndex(layout, 0, 300)).toBe(0);
    expect(activeSectionIndex(layout, second.top - 10, 300)).toBe(0);
    expect(activeSectionIndex(layout, second.top, 300)).toBe(1);
    // Scrolled all the way down: the short last section can never reach the top.
    expect(activeSectionIndex(layout, layout.height - 300, 300)).toBe(2);
    expect(third.top).toBeGreaterThan(layout.height - 300);
    expect(activeSectionIndex(layoutGrid([], 364, EMOJI_GRID), 0, 300)).toBe(-1);
  });
});
