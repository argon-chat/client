import { computed, effectScope, onBeforeUnmount, reactive, watch, type EffectScope } from "vue";
import {
  codepointsToString,
  emojiRegistry,
  emoticonBefore,
  matchShortcodes,
  normalizeQuery,
  shortcodeExact,
  type EmojiEntry,
  type KeywordMatch,
  type ShortcodeMatch,
  type SkinTone,
} from "@argon-chat/emojix";
import { ExpressionKind, type ExpressionItem, type MessageEntityCustomEmoji } from "@argon/glue";
import type { MessageInputApi } from "@/components/chats/messageInput";
import { SKIN_TONE_KEY, tonedEntry } from "@/components/expressions/picker/pickerModel";
import { useExpressionResolver } from "@/lib/expressions/resolver";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { baseHexcodeOf } from "@/lib/chat/emojiSuggest/emoji";
import { ensureSuggestIndices, longestSuggestKey, suggestIndices, suggestLocales } from "@/lib/chat/emojiSuggest/indices";
import {
  buildSuggestions,
  customKey,
  rankUnicode,
  SUGGEST_LIMIT,
  unicodeKey,
  type CustomSource,
  type Suggestion,
} from "@/lib/chat/emojiSuggest/rank";
import {
  replacementBeforeBreak,
  replacementForTyped,
  revertTarget,
  typedAt,
  type InstantReplacement,
  type ReplaceDeps,
  type ReplacementRecord,
} from "@/lib/chat/emojiSuggest/replace";
import {
  emojiSuggestionsEnabled,
  replaceEmoticons,
  suggestCustomEmoji,
  suggestEmoji,
  suggestStickers,
} from "@/lib/chat/emojiSuggest/settings";
import { detect, type Detected } from "@/lib/chat/emojiSuggest/triggers";
import { bumpUsage, usageRating } from "@/lib/chat/emojiSuggest/usage";

/** A lone word waits this long before its exact matches show. */
export const WORD_DELAY_MS = 300;
const MATCH_LIMIT = 48;
const SHORTCODE_QUERY = /^[a-z0-9_+-]+$/;

export interface EmojiSuggestOptions {
  editor: () => MessageInputApi | null;
  text: () => string;
  placed: () => readonly MessageEntityCustomEmoji[];
  /** The composer's space; null in a direct chat. */
  spaceId: () => string | null;
  canSendStickers: () => boolean;
  /** Something else holds the space above the composer (mentions, commands, the picker). */
  blocked: () => boolean;
  uiLocale: () => string;
  sendSticker: (item: ExpressionItem) => void;
}

type Source = "keyboard" | "picker" | "paste";

function readTone(): SkinTone {
  try {
    const value = JSON.parse(localStorage.getItem(SKIN_TONE_KEY) ?? "null");
    return typeof value === "string" ? (value as SkinTone) : "default";
  } catch {
    return "default";
  }
}

const byText = (text: string) => emojiRegistry.getByText(text);

/**
 * Telegram's emoji suggestions over the composer: the strip for `:query`, a lone word, an emoji just
 * typed and a one-emoji message; and the instant replacements (`:)`, `:D `, `:joy:`, the text table)
 * with Backspace taking one back.
 */
export function useEmojiSuggest(opts: EmojiSuggestOptions) {
  const resolver = useExpressionResolver();
  const store = useExpressionsStore();

  const state = reactive({
    mode: null as Detected["mode"] | null,
    items: [] as Suggestion[],
    index: -1,
    /** Where the text a pick replaces starts; it ends at the caret. */
    start: 0,
    /** How many identical emoji a custom emoji pick replaces. */
    count: 1,
  });

  const visible = computed(() => !!state.mode && state.items.length > 0 && !opts.blocked());

  /** The user's last change the strip was worked out for; any other text or caret closes it. */
  let anchor: { text: string; caret: number } | null = null;
  let source: Source | null = null;
  let lastSource: Source = "keyboard";
  let own = 0;
  let record: ReplacementRecord | null = null;
  let swallowSpaceAt: number | null = null;
  let wordTimer: ReturnType<typeof setTimeout> | undefined;
  let indicesWanted = false;

  const deps: ReplaceDeps = {
    emoticonBefore,
    shortcodeExact,
    hasCustomEmoji: (name) => !!resolver.emojiByName(opts.spaceId(), name),
  };

  function ownEdit<T>(run: () => T): T {
    own++;
    try {
      return run();
    } finally {
      own--;
    }
  }

  function clearStrip() {
    clearTimeout(wordTimer);
    wordTimer = undefined;
    state.mode = null;
    state.items = [];
    state.index = -1;
  }

  function hide() {
    clearStrip();
    anchor = null;
  }

  function editorFocused(): boolean {
    const el = opts.editor()?.el;
    return !!el && !!document.activeElement && el.contains(document.activeElement);
  }

  // ── results ──

  function resolveEntry(hexcode: string, tone: SkinTone): EmojiEntry | undefined {
    const entry = emojiRegistry.getByHexcode(hexcode);
    return entry ? tonedEntry(entry, tone, byText) : undefined;
  }

  function customSource(spaceId: string | null, named: readonly ExpressionItem[]): CustomSource {
    const byBase = new Map<string, ExpressionItem[]>();
    for (const item of store.itemsOf(spaceId, ExpressionKind.Emoji)) {
      for (const e of item.emoji) {
        const base = baseHexcodeOf(e);
        const list = byBase.get(base);
        if (!list) byBase.set(base, [item]);
        else if (!list.includes(item)) list.push(item);
      }
    }
    const recent = new Set(store.recentEmoji);
    return { associated: (hex) => byBase.get(hex) ?? [], named, isRecent: (id) => recent.has(id) };
  }

  function keywordResults(matches: KeywordMatch[], shortcodes: ShortcodeMatch[], named: () => ExpressionItem[]) {
    const spaceId = opts.spaceId();
    const tone = readTone();
    const ranked = rankUnicode(matches, shortcodes, suggestLocales.value, usageRating);
    return buildSuggestions({
      ranked,
      resolve: (hex) => resolveEntry(hex, tone),
      custom: suggestCustomEmoji.value ? customSource(spaceId, named()) : null,
    });
  }

  function queryItems(query: string): Suggestion[] {
    const q = normalizeQuery(query);
    if (!q) return [];
    const matches = suggestIndices.value.flatMap((index) => index.matchPrefix(q, MATCH_LIMIT));
    const shortcodes = SHORTCODE_QUERY.test(q) ? matchShortcodes(q, MATCH_LIMIT) : [];
    return keywordResults(matches, shortcodes, () => resolver.emojiCandidates(opts.spaceId(), q, SUGGEST_LIMIT));
  }

  function wordItems(word: string): Suggestion[] {
    const q = normalizeQuery(word);
    if (!q) return [];
    const matches = suggestIndices.value.flatMap((index) => index.matchExact(q));
    return keywordResults(matches, [], () =>
      resolver
        .emojiCandidates(opts.spaceId(), q, SUGGEST_LIMIT)
        .filter((item) => item.name.toLowerCase() === q || item.keywords.some((k) => k.toLowerCase() === q)),
    );
  }

  function emojiItems(found: Extract<Detected, { mode: "emoji" }>): Suggestion[] {
    const spaceId = opts.spaceId();
    const out: Suggestion[] = [];
    if (found.run) {
      for (const item of customSource(spaceId, []).associated(found.run.base)) {
        out.push({ type: "custom", key: customKey(item.itemId), item, label: `:${item.name}:` });
      }
    }
    if (found.sticker) {
      const base = baseHexcodeOf(found.sticker);
      const tagged = (item: ExpressionItem) => item.emoji.some((e) => baseHexcodeOf(e) === base);
      const seen = new Set<string>();
      for (const item of [...store.recentStickerItems(spaceId).filter(tagged), ...store.searchStickers(spaceId, found.sticker)]) {
        if (seen.has(item.itemId)) continue;
        seen.add(item.itemId);
        out.push({ type: "sticker", key: `s:${item.itemId}`, item, label: item.name });
      }
    }
    return out.slice(0, SUGGEST_LIMIT);
  }

  function show(found: Detected, items: Suggestion[]) {
    clearStrip();
    if (!items.length) return;
    state.mode = found.mode;
    state.items = items;
    state.start = found.start;
    state.count = found.mode === "emoji" ? (found.run?.count ?? 1) : 1;
    state.index = found.mode === "query" ? 0 : -1;
  }

  /** Works the strip out for the text and caret as they are now; call after a change by the user. */
  function update(): void {
    if (!emojiSuggestionsEnabled.value) return;
    clearStrip();
    const ed = opts.editor();
    if (!ed || lastSource === "paste") {
      anchor = null;
      return;
    }
    const text = opts.text();
    const caret = ed.getCursorOffset();
    anchor = { text, caret };
    const spaceId = opts.spaceId();
    const found = detect({
      text,
      caret,
      placed: opts.placed(),
      longestKey: longestSuggestKey.value,
      inSpace: !!spaceId,
      canSendStickers: opts.canSendStickers(),
      settings: {
        suggestEmoji: suggestEmoji.value,
        suggestCustomEmoji: suggestCustomEmoji.value,
        suggestStickers: suggestStickers.value,
      },
    });
    if (!found) return;
    if (spaceId) resolver.ensureLoaded(spaceId);
    if (found.mode === "query") show(found, queryItems(found.query));
    else if (found.mode === "emoji") show(found, emojiItems(found));
    else {
      const at = anchor;
      wordTimer = setTimeout(() => {
        wordTimer = undefined;
        if (anchor !== at || !editorFocused()) return;
        show(found, wordItems(found.word));
      }, WORD_DELAY_MS);
    }
  }

  // ── picking ──

  /** The anchor still describes the composer: nothing moved since the strip was worked out. */
  function current(): { ed: MessageInputApi; caret: number } | null {
    const ed = opts.editor();
    if (!ed || !anchor) return null;
    const caret = ed.getCursorOffset();
    return opts.text() === anchor.text && caret === anchor.caret ? { ed, caret } : null;
  }

  function pick(i: number): void {
    const s = state.items[i];
    const at = current();
    const { start, count } = state;
    hide();
    if (!s || !at) return;
    if (s.type === "sticker") {
      store.pushRecentSticker(s.item);
      opts.sendSticker(s.item);
      return;
    }
    const range = { start, end: at.caret };
    ownEdit(() => {
      if (s.type === "unicode") at.ed.insertEmoji(s.entry, range);
      else for (let n = 0; n < count; n++) if (!at.ed.insertCustomEmoji(s.item, n === 0 ? range : undefined)) break;
    });
    if (s.type === "custom") store.pushRecentEmoji(s.item);
    bumpUsage(s.type === "unicode" ? unicodeKey(s.hexcode) : customKey(s.item.itemId));
  }

  function select(i: number): void {
    if (i >= 0 && i < state.items.length) state.index = i;
  }

  // ── instant replacements ──

  function apply(r: InstantReplacement, text: string): boolean {
    const ed = opts.editor();
    if (!ed) return false;
    const original = text.slice(r.start, r.end);
    const range = { start: r.start, end: r.end };
    let inserted: string;
    let usage: string | null = null;
    if (r.content.kind === "text") {
      inserted = r.content.text;
      ownEdit(() => ed.replaceRange(r.start, r.end, inserted));
    } else if (r.content.kind === "unicode") {
      const entry = resolveEntry(r.content.hexcode, readTone());
      if (!entry) return false;
      inserted = codepointsToString(entry.codepoints);
      ownEdit(() => ed.insertEmoji(entry, range));
      usage = unicodeKey(r.content.hexcode);
    } else {
      const item = resolver.emojiByName(opts.spaceId(), r.content.name);
      if (!item || !ownEdit(() => ed.insertCustomEmoji(item, range))) return false;
      inserted = `:${item.name}:`;
      usage = customKey(item.itemId);
      store.pushRecentEmoji(item);
    }
    ownEdit(() => {
      if (r.trailingSpace) {
        ed.insertTextAtCursor(" ");
        inserted += " ";
      }
      if (r.keep) ed.setCursorOffset(r.start + inserted.length + r.keep);
    });
    record = { start: r.start, inserted, original, keep: r.keep };
    swallowSpaceAt = r.trailingSpace ? r.start + inserted.length : null;
    if (usage) bumpUsage(usage);
    return true;
  }

  /**
   * The input event of a change in the editor. Makes the instant replacement the typing calls for;
   * true when the change was this composable's own or it replaced something (nothing else to do).
   */
  function onInput(previous: string): boolean {
    if (own) return true;
    lastSource = source ?? "keyboard";
    source = null;
    record = null;
    swallowSpaceAt = null;
    const ed = opts.editor();
    if (!ed || lastSource !== "keyboard") return false;
    const text = opts.text();
    const caret = ed.getCursorOffset();
    const typed = typedAt(previous, text, caret);
    if (!typed) return false;
    // With suggestions off only the typographic table (`--`, `->`, `(c)`) is left.
    const on = emojiSuggestionsEnabled.value;
    const replacement = replacementForTyped(
      { text, caret, typed, emoticons: on && replaceEmoticons.value, placed: opts.placed() },
      deps,
    );
    if (!replacement || !apply(replacement, text)) return false;
    if (on) update();
    return true;
  }

  /** The next input comes from a paste (no replacements, no strip) or the picker (no replacements). */
  function markSource(next: "paste" | "picker") {
    source = next;
    // A paste the composer took over (files) sends no input: the mark must not outlive this task.
    queueMicrotask(() => {
      if (source === next) source = null;
    });
  }

  // ── keys ──

  function revert(e: KeyboardEvent): boolean {
    const held = record;
    record = null;
    swallowSpaceAt = null;
    const ed = opts.editor();
    if (!held || !ed || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
    if (window.getSelection()?.isCollapsed === false) return false;
    const target = revertTarget(held, opts.text(), ed.getCursorOffset());
    if (!target) return false;
    e.preventDefault();
    ownEdit(() => {
      ed.replaceRange(target.start, target.end, target.original);
      if (held.keep) ed.setCursorOffset(target.caret);
    });
    hide();
    return true;
  }

  /** The composer's keydown, before anything else handles it; true when it was used here. */
  function onKeydown(e: KeyboardEvent): boolean {
    if (e.key === "Backspace" && revert(e)) return true;
    if (!emojiSuggestionsEnabled.value) return false;
    if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && replaceEmoticons.value) {
      // The line break is not in the text yet: a pending `:D` is replaced now, the break goes after it.
      const ed = opts.editor();
      if (ed) {
        const text = opts.text();
        const r = replacementBeforeBreak(text, ed.getCursorOffset(), opts.placed(), deps);
        if (r) apply(r, text);
      }
    }

    if (!visible.value) {
      if (e.key === "Escape") clearTimeout(wordTimer);
      return false;
    }
    const n = state.items.length;
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        state.index = state.index < 0 ? 0 : (state.index + 1) % n;
        return true;
      case "ArrowLeft":
        if (state.index < 0) return false;
        e.preventDefault();
        state.index = (state.index - 1 + n) % n;
        return true;
      case "Enter":
        if (state.index < 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
        e.preventDefault();
        pick(state.index);
        return true;
      case "Tab":
        if (state.index < 0 || e.shiftKey) return false;
        e.preventDefault();
        pick(state.index);
        return true;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        hide();
        return true;
    }
    return false;
  }

  // ── lifecycle ──

  /** The composer got focus: the keyword indices are loaded now, not at boot. */
  function onFocus() {
    if (!emojiSuggestionsEnabled.value) return;
    indicesWanted = true;
    void ensureSuggestIndices(opts.uiLocale());
  }

  function onSelectionChange() {
    if (!anchor || own) return;
    const ed = opts.editor();
    const sel = window.getSelection();
    if (!ed?.el || !sel?.rangeCount || !ed.el.contains(sel.anchorNode)) return;
    if (!sel.isCollapsed || ed.getCursorOffset() !== anchor.caret) hide();
  }

  // The space after an emoji put in at the end: the user's own space right after it is not doubled.
  function onBeforeInput(e: InputEvent) {
    if (swallowSpaceAt === null) return;
    const at = swallowSpaceAt;
    swallowSpaceAt = null;
    if (e.inputType === "insertText" && e.data === " " && opts.editor()?.getCursorOffset() === at) e.preventDefault();
  }

  let boundEl: HTMLElement | null = null;
  function bind(el: HTMLElement | null | undefined) {
    if (el === boundEl) return;
    boundEl?.removeEventListener("beforeinput", onBeforeInput as EventListener);
    boundEl = el ?? null;
    boundEl?.addEventListener("beforeinput", onBeforeInput as EventListener);
  }

  // Watchers and listeners exist only while suggestions are on: off, typing costs the text table only.
  let scope: EffectScope | null = null;

  function start() {
    if (scope) return;
    scope = effectScope(true);
    scope.run(() => {
      watch(opts.uiLocale, (locale) => {
        if (indicesWanted) void ensureSuggestIndices(locale);
      });
      // Indices that arrive after the typing: the strip is worked out again for the same text.
      watch(suggestIndices, () => {
        if (anchor && current() && editorFocused()) update();
      });
      // A text set from outside (a draft, the edit, a send) is not the one the strip was for.
      watch(opts.text, (text) => {
        if (!own && anchor && text !== anchor.text) hide();
      });
      watch(() => opts.editor()?.el, bind, { immediate: true });
    });
    document.addEventListener("selectionchange", onSelectionChange);
  }

  function stop() {
    scope?.stop();
    scope = null;
    document.removeEventListener("selectionchange", onSelectionChange);
    bind(null);
    hide();
    record = null;
    swallowSpaceAt = null;
    source = null;
    indicesWanted = false;
  }

  const stopSwitch = watch(emojiSuggestionsEnabled, (on) => (on ? start() : stop()), { immediate: true });

  onBeforeUnmount(() => {
    stopSwitch();
    stop();
  });

  return {
    state,
    visible,
    update,
    hide,
    pick,
    select,
    onInput,
    onKeydown,
    onFocus,
    markPaste: () => markSource("paste"),
    markPicker: () => markSource("picker"),
  };
}

export type EmojiSuggest = ReturnType<typeof useEmojiSuggest>;
