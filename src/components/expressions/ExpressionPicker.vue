<script setup lang="ts">
import "./picker/pickerScroll.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { SearchIcon, StickerIcon, XIcon } from "lucide-vue-next";
import { emojiRegistry, spriteResolver, type EmojiEntry, type SkinTone } from "@argon-chat/emojix";
import { ExpressionKind, type ExpressionItem, type ExpressionPack, type GifItem, type SavedGif } from "@argon/glue";
import { persisted } from "@argon/storage";
import { Button } from "@argon/ui/button";
import GifPicker from "@/components/chats/GifPicker.vue";
import EmptyStateArt from "@/components/shared/EmptyStateArt.vue";
import StickerPreviewPortal from "./StickerPreviewPortal.vue";
import PickerGrid from "./picker/PickerGrid.vue";
import PickerRail from "./picker/PickerRail.vue";
import PickerFooter from "./picker/PickerFooter.vue";
import EmojiTonePopover from "./picker/EmojiTonePopover.vue";
import {
  buildEmojiGroups,
  buildRail,
  buildSearchGroups,
  buildStickerGroups,
  EMOJI_GRID,
  emojiWithTone,
  pushRecentKey,
  RECENT_PICKER_EMOJI_KEY,
  recentEmojiCells,
  SKIN_TONE_KEY,
  STICKER_GRID,
  TAB_ORDER,
  tonedEntry,
  UNICODE_GROUPS,
  type PickerCell,
  type PickerTab,
  type SpaceInfo,
} from "./picker/pickerModel";
import { isTypingKey } from "./picker/useGridKeyboardNav";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { db } from "@/store/db/dexie";
import { useLocale } from "@/store/system/localeStore";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { userScopedKey } from "@/lib/userScopedStorage";
import { getLottiePool } from "@/lib/expressions/lottie/LottiePool";

/**
 * Emoji, stickers and GIFs in one fixed-size panel. A tab bar and the search on top; on the emoji and
 * sticker tabs a rail (recent, the spaces, the unicode groups) beside a sectioned virtual grid, and a
 * footer naming what is pointed at. In a direct chat (`spaceId` null) every space's packs are offered.
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
    /** Offers a way to the space's expression settings. */
    canManage?: boolean;
  }>(),
  {
    tabs: () => ["gifs", "stickers", "emoji"],
    initialTab: "emoji",
    mode: "compose",
    height: 440,
    width: 498,
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
/** Kept this far from the viewport's sides when the window is narrower than the panel. */
const VIEWPORT_MARGIN = 16;

const store = useExpressionsStore();
const { t } = useLocale();

const visibleTabs = computed<PickerTab[]>(() => {
  if (props.mode === "reaction") return ["emoji"];
  const tabs = TAB_ORDER.filter((tab) => props.tabs.includes(tab));
  return tabs.length ? tabs : ["emoji"];
});

const activeTab = ref<PickerTab>(visibleTabs.value.includes(props.initialTab) ? props.initialTab : visibleTabs.value[0]);
watch(visibleTabs, (tabs) => {
  if (!tabs.includes(activeTab.value)) activeTab.value = tabs[0];
});

const query = ref("");
const searching = computed(() => query.value.trim().length > 0);

const rootStyle = computed(() => {
  const width = `min(${props.width}px, calc(100vw - ${VIEWPORT_MARGIN}px))`;
  return { width, minWidth: width, height: `${props.height}px`, maxHeight: `calc(100vh - ${VIEWPORT_MARGIN}px)` };
});

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

/** Without a space (a direct chat): every space loaded; the server checks membership. */
function spaceItem(itemId: string, kind: ExpressionKind): ExpressionItem | null {
  const item = store.itemById(itemId);
  return item && item.kind === kind && (props.spaceId === null || item.spaceId === props.spaceId) ? item : null;
}

// ── spaces ──

const servers = useLiveQuery(() => db.servers.toArray());
const serverById = computed(() => new Map((servers.value ?? []).map((s) => [String(s.spaceId), s])));
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

function spaceInfo(spaceId: string): SpaceInfo {
  const server = serverById.value.get(spaceId);
  return { spaceId, name: server?.name || t("expression_picker_unknown_space"), avatarFileId: server?.avatarFieldId ?? null };
}

/** This space; in a direct chat every loaded one, by name. */
const spaces = computed<SpaceInfo[]>(() => {
  if (props.spaceId !== null) return [spaceInfo(props.spaceId)];
  const known = (space: SpaceInfo) => serverById.value.has(space.spaceId);
  return [...store.bySpace.keys()].map(spaceInfo).sort((a, b) => Number(known(b)) - Number(known(a)) || collator.compare(a.name, b.name));
});

const packById = computed(() => {
  const out = new Map<string, ExpressionPack>();
  for (const entry of store.bySpace.values()) for (const pack of entry.packs) out.set(pack.packId, pack);
  return out;
});

// ── groups ──

const unicodeGroups = computed(() => UNICODE_GROUPS.map((id) => ({ id, entries: emojiRegistry.getByCategory(id) })));

const emojiGroups = computed(() =>
  buildEmojiGroups({
    recent: recentEmojiCells(
      recentKeysAtOpen,
      { unicode: (id) => emojiRegistry.getById(id), custom: (id) => spaceItem(id, ExpressionKind.Emoji) },
      recentCustomIdsAtOpen.map((id) => spaceItem(id, ExpressionKind.Emoji)).filter((i): i is ExpressionItem => !!i),
    ),
    spaces: spaces.value.map((space) => ({ space, packs: store.emojiPacks(space.spaceId) })),
    unicode: unicodeGroups.value,
    label: t,
  }),
);

const stickerGroups = computed(() =>
  buildStickerGroups({
    recent: recentStickerIdsAtOpen.map((id) => spaceItem(id, ExpressionKind.Sticker)).filter((i): i is ExpressionItem => !!i),
    spaces: spaces.value.map((space) => ({ space, packs: store.stickerPacks(space.spaceId) })),
    label: t,
  }),
);

const searchGroups = computed(() =>
  activeTab.value === "gifs"
    ? []
    : buildSearchGroups(activeTab.value, query.value, {
        unicode: (q) => emojiRegistry.search(q, 96).map((r) => r.emoji),
        custom: (q) => spaces.value.map((space) => ({ space, items: store.searchEmoji(space.spaceId, q) })),
        stickers: (q) => store.searchStickers(props.spaceId, q),
        label: t,
      }),
);

const browseGroups = computed(() => (activeTab.value === "stickers" ? stickerGroups.value : emojiGroups.value));
const gridGroups = computed(() => (searching.value ? searchGroups.value : browseGroups.value));
const rail = computed(() => buildRail(browseGroups.value));

const metrics = computed(() => (activeTab.value === "stickers" ? STICKER_GRID : EMOJI_GRID));
const gridKey = computed(() => `${activeTab.value}:${searching.value ? "search" : "browse"}`);

/** The sticker tab with no packs anywhere: one empty state instead of rail and grid. */
const nothingToBrowse = computed(() => activeTab.value !== "gifs" && !searching.value && browseGroups.value.length === 0);

const manageLabel = computed(() => (props.canManage && !!props.spaceId ? t("expression_picker_manage") : null));

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
const tablist = ref<HTMLElement | null>(null);
const activeGroup = ref<string | null>(null);

/** What the footer names: the cell pointed at or focused last, else the grid's first. */
const inspected = shallowRef<PickerCell | null>(null);
const footerCell = computed(
  () => inspected.value ?? gridGroups.value.flatMap((g) => g.sections).find((s) => s.cells.length)?.cells[0] ?? null,
);
const footerDetail = computed(() => {
  const cell = footerCell.value;
  if (!cell || cell.type === "unicode") return null;
  const space = spaceInfo(cell.item.spaceId).name;
  const pack = packById.value.get(cell.item.packId);
  return pack ? `${pack.title} · ${space}` : space;
});

function selectTab(tab: PickerTab) {
  if (tab === activeTab.value) return;
  activeTab.value = tab;
  query.value = "";
  inspected.value = null;
  closePreview();
  toneTarget.value = null;
}

function onTabKeydown(e: KeyboardEvent) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const tabs = visibleTabs.value;
  const at = tabs.indexOf(activeTab.value);
  const next = tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
  selectTab(next);
  void nextTick(() => tablist.value?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus());
}

async function jumpTo(target: string) {
  if (!searching.value) {
    grid.value?.scrollToGroup(target);
    return;
  }
  // From the results: back to browsing, at that group.
  query.value = "";
  await nextTick();
  await nextTick();
  grid.value?.scrollToGroup(target, false);
}

/**
 * A pack opened from outside ("Open pack" on a custom emoji or sticker): its tab, browsing, scrolled
 * to it with its entry current in the rail. False when this picker does not offer it.
 */
async function openPack(packId: string): Promise<boolean> {
  const pack = packById.value.get(packId);
  if (!pack || !spaces.value.some((space) => space.spaceId === pack.spaceId)) return false;
  const tab: PickerTab = pack.kind === ExpressionKind.Sticker ? "stickers" : "emoji";
  if (!visibleTabs.value.includes(tab)) return false;
  selectTab(tab);
  query.value = "";
  // A new grid mounts, then lays itself out at its measured width.
  await nextTick();
  await nextTick();
  return grid.value?.scrollToSection(`pack:${packId}`) ?? false;
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

/** `pick`: choosing a tone also sends the emoji (a cell's menu); the header's button only sets it. */
const toneTarget = shallowRef<{ entry: EmojiEntry; el: HTMLElement; pick: boolean } | null>(null);
const toneButton = ref<HTMLButtonElement | null>(null);
const handEntry = computed(() => emojiRegistry.getByText("👋") ?? null);
const handSprite = computed(() => {
  const hand = handEntry.value;
  return hand ? (spriteResolver.getStyle(tonedEntry(hand, tone.value, (text) => emojiRegistry.getByText(text)), 22) ?? undefined) : undefined;
});

function openToneMenu() {
  const hand = handEntry.value;
  if (!hand || !toneButton.value) return;
  closePreview();
  toneTarget.value = toneTarget.value ? null : { entry: hand, el: toneButton.value, pick: false };
}

function onToneSelect(next: SkinTone) {
  const target = toneTarget.value;
  toneStore.set(next);
  toneTarget.value = null;
  if (!target) return;
  target.el.focus({ preventScroll: true });
  if (target.pick) selectUnicode(target.entry, next);
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
  if (cell) inspected.value = cell;
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
      toneTarget.value = { entry: cell.entry, el, pick: true };
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

function openSettings() {
  closePreview();
  emit("open-settings");
}

// ── lifecycle ──

function load(spaceId: string | null) {
  if (spaceId) void store.ensureLoaded(spaceId);
  else if (spaceId === null) void store.ensureLoadedAll();
}

watch(() => props.spaceId, load);

watch(query, () => {
  closePreview();
  inspected.value = null;
  toneTarget.value = null;
});

onMounted(async () => {
  getLottiePool().unlockGroup("picker");
  load(props.spaceId);
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

defineExpose({ focusSearch, selectTab, activeTab, openPack });
</script>

<template>
  <div class="xp" :style="rootStyle" data-expression-picker @keydown="onRootKeydown">
    <div class="xp-head">
      <div ref="tablist" class="xp-tabs" role="tablist">
        <button
          v-for="tab in visibleTabs"
          :key="tab"
          type="button"
          role="tab"
          class="xp-tabs__tab"
          :class="{ 'is-active': tab === activeTab }"
          :data-tab="tab"
          :aria-selected="tab === activeTab"
          :tabindex="tab === activeTab ? 0 : -1"
          @click="selectTab(tab)"
          @keydown="onTabKeydown"
        >
          {{ t(`expression_picker_tab_${tab}`) }}
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
      <button
        v-if="activeTab === 'emoji' && handSprite"
        ref="toneButton"
        type="button"
        class="xp-tone"
        data-tone-button
        :title="t('expression_picker_skin_tone')"
        :aria-label="t('expression_picker_skin_tone')"
        :aria-expanded="!!toneTarget && !toneTarget.pick"
        @click="openToneMenu"
      >
        <span class="xp-tone__sprite" :style="handSprite" aria-hidden="true" />
      </button>
    </div>

    <div class="xp-body">
      <div v-if="activeTab === 'gifs'" class="xp-gifs">
        <GifPicker
          :search-query="query"
          @select="emit('select-gif', $event)"
          @select-saved="emit('select-saved-gif', $event)"
        />
      </div>
      <div v-else-if="nothingToBrowse" class="xp-empty" data-empty>
        <StickerIcon class="xp-empty__icon" aria-hidden="true" />
        <p>{{ t("expression_picker_no_stickers") }}</p>
        <Button v-if="manageLabel" size="sm" variant="secondary" @click="openSettings">
          {{ manageLabel }}
        </Button>
      </div>
      <template v-else>
        <PickerRail
          :entries="rail"
          :active="searching ? null : activeGroup"
          :label="t(`expression_picker_tab_${activeTab}`)"
          :manage-label="manageLabel"
          @select="jumpTo"
          @manage="openSettings"
        />
        <div class="xp-main">
          <div class="xp-scrollbox">
            <PickerGrid
              v-if="gridGroups.length"
              :key="gridKey"
              ref="grid"
              :groups="gridGroups"
              :metrics="metrics"
              :tone="tone"
              @select="onSelect"
              @context="onContext"
              @hover="onHover"
              @focus="inspected = $event"
              @release="closePreview"
              @scroll="closePreview"
              @active-change="activeGroup = $event"
              @type-ahead="onTypeAhead"
            />
            <div v-else class="xp-empty" data-empty>
              <EmptyStateArt name="not-found" :size="96" />
              <p>{{ t("expression_picker_no_results") }}</p>
            </div>
          </div>
          <PickerFooter :cell="footerCell" :tone="tone" :detail="footerDetail" />
        </div>
      </template>
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
  flex: none;
  overflow: hidden;
  border-radius: var(--radius);
  background: hsl(var(--popover));
  color: hsl(var(--popover-foreground));
}

.xp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 8px;
  flex: none;
  border-bottom: 1px solid hsl(var(--border) / 0.6);
}

.xp-tabs {
  display: flex;
  gap: 2px;
  flex: none;
}

.xp-tabs__tab {
  height: 30px;
  padding: 0 10px;
  border-radius: calc(var(--radius) - 4px);
  font-size: 0.875rem;
  font-weight: 600;
  white-space: nowrap;
  color: hsl(var(--muted-foreground));
  transition: background-color 0.12s ease, color 0.12s ease;
}

.xp-tabs__tab:hover {
  background: hsl(var(--accent) / 0.5);
  color: hsl(var(--foreground));
}

.xp-tabs__tab.is-active {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.xp-tabs__tab:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}

.xp-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 30px;
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

.xp-tone {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: calc(var(--radius) - 2px);
  transition: background-color 0.12s ease;
}

.xp-tone:hover,
.xp-tone[aria-expanded="true"] {
  background: hsl(var(--accent));
}

.xp-tone:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}

.xp-tone__sprite {
  display: block;
  width: 22px;
  height: 22px;
  background-repeat: no-repeat;
}

.xp-body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.xp-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.xp-scrollbox {
  position: relative;
  flex: 1;
  min-height: 0;
}

.xp-gifs {
  flex: 1;
  min-width: 0;
  height: 100%;
}

.xp-empty {
  display: flex;
  flex: 1;
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
</style>
