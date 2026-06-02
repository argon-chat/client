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

    <!-- Scrollable list -->
    <div class="user-list-scroll">
      <!-- Loading skeletons -->
      <template v-if="membersLoading && groupedUsers.length === 0">
        <div v-for="g in 2" :key="`mg-${g}`" class="mb-3">
          <Skeleton class="h-2.5 w-20 mb-2 ml-1 rounded" />
          <div v-for="u in 4" :key="`mu-${g}-${u}`" class="flex items-center gap-2.5 px-1.5 py-1.5">
            <Skeleton class="h-7 w-7 rounded-full shrink-0" />
            <Skeleton class="h-2.5 rounded" :style="{ width: `${45 + ((g * 7 + u * 11) % 40)}%` }" />
          </div>
        </div>
      </template>

      <template v-else>
        <div v-for="group in groups" :key="group.archetype.id" class="mb-2 last:mb-0">
          <button class="group-header" @click="toggleGroup(group.archetype.id)">
            <IconChevronDown class="group-chevron" :class="{ 'group-chevron--collapsed': isCollapsed(group.archetype.id) }" />
            <img v-if="group.archetype.iconFileId" :src="`/api/icons/${group.archetype.iconFileId}`" class="w-3.5 h-3.5" />
            <span class="group-name" :style="{ color: formatColour(group.archetype.colour) }">{{ group.archetype.name }}</span>
            <span class="group-count">&mdash; {{ group.users.length }}</span>
          </button>
          <Transition name="group-collapse">
            <ul v-show="!isCollapsed(group.archetype.id)" class="space-y-0.5">
              <li v-for="user in group.users" :key="user.userId" class="user-item">
                <UserInListSideElement :user="user" />
              </li>
            </ul>
          </Transition>
        </div>

        <div v-if="groups.length === 0" class="empty-state">
          {{ searchQuery ? t("no_results") : t("no_members_online") }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useLocale } from "@/store/system/localeStore";
import { usePoolStore } from "@/store/data/poolStore";
import UserInListSideElement from "./UserInListSideElement.vue";
import Skeleton from "./shared/Skeleton.vue";
import { computed, ref, nextTick } from "vue";
import { persistedValue } from "@argon/storage";
import { useListLoading } from "@/composables/useListLoading";
import { IconChevronDown, IconSearch } from "@tabler/icons-vue";

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
  background-color: hsl(var(--card));
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
  margin-bottom: 2px;
  padding: 4px 4px;
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

/* Group collapse animation */
.group-collapse-enter-active,
.group-collapse-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.group-collapse-enter-from,
.group-collapse-leave-to {
  opacity: 0;
  max-height: 0;
}
.group-collapse-enter-to,
.group-collapse-leave-from {
  opacity: 1;
  max-height: 1000px;
}

/* User item */
.user-item {
  display: flex;
  align-items: center;
  gap: 10px;
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
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  color: hsl(var(--muted-foreground) / 0.5);
  font-size: 0.78rem;
  text-align: center;
}
</style>
