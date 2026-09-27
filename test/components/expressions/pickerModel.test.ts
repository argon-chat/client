/**
 * The expression picker's model: which groups there are and in what order, the rail beside them,
 * what a search shows, the recent row, skin tones, and the layout the virtual grid and the rail
 * work from.
 */

import { describe, test, expect } from "vitest";
import type { EmojiEntry } from "@argon-chat/emojix";
import { ExpressionFormat, ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";
import {
  activeGroupIndex,
  buildEmojiGroups,
  buildRail,
  buildSearchGroups,
  buildStickerGroups,
  cellOffset,
  columnsFor,
  EMOJI_GRID,
  emojiWithTone,
  layoutGrid,
  packCover,
  pushRecentKey,
  recentEmojiCells,
  STICKER_GRID,
  tonedEntry,
  visibleRowRange,
  type PickerCell,
  type PickerGroup,
  type SpaceInfo,
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
  creatorId: null,
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
  creatorId: null,
  ...extra,
});

const space = (spaceId: string, name = `Space ${spaceId}`): SpaceInfo => ({ spaceId, name, avatarFileId: null });

const grin = entry("1f600", [0x1f600]);
const wave = entry("1f44b", [0x1f44b], { hasSkinTones: true, category: "people" });

const ids = (groups: PickerGroup[]) => groups.map((g) => g.id);

describe("emoji groups", () => {
  test("recent, then each space with emoji, then the unicode groups; empty ones left out", () => {
    const groups = buildEmojiGroups({
      recent: [{ type: "unicode", key: "u:1f600", entry: grin }],
      spaces: [
        { space: space("a"), packs: [pack("a1", [item("x"), item("y")]), pack("empty", [])] },
        { space: space("b"), packs: [] },
      ],
      unicode: [
        { id: "smileys", entries: [grin] },
        { id: "people", entries: [wave] },
        { id: "flags", entries: [] },
      ],
      label,
    });
    expect(ids(groups)).toEqual(["recent", "space:a", "smileys", "people"]);
    expect(groups[0].title).toBe("[expression_picker_recent]");
    expect(groups[1]).toMatchObject({ title: "Space a", kind: { type: "space", space: { spaceId: "a" } } });
    // One pack: no sub-header, the space's header says it all.
    expect(groups[1].sections).toHaveLength(1);
    expect(groups[1].sections[0]).toMatchObject({ id: "pack:a1", title: null });
    expect(groups[1].sections[0].cells.map((c) => c.type)).toEqual(["custom", "custom"]);
    expect(groups[2].title).toBe("[expression_picker_group_smileys]");
  });

  test("a space with several packs: one group, the packs as titled sections under it", () => {
    const groups = buildEmojiGroups({
      recent: [],
      spaces: [{ space: space("a"), packs: [pack("one", [item("x")]), pack("two", [item("y"), item("z")])] }],
      unicode: [],
      label,
    });
    expect(ids(groups)).toEqual(["space:a"]);
    expect(groups[0].sections.map((s) => [s.id, s.title, s.cells.length])).toEqual([
      ["pack:one", "Pack one", 1],
      ["pack:two", "Pack two", 2],
    ]);
  });
});

describe("sticker groups", () => {
  test("recent, then one group per pack headed with its pack and space", () => {
    const s1 = item("s1", ExpressionKind.Sticker);
    const groups = buildStickerGroups({
      recent: [s1],
      spaces: [
        { space: space("a", "Cats"), packs: [pack("st", [s1, item("s2", ExpressionKind.Sticker)]), pack("none", [])] },
        { space: space("b", "Dogs"), packs: [pack("woof", [item("w", ExpressionKind.Sticker)])] },
      ],
      label,
    });
    expect(ids(groups)).toEqual(["recent", "pack:st", "pack:woof"]);
    expect(groups[0].sections[0].cells[0]).toMatchObject({ type: "sticker", key: "s:s1" });
    expect(groups[1].title).toBe("Pack st · Cats");
    expect(groups[2]).toMatchObject({ title: "Pack woof · Dogs", kind: { type: "pack", cover: { itemId: "w" } } });
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

describe("rail", () => {
  test("emoji: recent, one entry per space, the unicode groups, each jumping to its group", () => {
    const rail = buildRail(
      buildEmojiGroups({
        recent: [{ type: "unicode", key: "u:1f600", entry: grin }],
        spaces: [
          { space: space("a"), packs: [pack("one", [item("x")]), pack("two", [item("y")])] },
          { space: space("b"), packs: [pack("three", [item("z")])] },
        ],
        unicode: [{ id: "smileys", entries: [grin] }],
        label,
      }),
    );
    expect(rail.map((e) => [e.type, e.target, e.block])).toEqual([
      ["recent", "recent", "recent"],
      ["space", "space:a", "space:a"],
      ["space", "space:b", "space:b"],
      ["unicode", "smileys", "unicode"],
    ]);
    expect(rail[1]).toMatchObject({ label: "Space a", within: ["space:a"] });
  });

  test("stickers: each space's icon, then its pack covers; the space is current in any of its packs", () => {
    const rail = buildRail(
      buildStickerGroups({
        recent: [],
        spaces: [
          { space: space("a"), packs: [pack("one", [item("x", ExpressionKind.Sticker)]), pack("two", [item("y", ExpressionKind.Sticker)])] },
          { space: space("b"), packs: [pack("three", [item("z", ExpressionKind.Sticker)])] },
        ],
        label,
      }),
    );
    expect(rail.map((e) => [e.type, e.id, e.target])).toEqual([
      ["space", "space:a", "pack:one"],
      ["pack", "pack:one", "pack:one"],
      ["pack", "pack:two", "pack:two"],
      ["space", "space:b", "pack:three"],
      ["pack", "pack:three", "pack:three"],
    ]);
    expect(rail[0].within).toEqual(["pack:one", "pack:two"]);
    expect(rail[2]).toMatchObject({ within: ["pack:two"], block: "space:a", cover: { itemId: "y" } });
  });

  test("search results have no rail entries", () => {
    const groups = buildSearchGroups("emoji", "grin", {
      unicode: () => [grin],
      custom: () => [],
      stickers: () => [],
      label,
    });
    expect(buildRail(groups)).toEqual([]);
  });
});

describe("search", () => {
  const deps = {
    unicode: (q: string) => (q === "grin" ? [grin] : []),
    custom: (q: string) =>
      q === "grin"
        ? [
            { space: space("a"), items: [item("grin_a")] },
            { space: space("b"), items: [] },
            { space: space("c"), items: [item("grin_c")] },
          ]
        : [],
    stickers: (q: string) => (q === "cat" ? [item("cat", ExpressionKind.Sticker)] : []),
    label,
  };

  test("emoji: each space's own under its name, before unicode", () => {
    const groups = buildSearchGroups("emoji", " grin ", deps);
    expect(ids(groups)).toEqual(["search:space:a", "search:space:c", "search:unicode"]);
    expect(groups.map((g) => g.title)).toEqual(["Space a", "Space c", "[expression_picker_search_emoji]"]);
    expect(groups[0].sections[0].cells[0]).toMatchObject({ type: "custom", key: "c:grin_a" });
  });

  test("stickers: one group of matches", () => {
    expect(buildSearchGroups("stickers", "cat", deps).map((g) => g.sections[0].cells.length)).toEqual([1]);
    expect(buildSearchGroups("stickers", "dog", deps)).toEqual([]);
  });

  test("an empty query searches nothing", () => {
    expect(buildSearchGroups("emoji", "   ", deps)).toEqual([]);
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

  test("the toned variant is looked up in the atlases by its text; the base without one", () => {
    const waveMedium = entry("1f44b-1f3fd", [0x1f44b, 0x1f3fd], { atlasRef: { atlasId: "tone3", x: 64, y: 0, size: 64 } });
    const lookup = (text: string) => (text === "👋🏽" ? waveMedium : undefined);
    expect(tonedEntry(wave, "medium", lookup)).toBe(waveMedium);
    expect(tonedEntry(wave, "dark", lookup)).toBe(wave);
    expect(tonedEntry(wave, "default", lookup)).toBe(wave);
    expect(tonedEntry(grin, "medium", lookup)).toBe(grin);
  });
});

describe("layout", () => {
  const cells = (n: number): PickerCell[] => Array.from({ length: n }, () => ({ type: "unicode" as const, key: "", entry: grin }));
  const group = (id: string, ...sections: [title: string | null, count: number][]) => ({
    id,
    sections: sections.map(([title, count], i) => ({ id: `${id}.${i}`, title, cells: cells(count) })),
  });

  test("columns from the width: 40 px emoji and 96 px stickers with at least 4 px between", () => {
    // The emoji tab's main column: 498 - 48 (rail) - 1 - 16 (padding) - 6 (scrollbar).
    expect(columnsFor(427, EMOJI_GRID)).toBe(9);
    expect(columnsFor(391, EMOJI_GRID)).toBe(8);
    expect(columnsFor(427, STICKER_GRID)).toBe(4);
    expect(columnsFor(10, STICKER_GRID)).toBe(1);
  });

  test("each group reserves its header and its sections (sub-header + rows) before anything is mounted", () => {
    const layout = layoutGrid([group("a", [null, 9]), group("b", ["One", 10], ["Two", 0])], 392, EMOJI_GRID);
    expect(layout.columns).toBe(9);
    const [a, b] = layout.groups;
    const [a0, b0, b1] = layout.sections;
    expect(a).toMatchObject({ top: 0, height: 32 + 40 + 8, sections: [0] });
    expect(a0).toMatchObject({ index: 0, group: 0, top: 32, itemsTop: 32, rows: 1, height: 48 });
    expect(b).toMatchObject({ top: 80, sections: [1, 2] });
    expect(b0).toMatchObject({ index: 1, group: 1, top: 112, itemsTop: 136, rows: 2, height: 24 + 40 * 2 + 2 + 8 });
    expect(b1).toMatchObject({ index: 2, top: 112 + 114, itemsTop: 112 + 114 + 24, rows: 0, height: 24 + 8 });
    expect(b.height).toBe(32 + 114 + 32);
    expect(layout.height).toBe(80 + 178);
  });

  test("sticker rows are 96 px apart by 4, and the spare width goes between the columns", () => {
    const layout = layoutGrid([group("p", [null, 10])], 427, STICKER_GRID);
    expect(layout.columns).toBe(4);
    expect(layout.gapX).toBeCloseTo((427 - 4 * 96) / 3);
    expect(layout.sections[0].height).toBe(3 * 96 + 2 * 4 + 8);
    expect(cellOffset(layout, 0, 5)).toEqual({ top: 32 + 100, bottom: 32 + 100 + 96 });
  });

  test("only the rows near the viewport are mounted", () => {
    const layout = layoutGrid([group("a", [null, 90])], 392, EMOJI_GRID); // 10 rows, 42 apart, from 32
    const s = layout.sections[0];
    expect(visibleRowRange(s, EMOJI_GRID, 0, 100)).toEqual([0, 2]);
    expect(visibleRowRange(s, EMOJI_GRID, 200, 300)).toEqual([4, 7]);
    expect(visibleRowRange(s, EMOJI_GRID, 200, 300, 42)).toEqual([3, 8]);
    expect(visibleRowRange(s, EMOJI_GRID, 1000, 1200)).toEqual([0, 0]);
  });

  test("the current group is the one whose header sticks; at the very end, the last one", () => {
    const layout = layoutGrid([group("a", [null, 90]), group("b", ["x", 45], ["y", 45]), group("c", [null, 9])], 392, EMOJI_GRID);
    const [, second, third] = layout.groups;
    expect(activeGroupIndex(layout, 0, 300)).toBe(0);
    expect(activeGroupIndex(layout, second.top - 10, 300)).toBe(0);
    expect(activeGroupIndex(layout, second.top, 300)).toBe(1);
    // Inside the second group's second pack, still the second group.
    expect(activeGroupIndex(layout, layout.sections[2].top + 10, 300)).toBe(1);
    // Scrolled all the way down: the short last group can never reach the top.
    expect(activeGroupIndex(layout, layout.height - 300, 300)).toBe(2);
    expect(third.top).toBeGreaterThan(layout.height - 300);
    expect(activeGroupIndex(layoutGrid([], 392, EMOJI_GRID), 0, 300)).toBe(-1);
  });
});
