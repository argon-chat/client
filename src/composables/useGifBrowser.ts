import { ref, watch, toRef, type MaybeRefOrGetter } from "vue";
import { useApi } from "@/store/system/apiStore";
import type { GifItem, SavedGif, GifCategory } from "@argon/glue";
import { SuccessSaveGif, FailedSaveGif, SaveGifError } from "@argon/glue";
import { logger } from "@argon/core";

export type GifBrowseMode = "trending" | "search" | "saved" | "categories";

export interface UseGifBrowserOptions {
  searchQuery: MaybeRefOrGetter<string>;
  perPage?: number;
  debounce?: number;
}

export function useGifBrowser(options: UseGifBrowserOptions) {
  const { searchQuery: _searchQuery, perPage = 30, debounce = 300 } = options;
  const searchQuery = toRef(_searchQuery);
  const api = useApi();

  const mode = ref<GifBrowseMode>("trending");
  const items = ref<GifItem[]>([]);
  const savedItems = ref<SavedGif[]>([]);
  const categories = ref<GifCategory[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const hasNext = ref(false);
  const page = ref(0);
  const savedPage = ref(0);
  const savedHasNext = ref(true);

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Fetch trending GIFs
  const fetchTrending = async (reset = true) => {
    if (reset) {
      page.value = 0;
      items.value = [];
    }
    const isMore = !reset;
    if (isMore) loadingMore.value = true;
    else loading.value = true;

    try {
      const result = await api.gifInteraction.GetTrending(page.value, perPage);
      if (reset) {
        items.value = [...result.items];
      } else {
        items.value = [...items.value, ...result.items];
      }
      hasNext.value = result.hasNext;
      page.value++;
    } catch (e) {
      logger.error("Failed to fetch trending GIFs:", e);
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  };

  // Search GIFs
  const fetchSearch = async (query: string, reset = true) => {
    if (!query.trim()) {
      mode.value = "trending";
      fetchTrending();
      return;
    }
    if (reset) {
      page.value = 0;
      items.value = [];
    }
    const isMore = !reset;
    if (isMore) loadingMore.value = true;
    else loading.value = true;

    try {
      const result = await api.gifInteraction.Search(query, page.value, perPage);
      if (reset) {
        items.value = [...result.items];
      } else {
        items.value = [...items.value, ...result.items];
      }
      hasNext.value = result.hasNext;
      page.value++;
    } catch (e) {
      logger.error("Failed to search GIFs:", e);
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  };

  // Fetch saved GIFs
  const fetchSaved = async (reset = true) => {
    if (reset) {
      savedPage.value = 0;
      savedItems.value = [];
    }
    const isMore = !reset;
    if (isMore) loadingMore.value = true;
    else loading.value = true;

    try {
      const result = await api.gifInteraction.GetSavedGifs(savedPage.value, perPage);
      const arr = [...result];
      if (reset) {
        savedItems.value = arr;
      } else {
        savedItems.value = [...savedItems.value, ...arr];
      }
      savedHasNext.value = arr.length >= perPage;
      savedPage.value++;
    } catch (e) {
      logger.error("Failed to fetch saved GIFs:", e);
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  };

  // Fetch categories
  const fetchCategories = async () => {
    loading.value = true;
    try {
      const result = await api.gifInteraction.GetCategories();
      categories.value = [...result];
    } catch (e) {
      logger.error("Failed to fetch GIF categories:", e);
    } finally {
      loading.value = false;
    }
  };

  // Save a GIF
  const saveGif = async (gifId: string, hmac: string) => {
    try {
      const result = await api.gifInteraction.SaveGif(gifId, hmac);
      if (result instanceof SuccessSaveGif) {
        // Prepend to saved list if we have it loaded
        savedItems.value = [result.gif, ...savedItems.value];
        return true;
      } else if (result instanceof FailedSaveGif) {
        if (result.error === SaveGifError.ALREADY_SAVED) {
          // Not an error — server bumped it to first position
          return true;
        }
        if (result.error === SaveGifError.INVALID_HMAC) {
          logger.error("SaveGif: invalid HMAC for gifId:", gifId);
        }
        if (result.error === SaveGifError.NOT_FOUND) {
          logger.warn("SaveGif: GIF not found on provider:", gifId);
        }
        return false;
      }
    } catch (e) {
      logger.error("Failed to save GIF:", e);
      return false;
    }
  };

  // Remove saved GIF
  const removeSavedGif = async (savedGifId: string) => {
    try {
      const ok = await api.gifInteraction.RemoveSavedGif(savedGifId);
      if (ok) {
        savedItems.value = savedItems.value.filter(g => g.id !== savedGifId);
      }
      return ok;
    } catch (e) {
      logger.error("Failed to remove saved GIF:", e);
      return false;
    }
  };

  // Load more (next page)
  const loadMore = () => {
    if (loadingMore.value || !hasNext.value) return;
    if (mode.value === "search") {
      fetchSearch(searchQuery.value, false);
    } else if (mode.value === "trending") {
      fetchTrending(false);
    }
  };

  const loadMoreSaved = () => {
    if (loadingMore.value || !savedHasNext.value) return;
    fetchSaved(false);
  };

  // Switch mode
  const setMode = (newMode: GifBrowseMode) => {
    mode.value = newMode;
    if (newMode === "trending") {
      fetchTrending();
    } else if (newMode === "saved") {
      fetchSaved();
    } else if (newMode === "categories") {
      fetchCategories();
    }
  };

  // Watch search query — debounced
  watch(searchQuery, (q) => {
    if (searchTimeout) clearTimeout(searchTimeout);
    const trimmed = q.trim();

    if (!trimmed) {
      if (mode.value === "search") {
        mode.value = "trending";
        fetchTrending();
      }
      return;
    }

    mode.value = "search";
    loading.value = true;
    searchTimeout = setTimeout(() => {
      fetchSearch(trimmed);
    }, debounce);
  });

  // Initial load
  fetchTrending();

  return {
    mode,
    items,
    savedItems,
    categories,
    loading,
    loadingMore,
    hasNext,
    savedHasNext,
    fetchTrending,
    fetchSearch,
    fetchSaved,
    fetchCategories,
    saveGif,
    removeSavedGif,
    loadMore,
    loadMoreSaved,
    setMode,
  };
}
