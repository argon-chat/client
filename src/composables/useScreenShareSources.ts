import { ref, watch, onBeforeUnmount } from "vue";
import { native } from "@argon/glue/native";

export interface ScreenSource {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
  displayId: string;
}

export const qualityPresets = [
  { label: "720p", w: 1280, h: 720, maxBitrate: 2_500_000 },
  { label: "1080p", w: 1920, h: 1080, maxBitrate: 5_000_000 },
  { label: "1440p", w: 2560, h: 1440, maxBitrate: 8_000_000 },
  { label: "4K", w: 3840, h: 2160, maxBitrate: 14_000_000 },
] as const;

export const fpsPresets = [
  { label: "15 fps", value: "15" },
  { label: "30 fps", value: "30" },
  { label: "60 fps", value: "60" },
] as const;

export function useScreenShareSources() {
  const openShareSettings = ref(false);
  const shareTab = ref<string>("screens");
  const includeAudio = ref(false);
  const quality = ref("1080p");
  const fps = ref("30");
  const sourcesLoading = ref(false);
  const selectedSourceId = ref<string | null>(null);

  const screenSources = ref<ScreenSource[]>([]);
  const windowSources = ref<ScreenSource[]>([]);

  let thumbnailRefreshTimer: ReturnType<typeof setInterval> | null = null;

  function stopThumbnailRefresh() {
    if (thumbnailRefreshTimer) {
      clearInterval(thumbnailRefreshTimer);
      thumbnailRefreshTimer = null;
    }
  }

  async function refreshThumbnails() {
    try {
      const sources: ScreenSource[] = await native.hostProc.getScreenSources(["screen", "window"]);
      for (const src of sources) {
        const existing = screenSources.value.find((s) => s.id === src.id);
        if (existing) existing.thumbnailDataUrl = src.thumbnailDataUrl;
        const existingWin = windowSources.value.find((s) => s.id === src.id);
        if (existingWin) existingWin.thumbnailDataUrl = src.thumbnailDataUrl;
      }
    } catch {}
  }

  function startThumbnailRefresh() {
    stopThumbnailRefresh();
    thumbnailRefreshTimer = setInterval(refreshThumbnails, 2000);
  }

  onBeforeUnmount(stopThumbnailRefresh);

  async function loadSources() {
    sourcesLoading.value = true;
    selectedSourceId.value = null;
    stopThumbnailRefresh();
    try {
      const sources: ScreenSource[] = await native.hostProc.getScreenSources(["screen", "window"]);
      screenSources.value = sources.filter((s) => s.id.startsWith("screen:"));
      windowSources.value = sources.filter((s) => s.id.startsWith("window:"));

      const tabSources = shareTab.value === "screens" ? screenSources.value : windowSources.value;
      if (tabSources.length > 0) {
        selectedSourceId.value = tabSources[0].id;
      }
    } catch (e) {
      console.error("Failed to load screen sources:", e);
      screenSources.value = [];
      windowSources.value = [];
    } finally {
      sourcesLoading.value = false;
      startThumbnailRefresh();
    }
  }

  watch(openShareSettings, (isOpen) => {
    if (isOpen) {
      loadSources();
    } else {
      screenSources.value = [];
      windowSources.value = [];
      selectedSourceId.value = null;
      stopThumbnailRefresh();
    }
  });

  watch(shareTab, (tab) => {
    const tabSources = tab === "screens" ? screenSources.value : windowSources.value;
    if (tabSources.length > 0) {
      selectedSourceId.value = tabSources[0].id;
    } else {
      selectedSourceId.value = null;
    }
  });

  function getSelectedPreset() {
    const preset = qualityPresets.find((q) => q.label === quality.value) ?? qualityPresets[1];
    const fpsValue = parseInt(fps.value, 10) || 30;
    return { preset, fpsValue };
  }

  return {
    openShareSettings,
    shareTab,
    includeAudio,
    quality,
    fps,
    sourcesLoading,
    selectedSourceId,
    screenSources,
    windowSources,
    getSelectedPreset,
  };
}
