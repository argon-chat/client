<template>
    <div v-if="me.me" class="control-bar">
        <div class="controls">
            <button :disabled="!isConnected" @click="endActiveCall" class="active">
                <PhoneOffIcon class="w-5 h-5" />
            </button>

            <button @click="toggleMic" :class="{ active: isMicMuted }">
                <MicOff v-if="isMicMuted" class="w-5 h-5" />
                <Mic v-else class="w-5 h-5" />
            </button>

            <button @click="sys.toggleHeadphoneMute" :class="{ active: sys.headphoneMuted }">
                <HeadphoneOff v-if="sys.headphoneMuted" class="w-5 h-5" />
                <Headphones v-else class="w-5 h-5" />
            </button>

            <button @click="toggleScreenCast" :class="{ active: voice.isSharing }" :disabled="!isConnected">
                <ScreenShareOff v-if="voice.isSharing" class="w-5 h-5" />
                <ScreenShare v-else class="w-5 h-5" />
            </button>

            <Dialog v-model:open="openShareSettings">
                <DialogContent class="share-dialog" :style="{ maxWidth: '400px', width: '400px', padding: '0', gap: '0', overflow: 'hidden', borderRadius: '14px' }">
                    <div class="share-header">
                        <DialogHeader>
                            <DialogTitle class="text-base font-semibold">{{ t("screencast") }}</DialogTitle>
                            <DialogDescription class="text-muted-foreground text-xs">
                                {{ t("screencast_title") }}
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <div class="share-tabs-bar">
                        <button
                            class="share-tab-btn"
                            :class="{ active: shareTab === 'screens' }"
                            @click="shareTab = 'screens'"
                        >
                            <Monitor class="w-4 h-4" />
                            {{ t("monitors") }}
                        </button>
                        <button
                            class="share-tab-btn"
                            :class="{ active: shareTab === 'windows' }"
                            @click="shareTab = 'windows'"
                        >
                            <AppWindow class="w-4 h-4" />
                            {{ t("windows") }}
                        </button>
                    </div>

                    <div class="share-sources-area">
                        <div v-if="sourcesLoading" class="share-empty-state">
                            <Loader2 class="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>

                        <template v-else-if="shareTab === 'screens'">
                            <div class="sources-grid cols-2" v-if="screenSources.length > 0">
                                <button
                                    v-for="source in screenSources"
                                    :key="source.id"
                                    class="source-card"
                                    :class="{ selected: selectedSourceId === source.id }"
                                    @click="selectedSourceId = source.id"
                                >
                                    <div class="thumbnail-wrapper">
                                        <img
                                            :src="source.thumbnailDataUrl"
                                            :alt="source.name"
                                            class="thumbnail"
                                        />
                                    </div>
                                    <span class="source-label">{{ source.name }}</span>
                                </button>
                            </div>
                            <div v-else class="share-empty-state">
                                <span class="text-muted-foreground text-xs">{{ t("no_screens_found") }}</span>
                            </div>
                        </template>

                        <template v-else>
                            <div class="sources-grid cols-3" v-if="windowSources.length > 0">
                                <button
                                    v-for="source in windowSources"
                                    :key="source.id"
                                    class="source-card"
                                    :class="{ selected: selectedSourceId === source.id }"
                                    @click="selectedSourceId = source.id"
                                >
                                    <div class="thumbnail-wrapper">
                                        <img
                                            :src="source.thumbnailDataUrl"
                                            :alt="source.name"
                                            class="thumbnail"
                                        />
                                    </div>
                                    <div class="source-label-row">
                                        <img
                                            v-if="source.appIconDataUrl"
                                            :src="source.appIconDataUrl"
                                            class="source-app-icon"
                                        />
                                        <span class="source-label">{{ source.name }}</span>
                                    </div>
                                </button>
                            </div>
                            <div v-else class="share-empty-state">
                                <span class="text-muted-foreground text-xs">{{ t("no_windows_found") }}</span>
                            </div>
                        </template>
                    </div>

                    <div class="share-settings">
                        <div class="share-settings-row">
                            <div class="setting-group">
                                <span class="setting-label">{{ t("quality") }}</span>
                                <select v-model="quality" class="setting-select">
                                    <option v-for="q in qualityPresets" :key="q.label" :value="q.label">
                                        {{ q.label }}
                                    </option>
                                </select>
                            </div>
                            <div class="setting-group">
                                <span class="setting-label">{{ t("fps") }}</span>
                                <select v-model="fps" class="setting-select">
                                    <option v-for="f in fpsPresets" :key="f.label" :value="f.value">
                                        {{ f.label }}
                                    </option>
                                </select>
                            </div>
                            <label class="audio-toggle">
                                <Switch v-model:checked="includeAudio" />
                                <span class="text-xs">{{ t("enable_system_sound") }}</span>
                            </label>
                        </div>
                    </div>

                    <div class="share-footer">
                        <Button
                            type="button"
                            variant="default"
                            class="w-full h-9"
                            :disabled="!selectedSourceId"
                            @click="goShare"
                        >
                            <ScreenShare class="w-4 h-4 mr-2" />
                            {{ t("start") }}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

                <button :disabled="true">
                    <CameraIcon class="w-5 h-5" />
                </button>

                <button v-if="playframeActive"
                    @click="activity.openPicker()" 
                    :disabled="!isConnected"
                    :class="{ active: activity.isActive }"
                    :title="isConnected ? 'Start Activity' : 'Join voice to start activity'"
                >
                    <Gamepad2 class="w-5 h-5" />
                </button>

                <button @click="toggleDoNotDistrurb">
                    <OctagonMinusIcon v-if="status == UserStatus.DoNotDisturb" class="w-5 h-5 text-red-600" />
                    <OctagonMinusIcon v-else class="w-5 h-5" />
                </button>
            </div>
    </div>
</template>

<script setup lang="ts">
import {
    Mic,
    MicOff,
    HeadphoneOff,
    Headphones,
    PhoneOffIcon,
    ScreenShareOff,
    ScreenShare,
    CameraIcon,
    OctagonMinusIcon,
    Gamepad2,
    Monitor,
    AppWindow,
    Loader2,
} from "lucide-vue-next";
import { useMe } from "@/store/meStore";
import { useSystemStore } from "@/store/systemStore";
import { Button } from "@argon/ui/button";
import { Switch } from "@argon/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogHeader,
} from "@argon/ui/dialog";
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useLocale } from "@/store/localeStore";
import { UserStatus } from "@argon/glue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { useApi } from "@/store/apiStore";
import { usePlayFrameActivity } from "@/store/playframeStore";
import { native } from "@argon/glue/native";
import { useFeatureFlags } from "@/store/featureFlagsStore";

const voice = useUnifiedCall();
const api = useApi();
const activity = usePlayFrameActivity();
const { playframeActive } = useFeatureFlags();

const { t } = useLocale();
const me = useMe();
const sys = useSystemStore();

const status = ref(me.me?.currentStatus);
watch(status, (newStatus) => me.changeStatusTo(newStatus!));

const toggleDoNotDistrurb = () => {
    status.value =
        status.value === UserStatus.DoNotDisturb
            ? UserStatus.Online
            : UserStatus.DoNotDisturb;
};

// ── Screen share sources ────────────────────────────────────────────

interface ScreenSource {
    id: string;
    name: string;
    thumbnailDataUrl: string;
    appIconDataUrl: string | null;
    displayId: string;
}

const qualityPresets = [
    { label: "720p", w: 1280, h: 720, maxBitrate: 2_500_000 },
    { label: "1080p", w: 1920, h: 1080, maxBitrate: 5_000_000 },
    { label: "1440p", w: 2560, h: 1440, maxBitrate: 8_000_000 },
    { label: "4K", w: 3840, h: 2160, maxBitrate: 14_000_000 },
];

const fpsPresets = [
    { label: "15 fps", value: "15" },
    { label: "30 fps", value: "30" },
    { label: "60 fps", value: "60" },
];

const openShareSettings = ref(false);
const shareTab = ref<string>("screens");
const includeAudio = ref(false);
const quality = ref("1080p");
const fps = ref("30");
const sourcesLoading = ref(false);
const selectedSourceId = ref<string | null>(null);

const screenSources = ref<ScreenSource[]>([]);
const windowSources = ref<ScreenSource[]>([]);

// ── Live preview streams ────────────────────────────────────────────
// Electron 41+ removed chromeMediaSource support in getUserMedia.
// Use static thumbnails from desktopCapturer instead. Refresh periodically.

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
            const existing = screenSources.value.find(s => s.id === src.id);
            if (existing) existing.thumbnailDataUrl = src.thumbnailDataUrl;
            const existingWin = windowSources.value.find(s => s.id === src.id);
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
        screenSources.value = sources.filter(s => s.id.startsWith("screen:"));
        windowSources.value = sources.filter(s => s.id.startsWith("window:"));

        // Auto-select first source for current tab
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

// Auto-select first source when switching tabs
watch(shareTab, (tab) => {
    const tabSources = tab === "screens" ? screenSources.value : windowSources.value;
    if (tabSources.length > 0) {
        selectedSourceId.value = tabSources[0].id;
    } else {
        selectedSourceId.value = null;
    }
});

// ── Connection state ────────────────────────────────────────────────

const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

const isMicMuted = computed(() => {
    return sys.microphoneMuted;
});

function toggleMic() {
    sys.toggleMicrophoneMute();
}

async function endActiveCall() {
    if (voice.mode === "dm" && voice.callId) {
        try {
            await api.callInteraction.HangupCall(voice.callId);
        } catch (e) {
            console.warn("HangupCall failed", e);
        }
    }
    await voice.leave();
}

const toggleScreenCast = () => {
    if (!isConnected.value) return;

    if (voice.isSharing) {
        voice.stopScreenShare();
    } else {
        openShareSettings.value = true;
    }
};

async function goShare() {
    const sourceId = selectedSourceId.value;
    openShareSettings.value = false;
    if (!isConnected.value || !sourceId) return;

    if (voice.isSharing) {
        await voice.stopScreenShare();
        return;
    }

    const preset = qualityPresets.find(q => q.label === quality.value) ?? qualityPresets[1];
    const fpsValue = parseInt(fps.value, 10) || 30;

    await voice.startScreenShare({
        deviceId: sourceId,
        systemAudio: includeAudio.value ? "include" : "exclude",
        width: preset.w,
        height: preset.h,
        frameRate: fpsValue,
        maxBitrate: preset.maxBitrate,
    });
}
</script>

<style scoped>
.control-bar {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.controls {
    justify-content: center;
    display: flex;
    gap: 6px;
    flex: auto;
}

.controls button {
    background: none;
    border: none;
    color: hsl(var(--foreground));
    font-size: 16px;
    cursor: pointer;
    transition: color 0.2s;
    padding: 5px;
}

.controls button:hover {
    color: hsl(var(--primary));
}

.controls button.active {
    color: hsl(var(--destructive));
}

.controls button:disabled {
    color: hsl(var(--muted-foreground) / 0.35);
    cursor: not-allowed;
}

/* ── Share dialog ──────────────────────────────────────────────── */

:deep(.share-dialog) {
    display: flex;
    flex-direction: column;
}

.share-header {
    padding: 14px 14px 8px;
}

/* Tab bar */
.share-tabs-bar {
    display: flex;
    gap: 4px;
    padding: 0 14px;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.share-tab-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
}

.share-tab-btn:hover {
    color: hsl(var(--foreground));
}

.share-tab-btn.active {
    color: hsl(var(--foreground));
    border-bottom-color: hsl(var(--primary));
}

/* Sources area — fixed height */
.share-sources-area {
    height: 180px;
    overflow-y: scroll;
    padding: 8px 14px;
}

/* Custom scrollbar for sources area */
.share-sources-area::-webkit-scrollbar {
    width: 6px;
}

.share-sources-area::-webkit-scrollbar-track {
    background: transparent;
}

.share-sources-area::-webkit-scrollbar-thumb {
    background: hsl(var(--foreground) / 0.1);
    border-radius: 3px;
}

.share-sources-area::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--foreground) / 0.2);
}

.share-empty-state {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Sources grid */
.sources-grid {
    display: grid;
    gap: 6px;
}

.sources-grid.cols-2 {
    grid-template-columns: repeat(3, 1fr);
}

.sources-grid.cols-3 {
    grid-template-columns: repeat(4, 1fr);
}

/* Source cards */
.source-card {
    display: flex;
    flex-direction: column;
    border-radius: 5px;
    border: 2px solid transparent;
    background: hsl(var(--muted) / 0.3);
    padding: 2px;
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
    text-align: left;
}

.source-card:hover {
    background: hsl(var(--muted) / 0.55);
}

.source-card.selected {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary) / 0.06);
}

.thumbnail-wrapper {
    border-radius: 3px;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    background: hsl(var(--background));
    display: flex;
    align-items: center;
    justify-content: center;
}

.thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
}

.source-label {
    font-size: 10px;
    margin-top: 3px;
    padding: 0 1px;
    color: hsl(var(--foreground) / 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.source-label-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 3px;
    padding: 0 1px;
    min-width: 0;
}

.source-label-row .source-label {
    margin-top: 0;
    padding: 0;
}

.source-app-icon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
}

/* Settings row */
.share-settings {
    padding: 8px 14px;
    border-top: 1px solid hsl(var(--border) / 0.5);
}

.share-settings-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.setting-group {
    display: flex;
    align-items: center;
    gap: 6px;
}

.setting-label {
    font-size: 12px;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
}

.setting-select {
    height: 30px;
    padding: 0 8px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid hsl(var(--border) / 0.6);
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    outline: none;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    padding-right: 24px;
}

.setting-select:focus {
    border-color: hsl(var(--primary) / 0.5);
}

.audio-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    cursor: pointer;
    color: hsl(var(--foreground) / 0.8);
}

/* Footer */
.share-footer {
    padding: 0 14px 12px;
}
</style>