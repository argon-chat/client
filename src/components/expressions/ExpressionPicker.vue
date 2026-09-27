<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { SearchIcon, SmileIcon, StickerIcon, XIcon } from "lucide-vue-next";
import { emojiRegistry, type EmojiEntry, type SkinTone } from "@argon-chat/emojix";
import { ExpressionKind, type ExpressionItem, type GifItem, type SavedGif } from "@argon/glue";
import { persisted } from "@argon/storage";
import { Button } from "@argon/ui/button";
import GifPicker from "@/components/chats/GifPicker.vue";
import EmptyStateArt from "@/components/shared/EmptyStateArt.vue";
import StickerPreviewPortal from "./StickerPreviewPortal.vue";
import PickerGrid from "./picker/PickerGrid.vue";
import PickerCategoryBar from "./picker/PickerCategoryBar.vue";
import EmojiTonePopover from "./picker/EmojiTonePopover.vue";
import {
  buildEmojiSections,
  buildSearchSections,
  buildStickerSections,
  EMOJI_GRID,
  emojiWithTone,
  pushRecentKey,
  RECENT_PICKER_EMOJI_KEY,
  recentEmojiCells,
  SKIN_TONE_KEY,
  STICKER_GRID,
  UNICODE_GROUPS,
  type PickerCell,
  type PickerTab,
} from "./picker/pickerModel";
import { isTypingKey } from "./picker/useGridKeyboardNav";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { useLocale } from "@/store/system/localeStore";
import { userScopedKey } from "@/lib/userScopedStorage";
import { getLottiePool } from "@/lib/expressions/lottie/LottiePool";

/**
 * Emoji, stickers and GIFs in one popover body. The emoji tab holds the recent ones, the unicode
 * groups and then the space's own packs; the sticker tab the recent stickers and the space's packs.
 * Grids are sectioned and virtual (see PickerGrid); the category bar follows the scroll.
 */
const props = withDefaults(
  defineProps<{
    spaceId: string | null;
    tabs?: PickerTab[];
    initialTab?: PickerTab;
    /** `reaction`: the emoji tab alone. */
    mode?: "compose" | "reaction";
    height?: number;
    width?: number;
    /** Offers a way to the space's settings when it has no packs yet. */
    canManage?: boolean;
  }>(),
  {
    tabs: () => ["emoji", "stickers", "gifs"],
    initialTab: "emoji",
    mode: "compose",
    height: 420,
    width: 392,
    canManage: false,
  },
);

const emit = defineEmits<{
  "select-emoji": [unicode: string];
  "select-custom-emoji": [item: ExpressionItem];
  "select-sticker": [item: ExpressionItem];
  /** What GifPicker emits as `select`. */
  "select-gif": [gif: GifItem];
  /** What GifPicker emits as `selectSaved`. */
  "select-saved-gif": [gif: SavedGif];
  close: [];
  "open-settings": [];
}>();

/** Where the previous picker (emojix) kept its unicode recents: read once to seed ours. */
const LEGACY_RECENTS_KEY = "emojix-recents";
const HOVER_PREVIEW_MS = 600;

const store = useExpressionsStore();
const { t } = useLocale();

const visibleTabs = computed<PickerTab[]>(() => {
  if (props.mode === "reaction") return ["emoji"];
  const tabs = props.tabs.filter((tab, i, all) => all.indexOf(tab) === i);
  return tabs.length ? tabs : ["emoji"];
});

const activeTab = ref<PickerTab>(visibleTabs.value.includes(props.initialTab) ? props.initialTab : visibleTabs.value[0]);
watch(visibleTabs, (tabs) => {
  if (!tabs.includes(activeTab.value)) activeTab.value = tabs[0];
});

const query = ref("");
const searching = computed(() => query.value.trim().length > 0);

// ── preferences ──

const toneStore = persisted<SkinTone>(SKIN_TONE_KEY, "default");
const tone = computed<SkinTone>(() => toneStore.value as SkinTone);

function legacyRecents(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(LEGACY_RECENTS_KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").map((id) => `u:${id}`) : [];
  } catch {
    return [];
  }
}

const recentStore = persisted<string[]>(userScopedKey(RECENT_PICKER_EMOJI_KEY), legacyRecents());

// Recents are read once per opening: a pick must not reflow the grid under the pointer.
const recentKeysAtOpen = [...(recentStore.value as string[])];
const recentStickerIdsAtOpen = [...store.recentStickers];
const recentCustomIdsAtOpen = [...store.recentEmoji];

/** Without a space (a direct chat): every space loaded this session; the server checks membership. */
function spaceItem(itemId: string, kind: ExpressionKind): ExpressionItem | null {
  const item = store.itemById(itemId);
  return item && item.kind === kind && (props.spaceId === null || item.spaceId === props.spaceId) ? item : null;
}

// ── sections ──

const unicodeGroups = computed(() => UNICODE_GROUPS.map((id) => ({ id, entries: emojiRegistry.getByCategory(id) })));

const spaces = computed(() => (props.spaceId !== null ? [props.spaceId] : [...store.bySpace.keys()]));
const emojiPacks = computed(() => spaces.value.flatMap((id) => store.emojiPacks(id)));
const stickerPacks = computed(() => spaces.value.flatMap((id) => store.stickerPacks(id)));

const emojiSections = computed(() =>
  buildEmojiSections({
    recent: recentEmojiCells(
      recentKeysAtOpen,
      { unicode: (id) => emojiRegistry.getById(id), custom: (id) => spaceItem(id, ExpressionKind.Emoji) },
      recentCustomIdsAtOpen.map((id) => spaceItem(id, ExpressionKind.Emoji)).filter((i): i is ExpressionItem => !!i),
    ),
    groups: unicodeGroups.value,
    packs: emojiPacks.value,
    label: t,
  }),
);

const stickerSections = computed(() =>
  buildStickerSections({
    recent: recentStickerIdsAtOpen.map((id) => spaceItem(id, ExpressionKind.Sticker)).filter((i): i is ExpressionItem => !!i),
    packs: stickerPacks.value,
    label: t,
  }),
);

const searchSections = computed(() =>
  activeTab.value === "gifs"
    ? []
    : buildSearchSections(activeTab.value, query.value, {
        unicode: (q) => emojiRegistry.search(q, 96).map((r) => r.emoji),
        custom: (q) => store.searchEmoji(props.spaceId, q),
        stickers: (q) => store.searchStickers(props.spaceId, q),
        label: t,
      }),
);

const gridSections = computed(() => {
  if (searching.value) return searchSections.value;
  return activeTab.value === "stickers" ? stickerSections.value : emojiSections.value;
});

const metrics = computed(() => (activeTab.value === "stickers" ? STICKER_GRID : EMOJI_GRID));
const gridKey = computed(() => `${activeTab.value}:${searching.value ? "search" : "browse"}`);

const showAddEmojiLink = computed(
  () => props.canManage && !!props.spaceId && !searching.value && activeTab.value === "emoji" && emojiPacks.value.length === 0,
);

const placeholder = computed(() =>
  t(
    activeTab.value === "stickers"
      ? "expression_picker_search_stickers_placeholder"
      : activeTab.value === "gifs"
        ? "expression_picker_search_gifs_placeholder"
        : "expression_picker_search_emoji_placeholder",
  ),
);

// ── grid wiring ──

const grid = ref<InstanceType<typeof PickerGrid> | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const activeSection = ref<string | null>(null);

function selectTab(tab: PickerTab) {
  if (tab === activeTab.value) return;
  activeTab.value = tab;
  query.value = "";
  closePreview();
  toneTarget.value = null;
}

function jumpTo(id: string) {
  grid.value?.scrollToSection(id);
}

function rememberEmoji(key: string) {
  recentStore.set(pushRecentKey(recentStore.value as string[], key));
}

function selectUnicode(entry: EmojiEntry, withTone: SkinTone = tone.value) {
  rememberEmoji(`u:${entry.id}`);
  emit("select-emoji", emojiWithTone(entry, withTone));
}

function onSelect(cell: PickerCell) {
  closePreview();
  if (cell.type === "unicode") {
    selectUnicode(cell.entry);
  } else if (cell.type === "custom") {
    store.pushRecentEmoji(cell.item);
    rememberEmoji(`c:${cell.item.itemId}`);
    emit("select-custom-emoji", cell.item);
  } else {
    store.pushRecentSticker(cell.item);
    emit("select-sticker", cell.item);
  }
}

// ── skin tones ──

const toneTarget = shallowRef<{ entry: EmojiEntry; el: HTMLElement } | null>(null);

function onToneSelect(next: SkinTone) {
  const target = toneTarget.value;
  toneStore.set(next);
  toneTarget.value = null;
  if (!target) return;
  target.el.focus({ preventScroll: true });
  selectUnicode(target.entry, next);
}

function closeTones() {
  const target = toneTarget.value;
  toneTarget.value = null;
  target?.el.focus({ preventScroll: true });
}

// ── sticker preview ──

const previewItem = shallowRef<ExpressionItem | null>(null);
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function closePreview() {
  clearTimeout(hoverTimer);
  previewItem.value = null;
}

function onHover(cell: PickerCell | null) {
  clearTimeout(hoverTimer);
  if (!cell || cell.type !== "sticker") {
    previewItem.value = null;
    return;
  }
  // Once one is up, moving to the next sticker swaps it at once.
  if (previewItem.value) {
    previewItem.value = cell.item;
    return;
  }
  const item = cell.item;
  hoverTimer = setTimeout(() => (previewItem.value = item), HOVER_PREVIEW_MS);
}

function onContext(cell: PickerCell, el: HTMLElement, source: "mouse" | "touch") {
  if (cell.type === "unicode") {
    if (cell.entry.hasSkinTones) {
      closePreview();
      toneTarget.value = { entry: cell.entry, el };
    }
  } else if (cell.type === "sticker" && source === "touch") {
    previewItem.value = cell.item;
  }
}

// ── keys ──

function onTypeAhead(e: KeyboardEvent) {
  if (!isTypingKey(e)) return;
  // Focus moves before the key's default action, so the character lands in the field.
  searchInput.value?.focus({ preventScroll: true });
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    grid.value?.focusFirst();
  } else if (e.key === "Escape" && query.value) {
    e.preventDefault();
    e.stopPropagation();
    query.value = "";
  }
}

function onRootKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  e.preventDefault();
  if (toneTarget.value) closeTones();
  else if (previewItem.value) closePreview();
  else emit("close");
}

function focusSearch() {
  searchInput.value?.focus({ preventScroll: true });
}

// ── lifecycle ──

watch(
  () => props.spaceId,
  (spaceId) => {
    if (spaceId) void store.ensureLoaded(spaceId);
  },
);

watch(query, () => {
  closePreview();
  toneTarget.value = null;
});

onMounted(async () => {
  getLottiePool().unlockGroup("picker");
  if (props.spaceId) void store.ensureLoaded(props.spaceId);
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (!coarse) {
    await nextTick();
    focusSearch();
  }
});

onBeforeUnmount(() => {
  closePreview();
  getLottiePool().lockGroup("picker");
});

defineExpose({ focusSearch, selectTab, activeTab });
</script>

<template>
  <div class="xp" :style="{ width: `${width}px`, height: `${height}px` }" @keydown="onRootKeydown">
    <div class="xp-head">
      <div v-if="visibleTabs.length > 1" class="xp-tabs" role="tablist">
        <button
          v-for="tab in visibleTabs"
          :key="tab"
          type="button"
          role="tab"
          class="xp-tabs__tab"
          :class="{ 'is-active': tab === activeTab }"
          :data-tab="tab"
          :aria-selected="tab === activeTab"
          :aria-label="t(`expression_picker_tab_${tab}`)"
          :title="t(`expression_picker_tab_${tab}`)"
          @click="selectTab(tab)"
        >
          <SmileIcon v-if="tab === 'emoji'" class="xp-tabs__icon" />
          <StickerIcon v-else-if="tab === 'stickers'" class="xp-tabs__icon" />
          <span v-else class="xp-tabs__gif">GIF</span>
        </button>
      </div>
      <label class="xp-search">
        <SearchIcon class="xp-search__icon" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          class="xp-search__input"
          :placeholder="placeholder"
          :aria-label="placeholder"
          autocomplete="off"
          spellcheck="false"
          @keydown="onSearchKeydown"
        />
        <button
          v-if="query"
          type="button"
          class="xp-search__clear"
          :aria-label="t('expression_picker_clear_search')"
          @click="query = ''; focusSearch()"
        >
          <XIcon class="w-3.5 h-3.5" />
        </button>
      </label>
    </div>

    <PickerCategoryBar
      v-if="activeTab !== 'gifs' && !searching && gridSections.length"
      :sections="gridSections"
      :active="activeSection"
      @select="jumpTo"
    />

    <div class="xp-body">
      <GifPicker
        v-if="activeTab === 'gifs'"
        :search-query="query"
        @select="emit('select-gif', $event)"
        @select-saved="emit('select-saved-gif', $event)"
      />
      <PickerGrid
        v-else-if="gridSections.length"
        :key="gridKey"
        ref="grid"
        :sections="gridSections"
        :metrics="metrics"
        @select="onSelect"
        @context="onContext"
        @hover="onHover"
        @release="closePreview"
        @scroll="closePreview"
        @active-change="activeSection = $event"
        @type-ahead="onTypeAhead"
      >
        <template #footer>
          <div v-if="showAddEmojiLink" class="xp-footer">
            <span>{{ t("expression_picker_no_custom_emoji") }}</span>
            <button type="button" class="xp-footer__link" @click="emit('open-settings')">
              {{ t("expression_picker_manage") }}
            </button>
          </div>
        </template>
      </PickerGrid>
      <div v-else class="xp-empty" data-empty>
        <template v-if="searching">
          <EmptyStateArt name="not-found" :size="96" />
          <p>{{ t("expression_picker_no_results") }}</p>
        </template>
        <template v-else>
          <StickerIcon class="xp-empty__icon" aria-hidden="true" />
          <p>{{ t("expression_picker_no_stickers") }}</p>
          <Button v-if="canManage && spaceId" size="sm" variant="secondary" @click="emit('open-settings')">
            {{ t("expression_picker_manage") }}
          </Button>
        </template>
      </div>
    </div>

    <StickerPreviewPortal :item="previewItem" />
    <EmojiTonePopover
      v-if="toneTarget"
      :entry="toneTarget.entry"
      :anchor="toneTarget.el"
      :tone="tone"
      @select="onToneSelect"
      @close="closeTones"
    />
  </div>
</template>

<style scoped>
.xp {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  overflow: hidden;
  border-radius: var(--radius);
  background: hsl(var(--popover));
  color: hsl(var(--popover-foreground));
}

.xp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 6px;
  flex: none;
}

.xp-tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--muted));
  flex: none;
}

.xp-tabs__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border-radius: calc(var(--radius) - 4px);
  color: hsl(var(--muted-foreground));
  transition: background-color 0.12s ease, color 0.12s ease;
}

.xp-tabs__tab:hover {
  color: hsl(var(--foreground));
}

.xp-tabs__tab.is-active {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.xp-tabs__tab:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}

.xp-tabs__icon {
  width: 18px;
  height: 18px;
}

.xp-tabs__gif {
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.xp-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  gap: 6px;
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.xp-search:focus-within {
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.6);
}

.xp-search__icon {
  width: 16px;
  height: 16px;
  flex: none;
}

.xp-search__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 0.875rem;
  color: hsl(var(--foreground));
}

.xp-search__input::placeholder {
  color: hsl(var(--muted-foreground));
}

.xp-search__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  color: hsl(var(--muted-foreground));
}

.xp-search__clear:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.xp-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.xp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 24px;
  text-align: center;
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
}

.xp-empty__icon {
  width: 40px;
  height: 40px;
  opacity: 0.6;
}

.xp-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px 12px;
  font-size: 0.8rem;
  color: hsl(var(--muted-foreground));
}

.xp-footer__link {
  color: hsl(var(--primary));
  font-weight: 500;
}

.xp-footer__link:hover {
  text-decoration: underline;
}
</style>
