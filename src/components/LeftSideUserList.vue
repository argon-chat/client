<template>
  <div class="user-list-outer rounded-xl w-56 flex flex-col overflow-hidden">
    <!-- Scrollable list -->
    <div class="user-list-scroll">
      <div v-for="group in filteredGroups" :key="group.archetype.id" class="mb-2 last:mb-0">
        <button class="group-header" @click="toggleGroup(group.archetype.id)">
          <IconChevronDown class="group-chevron" :class="{ 'group-chevron--collapsed': isCollapsed(group.archetype.id) }" />
          <img v-if="group.archetype.iconFileId" :src="`/api/icons/${group.archetype.iconFileId}`" class="w-3.5 h-3.5" />
          <span :style="{ color: formatColour(group.archetype.colour) }">{{ group.archetype.name }}</span>
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
      <div v-if="filteredGroups.length === 0" class="empty-state">
        {{ searchQuery ? t("no_results") : t("no_members_online") }}
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useLocale } from "@/store/localeStore";
import { usePoolStore } from "@/store/poolStore";
import UserInListSideElement from "./UserInListSideElement.vue";
import { computed, ref, reactive } from "vue";
import { persistedValue } from "@argon/storage";
import { IconChevronDown } from "@tabler/icons-vue";

const model = defineModel<string | null>('selectedSpace', {
    type: String, required: true
});

const dataPool = usePoolStore();
const groupedUsers = dataPool.useGroupedServerUsers(model);

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const isLightTheme = computed(() => currentTheme.value === "light");

const { t } = useLocale();

// Search
const searchQuery = ref('');

// Collapsed groups
const collapsedGroups = reactive(new Set<string>());

function toggleGroup(id: string) {
  if (collapsedGroups.has(id)) collapsedGroups.delete(id);
  else collapsedGroups.add(id);
}

function isCollapsed(id: string) {
  return collapsedGroups.has(id);
}

// Filtered groups
const filteredGroups = computed(() => {
  if (!groupedUsers.value) return [];
  if (!searchQuery.value.trim()) return groupedUsers.value;
  const q = searchQuery.value.toLowerCase();
  return groupedUsers.value
    .map(g => ({
      ...g,
      users: g.users.filter(u => u.displayName.toLowerCase().includes(q))
    }))
    .filter(g => g.users.length > 0);
});

// Total count
const totalCount = computed(() => {
  if (!groupedUsers.value) return 0;
  return groupedUsers.value.reduce((sum, g) => sum + g.users.length, 0);
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
    // On light theme, darken light colors for readability
    if (luminance > 0.5) {
      const factor = 0.6;
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
    }
  } else {
    // On dark theme, lighten very dark colors for readability
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
  border-radius: 15px;
}

/* Scrollable list */
.user-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 8px 8px;
  scrollbar-width: none;
}

.user-list-scroll:hover {
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--muted)) transparent;
}

.user-list-scroll::-webkit-scrollbar {
  width: 0;
}

.user-list-scroll:hover::-webkit-scrollbar {
  width: 5px;
}

.user-list-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.user-list-scroll::-webkit-scrollbar-thumb {
  background: hsl(var(--muted));
  border-radius: 8px;
}

/* Group header */
.group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border: none;
  background: transparent;
  font-size: 0.68rem;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.7);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
  padding: 4px 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.15s;
}

.group-header:hover {
  color: hsl(var(--muted-foreground));
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
  border-radius: 10px;
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