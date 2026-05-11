<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useGifBrowser } from "@/composables/useGifBrowser";
import type { GifItem, SavedGif } from "@argon/glue";

const props = defineProps<{
  searchQuery: string;
}>();

const emit = defineEmits<{
  select: [gif: GifItem];
  selectSaved: [gif: SavedGif];
}>();

const {
  mode,
  items,
  savedItems,
  categories,
  loading,
  loadingMore,
  hasNext,
  savedHasNext,
  loadMore,
  loadMoreSaved,
  setMode,
  saveGif,
  removeSavedGif,
} = useGifBrowser({ searchQuery: () => props.searchQuery });

const showSaved = ref(false);

// Toggle saved view
const toggleSaved = () => {
  showSaved.value = !showSaved.value;
  if (showSaved.value) {
    setMode("saved");
  } else {
    setMode("trending");
  }
};

// When search query changes, exit saved mode
watch(() => props.searchQuery, (q) => {
  if (q.trim()) {
    showSaved.value = false;
  }
});

// Infinite scroll handler
const scrollContainerRef = ref<HTMLElement | null>(null);
const handleScroll = (e: Event) => {
  const el = e.target as HTMLElement;
  if (!el) return;
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 100;
  if (!nearBottom) return;

  if (showSaved.value) {
    loadMoreSaved();
  } else {
    loadMore();
  }
};

// Click on a GIF
const handleGifClick = (gif: GifItem) => {
  emit("select", gif);
};

const handleSavedGifClick = (gif: SavedGif) => {
  emit("selectSaved", gif);
};

// Right-click to save/unsave
const handleGifContextMenu = (e: MouseEvent, gif: GifItem) => {
  e.preventDefault();
  saveGif(gif.gifId, gif.hmac);
};

const handleSavedGifContextMenu = (e: MouseEvent, gif: SavedGif) => {
  e.preventDefault();
  removeSavedGif(gif.id);
};

// Category click — search by category title
const handleCategoryClick = (title: string) => {
  // This emits nothing — the parent watches searchQuery prop.
  // We can't directly set search from here, but the category approach
  // would need a separate mechanism. For now, categories are secondary.
};

// Display items
const displayItems = computed(() => {
  if (showSaved.value) return [];
  return items.value;
});

const displaySaved = computed(() => {
  if (!showSaved.value) return [];
  return savedItems.value;
});

const isSearching = computed(() => props.searchQuery.trim().length > 0);

// Calculate aspect ratio for grid items
const getAspectStyle = (width: number, height: number) => {
  const ratio = Math.max(0.5, Math.min(2, width / height));
  return { aspectRatio: `${ratio}` };
};
</script>

<template>
  <div class="gif-picker">
    <!-- Saved toggle bar -->
    <div class="gif-picker-toolbar" v-if="!isSearching">
      <button
        type="button"
        class="gif-picker-saved-btn"
        :class="{ 'gif-picker-saved-btn--active': showSaved }"
        @click="toggleSaved"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
        </svg>
        <span>{{ showSaved ? 'Trending' : 'Saved' }}</span>
      </button>
    </div>

    <!-- GIF grid -->
    <div
      ref="scrollContainerRef"
      class="gif-picker-grid-container"
      @scroll="handleScroll"
    >
      <!-- Loading state -->
      <div v-if="loading && !items.length && !savedItems.length" class="gif-picker-loading">
        <div class="gif-picker-spinner" />
      </div>

      <!-- Trending / Search results -->
      <div v-else-if="!showSaved" class="gif-picker-grid">
        <button
          v-for="gif in displayItems"
          :key="gif.gifId"
          type="button"
          class="gif-picker-item"
          :style="getAspectStyle(gif.width, gif.height)"
          @click="handleGifClick(gif)"
          @contextmenu="handleGifContextMenu($event, gif)"
          :title="gif.title || gif.gifId"
        >
          <img
            :src="gif.previewUrl"
            :alt="gif.title || 'GIF'"
            loading="lazy"
            class="gif-picker-img"
          />
        </button>

        <!-- Empty search -->
        <div v-if="!loading && !displayItems.length && isSearching" class="gif-picker-empty">
          No GIFs found
        </div>
      </div>

      <!-- Saved GIFs -->
      <div v-else class="gif-picker-grid">
        <button
          v-for="gif in displaySaved"
          :key="gif.id"
          type="button"
          class="gif-picker-item"
          :style="getAspectStyle(gif.width, gif.height)"
          @click="handleSavedGifClick(gif)"
          @contextmenu="handleSavedGifContextMenu($event, gif)"
        >
          <img
            :src="gif.previewUrl"
            alt="Saved GIF"
            loading="lazy"
            class="gif-picker-img"
          />
        </button>

        <div v-if="!loading && !displaySaved.length" class="gif-picker-empty">
          No saved GIFs yet
        </div>
      </div>

      <!-- Loading more indicator -->
      <div v-if="loadingMore" class="gif-picker-loading-more">
        <div class="gif-picker-spinner gif-picker-spinner--sm" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.gif-picker {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.gif-picker-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  gap: 4px;
  border-bottom: 1px solid var(--emojix-border, #e5e7eb);
}

.gif-picker-saved-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--emojix-text-muted, #9ca3af);
  transition: background-color 0.15s, color 0.15s;
}

.gif-picker-saved-btn:hover {
  background: var(--emojix-bg-hover, rgba(0, 0, 0, 0.05));
  color: var(--emojix-text, #1f2937);
}

.gif-picker-saved-btn--active {
  background: var(--emojix-bg-active, rgba(59, 130, 246, 0.1));
  color: var(--emojix-text, #1f2937);
}

.gif-picker-grid-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--emojix-scrollbar, #ccc) transparent;
}

.gif-picker-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  padding: 4px;
}

.gif-picker-item {
  position: relative;
  display: block;
  border: none;
  padding: 0;
  margin: 0;
  background: var(--emojix-bg-secondary, #f3f4f6);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
  min-height: 80px;
}

.gif-picker-item:hover {
  transform: scale(1.02);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.gif-picker-item:active {
  transform: scale(0.98);
}

.gif-picker-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gif-picker-loading,
.gif-picker-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--emojix-text-muted, #9ca3af);
  font-size: 13px;
}

.gif-picker-loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.gif-picker-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--emojix-border, #e5e7eb);
  border-top-color: var(--emojix-text-muted, #9ca3af);
  border-radius: 50%;
  animation: gif-spin 0.6s linear infinite;
}

.gif-picker-spinner--sm {
  width: 16px;
  height: 16px;
}

@keyframes gif-spin {
  to { transform: rotate(360deg); }
}
</style>
