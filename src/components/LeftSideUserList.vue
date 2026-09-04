<template>
  <div class="user-list-outer w-56 flex flex-col overflow-hidden">
    <!-- Header: online count + collapsible search -->
    <div class="user-list-header">
      <div class="ulh-row">
        <div class="ulh-count">
          <span class="ulh-dot"></span>
          {{ onlineCount }} online
        </div>
        <button
          class="ulh-search-toggle"
          :class="{ 'ulh-search-toggle--active': searchOpen }"
          :title="t('search_placeholder')"
          @click="toggleSearch"
        >
          <IconSearch class="w-3.5 h-3.5" />
        </button>
      </div>

      <Transition name="ulh-expand">
        <div v-if="searchOpen" class="ulh-search">
          <IconSearch class="ulh-search-icon" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            :placeholder="t('search_placeholder')"
            class="ulh-input"
            @blur="onSearchBlur"
            @keydown.esc="closeSearch"
          />
        </div>
      </Transition>
    </div>

    <!-- Scrollable list (virtualised: only the rows in view exist in the DOM) -->
    <div ref="scrollEl" class="user-list-scroll" @scroll.passive="onScroll">
      <Transition name="panel-swap" mode="out-in">
      <!-- Loading skeletons -->
      <div v-if="membersLoading && groupedUsers.length === 0" key="loading">
        <div v-for="g in 2" :key="`mg-${g}`" class="mb-3">
          <Skeleton class="h-2.5 w-20 mb-2 ml-1 rounded" />
          <div v-for="u in 4" :key="`mu-${g}-${u}`" class="flex items-center gap-2.5 px-1.5 py-1.5">
            <Skeleton class="h-7 w-7 rounded-full shrink-0" />
            <Skeleton class="h-2.5 rounded" :style="{ width: `${45 + ((g * 7 + u * 11) % 40)}%` }" />
          </div>
        </div>
      </div>

      <div v-else key="members">
        <div v-if="rows.length" class="vlist" :style="{ height: `${totalHeight}px` }">
          <div class="vlist-window" :style="{ transform: `translateY(${windowTop}px)` }">
            <template v-for="row in visibleRows" :key="row.key">
              <div v-if="row.kind === 'header'" class="vrow" :style="{ height: `${row.height}px`, paddingTop: `${row.gap}px` }">
                <button class="group-header" @click="toggleGroup(row.group.archetype.id)">
                  <IconChevronDown class="group-chevron" :class="{ 'group-chevron--collapsed': isCollapsed(row.group.archetype.id) }" />
                  <img v-if="row.group.archetype.iconFileId" :src="`/api/icons/${row.group.archetype.iconFileId}`" class="w-3.5 h-3.5" />
                  <span class="group-name" :style="{ color: formatColour(row.group.archetype.colour) }">{{ row.group.archetype.name }}</span>
                  <span class="group-count">&mdash; {{ row.group.users.length }}</span>
                </button>
              </div>
              <div v-else class="vrow" :style="{ height: `${row.height}px` }">
                <div class="user-item">
                  <UserInListSideElement :user="row.user" />
                </div>
              </div>
            </template>
          </div>
        </div>

        <div v-if="groups.length === 0" class="empty-state">
          <EmptyStateArt :name="searchQuery.trim() ? 'not-found' : 'no-friends-online'" :size="116" />
          <span>{{ searchQuery.trim() ? t("no_results") : t("no_members_online") }}</span>
        </div>
      </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLocale } from "@/store/system/localeStore";
import { usePoolStore } from "@/store/data/poolStore";
import UserInListSideElement from "./UserInListSideElement.vue";
import Skeleton from "./shared/Skeleton.vue";
import EmptyStateArt from "./shared/EmptyStateArt.vue";
import { computed, ref, nextTick, onMounted, onUnmounted } from "vue";
import { persistedValue } from "@argon/storage";
import { useListLoading } from "@/composables/useListLoading";
import { IconChevronDown, IconSearch } from "@tabler/icons-vue";
import type { Archetype } from "@argon/glue";
import type { RealtimeUser } from "@/store/db/dexie";

const OFFLINE_GROUP_ID = "00000000-0000-0000-0000-000000000001";

const model = defineModel<string | null>('selectedSpace', {
    type: String, required: true
});

const dataPool = usePoolStore();
const groupedUsers = dataPool.useGroupedServerUsers(model);

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const isLightTheme = computed(() => currentTheme.value === "light");

const { t } = useLocale();

// Search — hidden until the user opens it (icon toggle), collapses when emptied.
const searchQuery = ref('');
const searchOpen = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);

function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) nextTick(() => searchInput.value?.focus());
  else searchQuery.value = '';
}

function onSearchBlur() {
  if (!searchQuery.value.trim()) searchOpen.value = false;
}

function closeSearch() {
  searchQuery.value = '';
  searchOpen.value = false;
  searchInput.value?.blur();
}

// Collapsed groups — persisted across sessions (archetype ids are globally unique).
const collapsed = persistedValue<Record<string, boolean>>("memberlist.collapsed", {});

function toggleGroup(id: string) {
  collapsed[id] = !collapsed[id];
}

function isCollapsed(id: string) {
  return !!collapsed[id];
}

// Online = everyone except the synthetic "Offline" group.
const onlineCount = computed(() =>
  groupedUsers.value
    .filter(g => g.archetype.id !== OFFLINE_GROUP_ID)
    .reduce((sum, g) => sum + g.users.length, 0)
);

const totalCount = computed(() =>
  groupedUsers.value.reduce((sum, g) => sum + g.users.length, 0)
);

const membersLoading = useListLoading(totalCount, model);

// Search-filtered groups.
const groups = computed(() => {
  const all = groupedUsers.value;
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return all;
  return all
    .map(g => ({ ...g, users: g.users.filter(u => u.displayName.toLowerCase().includes(q)) }))
    .filter(g => g.users.length > 0);
});

// ── Virtualisation ────────────────────────────────────────────────────────────────────────────
// Every member of the space used to be a live component, the Offline group included, and collapsed
// groups merely hid theirs. A big space meant thousands of rows in the DOM for as long as it was
// open — and a full re-patch on every presence change. Now the list is one tall box and only the
// rows inside the viewport (plus a margin) exist; heights are fixed per row kind, so positions are
// arithmetic and a collapsed group simply contributes no rows.
type GroupVm = { archetype: Archetype; users: RealtimeUser[] };
type Row =
  | { kind: "header"; key: string; group: GroupVm; height: number; gap: number }
  | { kind: "user"; key: string; user: RealtimeUser; height: number };

const HEADER_H = 24;    // .group-header box
const GROUP_GAP = 8;    // breathing room above every group but the first
const USER_H = 46;      // 44px .user-item + 2px spacing
const OVERSCAN_PX = 240;

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  groups.value.forEach((group, i) => {
    const gap = i === 0 ? 0 : GROUP_GAP;
    out.push({ kind: "header", key: `h:${group.archetype.id}`, group, height: HEADER_H + gap, gap });
    if (isCollapsed(group.archetype.id)) return;
    for (const user of group.users) {
      out.push({ kind: "user", key: `u:${user.userId}`, user, height: USER_H });
    }
  });
  return out;
});

const rowOffsets = computed(() => {
  const offsets = new Array<number>(rows.value.length);
  let y = 0;
  rows.value.forEach((row, i) => { offsets[i] = y; y += row.height; });
  return offsets;
});

const totalHeight = computed(() => {
  const list = rows.value;
  if (!list.length) return 0;
  return rowOffsets.value[list.length - 1] + list[list.length - 1].height;
});

const scrollEl = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportH = ref(0);
let scrollRaf = 0;
let resizeObserver: ResizeObserver | null = null;

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    scrollTop.value = scrollEl.value?.scrollTop ?? 0;
  });
}

onMounted(() => {
  const el = scrollEl.value;
  if (!el) return;
  viewportH.value = el.clientHeight;
  resizeObserver = new ResizeObserver(() => { viewportH.value = el.clientHeight; });
  resizeObserver.observe(el);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
});

/** Index of the last row that starts at or above `y`. */
function rowAt(offsets: number[], y: number): number {
  let lo = 0, hi = offsets.length - 1, found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

const visibleRange = computed(() => {
  const count = rows.value.length;
  if (!count) return { start: 0, end: 0 };
  const offsets = rowOffsets.value;
  const height = viewportH.value || 800; // not measured yet: draw a screenful rather than nothing
  const start = rowAt(offsets, scrollTop.value - OVERSCAN_PX);
  const end = Math.min(count, rowAt(offsets, scrollTop.value + height + OVERSCAN_PX) + 1);
  return { start, end };
});

const visibleRows = computed(() => rows.value.slice(visibleRange.value.start, visibleRange.value.end));
const windowTop = computed(() => rowOffsets.value[visibleRange.value.start] ?? 0);

// Calculate relative luminance
const getLuminance = (r: number, g: number, b: number) => {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const formatColour = (argb: number) => {
  const a = ((argb >> 24) & 0xff) / 255;
  let r = (argb >> 16) & 0xff;
  let g = (argb >> 8) & 0xff;
  let b = argb & 0xff;

  const luminance = getLuminance(r, g, b);

  if (isLightTheme.value) {
    if (luminance > 0.5) {
      const factor = 0.6;
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
    }
  } else {
    if (luminance < 0.1) {
      const factor = 2;
      r = Math.min(255, Math.round(r * factor + 50));
      g = Math.min(255, Math.round(g * factor + 50));
      b = Math.min(255, Math.round(b * factor + 50));
    }
  }

  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
};
</script>

<style lang="css" scoped>
.user-list-outer {
  background-color: hsl(var(--card) / var(--card-alpha));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: var(--radius);
}

/* Header — minimal height by default; grows only when search expands. */
.user-list-header {
  display: flex;
  flex-direction: column;
  padding: 3px 6px;
  border-bottom: 1px solid hsl(var(--border) / 0.35);
}

.ulh-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 20px;
}

.ulh-count {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground) / 0.7);
  padding-left: 2px;
}

.ulh-search-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground) / 0.65);
  border-radius: 5px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.ulh-search-toggle:hover {
  background: hsl(var(--accent) / 0.5);
  color: hsl(var(--foreground));
}

.ulh-search-toggle--active {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

.ulh-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 5px #22c55e88;
  flex-shrink: 0;
}

.ulh-search {
  position: relative;
  margin-top: 6px;
}

/* Collapsible search reveal */
.ulh-expand-enter-active,
.ulh-expand-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease, max-height 0.18s ease,
    margin-top 0.18s ease;
  overflow: hidden;
}
.ulh-expand-enter-from,
.ulh-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
  margin-top: 0;
}
.ulh-expand-enter-to,
.ulh-expand-leave-from {
  opacity: 1;
  max-height: 44px;
}

.ulh-search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: hsl(var(--muted-foreground) / 0.7);
  pointer-events: none;
}

.ulh-input {
  width: 100%;
  height: 30px;
  padding: 0 10px 0 28px;
  font-size: 0.78rem;
  color: hsl(var(--foreground));
  background: hsl(var(--muted) / 0.5);
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.ulh-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.6);
}

.ulh-input:focus {
  background: hsl(var(--muted));
  border-color: hsl(var(--primary) / 0.5);
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15);
}

/* Scrollable list — scrollbar fully hidden (no layout shift, no eaten pixels). */
/* Skeletons -> content. The two states are the same panel at two moments, so they hand over
   rather than cut: the placeholder fades out, the real list fades in a few pixels lower. Sequential
   (`out-in`) because both live in the same scroll flow — crossfading them would need one taken out
   of flow, and the panel would jump by whatever the other one measured. */
.panel-swap-enter-active {
  transition: opacity 220ms ease-out, transform 220ms ease-out;
}

.panel-swap-leave-active {
  transition: opacity 140ms ease-in;
}

.panel-swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.panel-swap-leave-to {
  opacity: 0;
}

.user-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* legacy Edge */
}

.user-list-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/* Group header */
.group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  font-size: 0.6875rem;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.7);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  height: 24px;
  margin-bottom: 0;
  padding: 0 4px;
  border-radius: calc(var(--radius) - 6px);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.group-header:hover {
  color: hsl(var(--muted-foreground));
  background: hsl(var(--accent) / 0.4);
}

.group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  transition: transform 0.2s ease;
  opacity: 0.5;
}

.group-chevron--collapsed {
  transform: rotate(-90deg);
}

.group-count {
  font-weight: 400;
  opacity: 0.5;
  flex-shrink: 0;
  margin-left: auto;
}

/* Virtualised rows: the list is one tall box, and only the rows in view are positioned inside it. */
.vlist {
  position: relative;
}

.vlist-window {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  will-change: transform;
}

.vrow {
  box-sizing: border-box;
}

/* User item */
.user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 5px 6px;
  border-radius: calc(var(--radius) - 4px);
  cursor: pointer;
  transition: background 0.15s ease;
  overflow: hidden;
}

.user-item:hover {
  background: hsl(var(--accent));
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 1.25rem 1rem;
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 0.78rem;
  text-align: center;
}
</style>
