import { codepointsToString, SKIN_TONE_CODEPOINTS, type EmojiEntry, type SkinTone } from "@argon-chat/emojix";
import type { ExpressionItem, ExpressionPack } from "@argon/glue";

// The expression picker without Vue: its groups and sections, the rail beside them, where each one
// sits in the scroller, which rows are on screen, and which group the rail shows as current.

export type PickerTab = "emoji" | "stickers" | "gifs";

/** The header's order. */
export const TAB_ORDER: readonly PickerTab[] = ["gifs", "stickers", "emoji"];

export const UNICODE_GROUPS = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"] as const;
export type UnicodeGroup = (typeof UNICODE_GROUPS)[number];

const GROUP_LABELS: Record<UnicodeGroup, string> = {
  smileys: "expression_picker_group_smileys",
  people: "expression_picker_group_people",
  animals: "expression_picker_group_animals",
  food: "expression_picker_group_food",
  travel: "expression_picker_group_travel",
  activities: "expression_picker_group_activities",
  objects: "expression_picker_group_objects",
  symbols: "expression_picker_group_symbols",
  flags: "expression_picker_group_flags",
};

export type PickerCell =
  | { type: "unicode"; key: string; entry: EmojiEntry }
  | { type: "custom"; key: string; item: ExpressionItem }
  | { type: "sticker"; key: string; item: ExpressionItem };

export interface SpaceInfo {
  spaceId: string;
  name: string;
  /** The space's `avatarFieldId`. */
  avatarFileId: string | null;
}

/** What a space (or a pack) without a picture shows instead. */
export const initialOf = (name: string) => name.trim().slice(0, 1).toUpperCase();

/** A block of cells; `title` is a pack's sub-header under its space's header. */
export interface PickerSection {
  id: string;
  title: string | null;
  cells: PickerCell[];
}

export type GroupKind =
  | { type: "recent" }
  | { type: "search" }
  | { type: "unicode"; group: UnicodeGroup }
  /** Emoji: all of a space's packs. */
  | { type: "space"; space: SpaceInfo }
  /** Stickers: one pack. */
  | { type: "pack"; space: SpaceInfo; cover: ExpressionItem | null };

/** What sits under one sticky header, and what the rail jumps to. */
export interface PickerGroup {
  id: string;
  title: string;
  kind: GroupKind;
  sections: PickerSection[];
}

export type Label = (key: string) => string;

export const unicodeCell = (entry: EmojiEntry): PickerCell => ({ type: "unicode", key: `u:${entry.id}`, entry });
export const customCell = (item: ExpressionItem): PickerCell => ({ type: "custom", key: `c:${item.itemId}`, item });
export const stickerCell = (item: ExpressionItem): PickerCell => ({ type: "sticker", key: `s:${item.itemId}`, item });

/** The pack's chosen cover, else its first item. */
export function packCover(pack: ExpressionPack): ExpressionItem | null {
  return (pack.coverItemId ? pack.items.find((i) => i.itemId === pack.coverItemId) : undefined) ?? pack.items[0] ?? null;
}

const single = (id: string, cells: PickerCell[]): PickerSection[] => [{ id, title: null, cells }];

export interface SpacePacks {
  space: SpaceInfo;
  packs: ExpressionPack[];
}

export interface EmojiGroupsInput {
  recent: PickerCell[];
  spaces: SpacePacks[];
  unicode: { id: UnicodeGroup; entries: EmojiEntry[] }[];
  label: Label;
}

/** Recent, then each space (its packs as sub-sections when it has several), then the unicode groups. */
export function buildEmojiGroups({ recent, spaces, unicode, label }: EmojiGroupsInput): PickerGroup[] {
  const out: PickerGroup[] = [];
  if (recent.length) out.push({ id: "recent", title: label("expression_picker_recent"), kind: { type: "recent" }, sections: single("recent", recent) });
  for (const { space, packs } of spaces) {
    const filled = packs.filter((p) => p.items.length > 0);
    if (!filled.length) continue;
    out.push({
      id: `space:${space.spaceId}`,
      title: space.name,
      kind: { type: "space", space },
      sections: filled.map((pack) => ({ id: `pack:${pack.packId}`, title: filled.length > 1 ? pack.title : null, cells: pack.items.map(customCell) })),
    });
  }
  for (const group of unicode) {
    if (!group.entries.length) continue;
    out.push({
      id: group.id,
      title: label(GROUP_LABELS[group.id]),
      kind: { type: "unicode", group: group.id },
      sections: single(group.id, group.entries.map(unicodeCell)),
    });
  }
  return out;
}

export interface StickerGroupsInput {
  recent: ExpressionItem[];
  spaces: SpacePacks[];
  label: Label;
}

/** Recent, then one group per pack, headed "Pack · Space". */
export function buildStickerGroups({ recent, spaces, label }: StickerGroupsInput): PickerGroup[] {
  const out: PickerGroup[] = [];
  if (recent.length) {
    out.push({ id: "recent", title: label("expression_picker_recent"), kind: { type: "recent" }, sections: single("recent", recent.map(stickerCell)) });
  }
  for (const { space, packs } of spaces) {
    for (const pack of packs) {
      if (!pack.items.length) continue;
      const id = `pack:${pack.packId}`;
      out.push({
        id,
        title: `${pack.title} · ${space.name}`,
        kind: { type: "pack", space, cover: packCover(pack) },
        sections: single(id, pack.items.map(stickerCell)),
      });
    }
  }
  return out;
}

export interface SearchDeps {
  unicode: (query: string) => EmojiEntry[];
  /** Matching custom emoji of each space, in the spaces' order. */
  custom: (query: string) => { space: SpaceInfo; items: ExpressionItem[] }[];
  stickers: (query: string) => ExpressionItem[];
  label: Label;
}

/** Results as groups: custom emoji by space before unicode ones; stickers by name, keyword or emoji. */
export function buildSearchGroups(tab: "emoji" | "stickers", query: string, deps: SearchDeps): PickerGroup[] {
  const q = query.trim();
  if (!q) return [];
  const search = { type: "search" } as const;
  if (tab === "stickers") {
    const stickers = deps.stickers(q);
    return stickers.length
      ? [{ id: "search:stickers", title: deps.label("expression_picker_search_stickers"), kind: search, sections: single("search:stickers", stickers.map(stickerCell)) }]
      : [];
  }
  const out: PickerGroup[] = [];
  for (const { space, items } of deps.custom(q)) {
    if (!items.length) continue;
    const id = `search:space:${space.spaceId}`;
    out.push({ id, title: space.name, kind: search, sections: single(id, items.map(customCell)) });
  }
  const unicode = deps.unicode(q);
  if (unicode.length) {
    out.push({ id: "search:unicode", title: deps.label("expression_picker_search_emoji"), kind: search, sections: single("search:unicode", unicode.map(unicodeCell)) });
  }
  return out;
}

// ── rail ────────────────────────────────────────────────────────────────────────────────────────

export type RailEntry =
  | { type: "recent"; id: string; target: string; label: string; within: string[]; block: string }
  | { type: "space"; id: string; target: string; label: string; within: string[]; block: string; space: SpaceInfo }
  | { type: "pack"; id: string; target: string; label: string; within: string[]; block: string; cover: ExpressionItem | null }
  | { type: "unicode"; id: string; target: string; label: string; within: string[]; block: string; group: UnicodeGroup };

/**
 * The rail beside the grid: recent, one icon per space (followed, on the sticker tab, by its packs'
 * covers), then the unicode groups. `target` is the group a click scrolls to; the entry shows as
 * current while the scroll is in any group of `within`. Entries of one `block` sit together.
 */
export function buildRail(groups: readonly PickerGroup[]): RailEntry[] {
  const out: RailEntry[] = [];
  let spaceEntry = null as Extract<RailEntry, { type: "space" }> | null;
  for (const group of groups) {
    const { kind } = group;
    switch (kind.type) {
      case "recent":
        out.push({ type: "recent", id: "recent", target: group.id, label: group.title, within: [group.id], block: "recent" });
        break;
      case "space":
        out.push({ type: "space", id: group.id, target: group.id, label: kind.space.name, within: [group.id], block: group.id, space: kind.space });
        break;
      case "pack": {
        const block = `space:${kind.space.spaceId}`;
        if (spaceEntry?.block !== block) {
          spaceEntry = { type: "space", id: block, target: group.id, label: kind.space.name, within: [], block, space: kind.space };
          out.push(spaceEntry);
        }
        spaceEntry.within.push(group.id);
        out.push({ type: "pack", id: group.id, target: group.id, label: group.title, within: [group.id], block, cover: kind.cover });
        break;
      }
      case "unicode":
        out.push({ type: "unicode", id: group.id, target: group.id, label: group.title, within: [group.id], block: "unicode", group: kind.group });
        break;
    }
  }
  return out;
}

// ── recents ─────────────────────────────────────────────────────────────────────────────────────

/** The preferred skin tone; a device preference, like the other picker settings. */
export const SKIN_TONE_KEY = "argon_emoji_skin_tone";
/** Unicode and custom emoji in the order they were picked; user-scoped. */
export const RECENT_PICKER_EMOJI_KEY = "argon_recent_emoji_picker";

export const RECENT_EMOJI_LIMIT = 32;

/** `key` moved to the front, without repeats, at most `limit` long. Keys are cell keys (`u:…`, `c:…`). */
export function pushRecentKey(keys: readonly string[], key: string, limit = RECENT_EMOJI_LIMIT): string[] {
  return [key, ...keys.filter((k) => k !== key)].slice(0, limit);
}

export interface RecentLookup {
  unicode: (id: string) => EmojiEntry | undefined;
  /** Null for an item that is not loaded or not usable here. */
  custom: (itemId: string) => ExpressionItem | null;
}

/**
 * The recent row of the emoji tab: unicode and custom emoji in the order they were used. Custom ones
 * used elsewhere (the composer's `:name` completion) and not in `keys` follow at the end.
 */
export function recentEmojiCells(keys: readonly string[], lookup: RecentLookup, otherCustom: readonly ExpressionItem[] = [], limit = RECENT_EMOJI_LIMIT): PickerCell[] {
  const out: PickerCell[] = [];
  const seen = new Set<string>();
  const add = (cell: PickerCell) => {
    if (seen.has(cell.key) || out.length >= limit) return;
    seen.add(cell.key);
    out.push(cell);
  };
  for (const key of keys) {
    if (key.startsWith("u:")) {
      const entry = lookup.unicode(key.slice(2));
      if (entry) add(unicodeCell(entry));
    } else if (key.startsWith("c:")) {
      const item = lookup.custom(key.slice(2));
      if (item) add(customCell(item));
    }
  }
  for (const item of otherCustom) add(customCell(item));
  return out;
}

// ── skin tones ──────────────────────────────────────────────────────────────────────────────────

export const SKIN_TONES: readonly SkinTone[] = ["default", "light", "mediumLight", "medium", "mediumDark", "dark"];

const ZWJ = 0x200d;
const VS16 = 0xfe0f;
// People that take a tone when they follow a joiner (🧑‍🤝‍🧑 tones both).
const JOINED_PEOPLE = new Set([0x1f466, 0x1f467, 0x1f468, 0x1f469, 0x1f474, 0x1f475, 0x1f9d1, 0x1f9d2]);

/** The emoji as text in `tone`: the modifier after the base (and after each joined person). */
export function emojiWithTone(entry: EmojiEntry, tone: SkinTone): string {
  if (!entry.hasSkinTones || tone === "default") return codepointsToString(entry.codepoints);
  const modifier = SKIN_TONE_CODEPOINTS[tone];
  const cps = entry.codepoints;
  const out: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) continue;
    out.push(cp);
    if (i === 0 || (cps[i - 1] === ZWJ && JOINED_PEOPLE.has(cp))) {
      // The modifier takes the presentation selector's place.
      if (cps[i + 1] === VS16) i++;
      out.push(modifier);
    }
  }
  return codepointsToString(out);
}

/** The atlas entry that draws `entry` in `tone` (the atlases hold every variant); the base without one. */
export function tonedEntry(entry: EmojiEntry, tone: SkinTone, byText: (text: string) => EmojiEntry | undefined): EmojiEntry {
  if (!entry.hasSkinTones || tone === "default") return entry;
  return byText(emojiWithTone(entry, tone)) ?? entry;
}

// ── layout ──────────────────────────────────────────────────────────────────────────────────────

export interface GridMetrics {
  /** Cell box, px. */
  cell: number;
  /** Least horizontal gap; the spare width is shared out between the columns. */
  gapX: number;
  gapY: number;
  /** A group's sticky header. */
  header: number;
  /** A pack's title inside its space's group. */
  subheader: number;
  /** Space after a section's last row. */
  sectionGap: number;
}

export const EMOJI_GRID: GridMetrics = { cell: 40, gapX: 4, gapY: 2, header: 32, subheader: 24, sectionGap: 8 };
export const STICKER_GRID: GridMetrics = { cell: 96, gapX: 4, gapY: 4, header: 32, subheader: 24, sectionGap: 8 };

/** What a cell draws inside its box. */
export const EMOJI_ART = 32;
export const STICKER_ART = 88;

export interface SectionLayout {
  id: string;
  /** Across all groups: the keyboard's and `data-cell`'s section number. */
  index: number;
  group: number;
  /** From the top of the scroll content. */
  top: number;
  /** Where its first row starts: under its sub-header, if any. */
  itemsTop: number;
  height: number;
  rows: number;
  count: number;
}

export interface GroupLayout {
  id: string;
  index: number;
  top: number;
  height: number;
  /** Its sections' indices. */
  sections: number[];
}

export interface GridLayout {
  groups: GroupLayout[];
  sections: SectionLayout[];
  height: number;
  columns: number;
  /** The actual horizontal gap. */
  gapX: number;
  metrics: GridMetrics;
}

type LayoutInput = readonly { id: string; sections: readonly { id: string; title: string | null; cells: readonly unknown[] }[] }[];

export function columnsFor(width: number, m: GridMetrics): number {
  return Math.max(1, Math.floor((width + m.gapX) / (m.cell + m.gapX)));
}

export const rowPitch = (m: GridMetrics) => m.cell + m.gapY;

export const rowsHeight = (rows: number, m: GridMetrics) => (rows ? rows * m.cell + (rows - 1) * m.gapY : 0);

/**
 * Every group's and section's height is known before any of it is mounted: a group is its header
 * and its sections; a section its sub-header (if any), its rows, and a gap.
 */
export function layoutGrid(groups: LayoutInput, width: number, m: GridMetrics): GridLayout {
  const columns = columnsFor(width, m);
  const gapX = columns > 1 ? Math.max(m.gapX, Math.min(m.cell / 2, (width - columns * m.cell) / (columns - 1))) : 0;
  const outGroups: GroupLayout[] = [];
  const outSections: SectionLayout[] = [];
  let top = 0;
  groups.forEach((group, g) => {
    const groupTop = top;
    const indices: number[] = [];
    top += m.header;
    for (const section of group.sections) {
      const count = section.cells.length;
      const rows = Math.ceil(count / columns);
      const sub = section.title ? m.subheader : 0;
      const height = sub + rowsHeight(rows, m) + m.sectionGap;
      const index = outSections.length;
      indices.push(index);
      outSections.push({ id: section.id, index, group: g, top, itemsTop: top + sub, height, rows, count });
      top += height;
    }
    outGroups.push({ id: group.id, index: g, top: groupTop, height: top - groupTop, sections: indices });
  });
  return { groups: outGroups, sections: outSections, height: top, columns, gapX, metrics: m };
}

/** Rows of `section` within [viewTop, viewBottom] plus `overscan` px either side, as [first, end). */
export function visibleRowRange(section: SectionLayout, m: GridMetrics, viewTop: number, viewBottom: number, overscan = 0): [number, number] {
  const pitch = rowPitch(m);
  const from = viewTop - overscan - section.itemsTop;
  const to = viewBottom + overscan - section.itemsTop;
  if (to < 0 || section.rows === 0) return [0, 0];
  const first = Math.max(0, Math.floor(from / pitch));
  const end = Math.min(section.rows, Math.floor(to / pitch) + 1);
  return first < end ? [first, end] : [0, 0];
}

/**
 * The group the rail shows as current: the one whose header sticks at the top. Scrolled to the end,
 * the last one — a short last group would otherwise never become current.
 */
export function activeGroupIndex(layout: GridLayout, scrollTop: number, viewport: number): number {
  const { groups } = layout;
  if (!groups.length) return -1;
  if (viewport > 0 && scrollTop > 0 && scrollTop + viewport >= layout.height - 1) return groups.length - 1;
  let active = 0;
  for (const g of groups) {
    if (g.top <= scrollTop + 1) active = g.index;
    else break;
  }
  return active;
}

/** Where a cell sits in the scroll content. */
export function cellOffset(layout: GridLayout, section: number, index: number): { top: number; bottom: number } {
  const s = layout.sections[section];
  const m = layout.metrics;
  const row = Math.floor(index / layout.columns);
  const top = s.itemsTop + row * rowPitch(m);
  return { top, bottom: top + m.cell };
}
