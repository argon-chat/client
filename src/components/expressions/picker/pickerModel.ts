import { codepointsToString, SKIN_TONE_CODEPOINTS, type EmojiEntry, type SkinTone } from "@argon-chat/emojix";
import type { ExpressionItem, ExpressionPack } from "@argon/glue";

// The expression picker without Vue: what its sections are, where each one sits in the scroller, which
// rows of it are on screen, and which one the category bar should show as current.

export type PickerTab = "emoji" | "stickers" | "gifs";

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

export type SectionIcon =
  | { type: "recent" }
  | { type: "search" }
  | { type: "group"; group: UnicodeGroup }
  | { type: "pack"; cover: ExpressionItem | null };

export interface PickerSectionData {
  id: string;
  title: string;
  icon: SectionIcon;
  cells: PickerCell[];
}

export type Label = (key: string) => string;

export const unicodeCell = (entry: EmojiEntry): PickerCell => ({ type: "unicode", key: `u:${entry.id}`, entry });
export const customCell = (item: ExpressionItem): PickerCell => ({ type: "custom", key: `c:${item.itemId}`, item });
export const stickerCell = (item: ExpressionItem): PickerCell => ({ type: "sticker", key: `s:${item.itemId}`, item });

/** The pack's chosen cover, else its first item. */
export function packCover(pack: ExpressionPack): ExpressionItem | null {
  return (pack.coverItemId ? pack.items.find((i) => i.itemId === pack.coverItemId) : undefined) ?? pack.items[0] ?? null;
}

const packSectionId = (pack: ExpressionPack) => `pack:${pack.packId}`;

export interface EmojiSectionsInput {
  recent: PickerCell[];
  groups: { id: UnicodeGroup; entries: EmojiEntry[] }[];
  packs: ExpressionPack[];
  label: Label;
}

/** Recent, then the unicode groups, then the space's emoji packs. Empty sections are left out. */
export function buildEmojiSections({ recent, groups, packs, label }: EmojiSectionsInput): PickerSectionData[] {
  const out: PickerSectionData[] = [];
  if (recent.length) out.push({ id: "recent", title: label("expression_picker_recent"), icon: { type: "recent" }, cells: recent });
  for (const group of groups) {
    if (!group.entries.length) continue;
    out.push({
      id: group.id,
      title: label(GROUP_LABELS[group.id]),
      icon: { type: "group", group: group.id },
      cells: group.entries.map(unicodeCell),
    });
  }
  for (const pack of packs) {
    if (!pack.items.length) continue;
    out.push({ id: packSectionId(pack), title: pack.title, icon: { type: "pack", cover: packCover(pack) }, cells: pack.items.map(customCell) });
  }
  return out;
}

export interface StickerSectionsInput {
  recent: ExpressionItem[];
  packs: ExpressionPack[];
  label: Label;
}

export function buildStickerSections({ recent, packs, label }: StickerSectionsInput): PickerSectionData[] {
  const out: PickerSectionData[] = [];
  if (recent.length) out.push({ id: "recent", title: label("expression_picker_recent"), icon: { type: "recent" }, cells: recent.map(stickerCell) });
  for (const pack of packs) {
    if (!pack.items.length) continue;
    out.push({ id: packSectionId(pack), title: pack.title, icon: { type: "pack", cover: packCover(pack) }, cells: pack.items.map(stickerCell) });
  }
  return out;
}

export interface SearchDeps {
  unicode: (query: string) => EmojiEntry[];
  custom: (query: string) => ExpressionItem[];
  stickers: (query: string) => ExpressionItem[];
  label: Label;
}

/** Results as sections: the space's own emoji before unicode ones; stickers by name, keyword or emoji. */
export function buildSearchSections(tab: "emoji" | "stickers", query: string, deps: SearchDeps): PickerSectionData[] {
  const q = query.trim();
  if (!q) return [];
  if (tab === "stickers") {
    const stickers = deps.stickers(q);
    return stickers.length
      ? [{ id: "search:stickers", title: deps.label("expression_picker_search_stickers"), icon: { type: "search" }, cells: stickers.map(stickerCell) }]
      : [];
  }
  const out: PickerSectionData[] = [];
  const custom = deps.custom(q);
  if (custom.length) {
    out.push({ id: "search:custom", title: deps.label("expression_picker_search_custom"), icon: { type: "search" }, cells: custom.map(customCell) });
  }
  const unicode = deps.unicode(q);
  if (unicode.length) {
    out.push({ id: "search:unicode", title: deps.label("expression_picker_search_emoji"), icon: { type: "search" }, cells: unicode.map(unicodeCell) });
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

// ── layout ──────────────────────────────────────────────────────────────────────────────────────

export interface GridMetrics {
  /** Cell box, px. */
  cell: number;
  /** Least horizontal gap; the spare width is shared out between the columns. */
  gapX: number;
  gapY: number;
  header: number;
  /** Space after a section's last row. */
  sectionGap: number;
}

export const EMOJI_GRID: GridMetrics = { cell: 42, gapX: 4, gapY: 0, header: 32, sectionGap: 8 };
export const STICKER_GRID: GridMetrics = { cell: 72, gapX: 4, gapY: 4, header: 32, sectionGap: 8 };

export interface SectionLayout {
  id: string;
  index: number;
  /** From the top of the scroll content. */
  top: number;
  height: number;
  rows: number;
  count: number;
}

export interface GridLayout {
  sections: SectionLayout[];
  height: number;
  columns: number;
  /** The actual horizontal gap. */
  gapX: number;
  metrics: GridMetrics;
}

export function columnsFor(width: number, m: GridMetrics): number {
  return Math.max(1, Math.floor((width + m.gapX) / (m.cell + m.gapX)));
}

export const rowPitch = (m: GridMetrics) => m.cell + m.gapY;

/** Every section's height is known before any of it is mounted: rows × pitch under its header. */
export function layoutGrid(sections: readonly { id: string; cells: readonly unknown[] }[], width: number, m: GridMetrics): GridLayout {
  const columns = columnsFor(width, m);
  const gapX = columns > 1 ? Math.max(m.gapX, Math.min(m.cell / 2, (width - columns * m.cell) / (columns - 1))) : 0;
  const out: SectionLayout[] = [];
  let top = 0;
  sections.forEach((section, index) => {
    const count = section.cells.length;
    const rows = Math.ceil(count / columns);
    const height = m.header + (rows ? rows * m.cell + (rows - 1) * m.gapY : 0) + m.sectionGap;
    out.push({ id: section.id, index, top, height, rows, count });
    top += height;
  });
  return { sections: out, height: top, columns, gapX, metrics: m };
}

/** Rows of `section` within [viewTop, viewBottom] plus `overscan` px either side, as [first, end). */
export function visibleRowRange(section: SectionLayout, m: GridMetrics, viewTop: number, viewBottom: number, overscan = 0): [number, number] {
  const itemsTop = section.top + m.header;
  const pitch = rowPitch(m);
  const from = viewTop - overscan - itemsTop;
  const to = viewBottom + overscan - itemsTop;
  if (to < 0 || section.rows === 0) return [0, 0];
  const first = Math.max(0, Math.floor(from / pitch));
  const end = Math.min(section.rows, Math.floor(to / pitch) + 1);
  return first < end ? [first, end] : [0, 0];
}

/**
 * The section the category bar shows as current: the one whose header sticks at the top. Scrolled to
 * the end, the last one — a short last section would otherwise never become current.
 */
export function activeSectionIndex(layout: GridLayout, scrollTop: number, viewport: number): number {
  const { sections } = layout;
  if (!sections.length) return -1;
  if (viewport > 0 && scrollTop > 0 && scrollTop + viewport >= layout.height - 1) return sections.length - 1;
  let active = 0;
  for (const s of sections) {
    if (s.top <= scrollTop + 1) active = s.index;
    else break;
  }
  return active;
}

/** Where a cell sits in the scroll content. */
export function cellOffset(layout: GridLayout, section: number, index: number): { top: number; bottom: number } {
  const s = layout.sections[section];
  const m = layout.metrics;
  const row = Math.floor(index / layout.columns);
  const top = s.top + m.header + row * rowPitch(m);
  return { top, bottom: top + m.cell };
}
