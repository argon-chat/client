<template>
    <Dialog v-model:open="open">
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
                    @click="onStart"
                >
                    <ScreenShare class="w-4 h-4 mr-2" />
                    {{ t("start") }}
                </Button>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Monitor, AppWindow, Loader2, ScreenShare } from "lucide-vue-next";
import { Button } from "@argon/ui/button";
import { Switch } from "@argon/ui/switch";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogHeader,
} from "@argon/ui/dialog";
import { useLocale } from "@/store/system/localeStore";
import {
    useScreenShareSources,
    qualityPresets,
    fpsPresets,
} from "@/composables/useScreenShareSources";

const { t } = useLocale();

const {
    openShareSettings: open,
    shareTab,
    includeAudio,
    quality,
    fps,
    sourcesLoading,
    selectedSourceId,
    screenSources,
    windowSources,
    getSelectedPreset,
} = useScreenShareSources();

defineExpose({ open });

const emit = defineEmits<{
    (e: "start", opts: {
        deviceId: string;
        systemAudio: "include" | "exclude";
        width: number;
        height: number;
        frameRate: number;
        maxBitrate: number;
    }): void;
}>();

function onStart() {
    const sourceId = selectedSourceId.value;
    open.value = false;
    if (!sourceId) return;

    const { preset, fpsValue } = getSelectedPreset();

    emit("start", {
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
:deep(.share-dialog) {
    display: flex;
    flex-direction: column;
}

.share-header {
    padding: 14px 14px 8px;
}

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

.share-sources-area {
    height: 180px;
    overflow-y: scroll;
    padding: 8px 14px;
}

.share-sources-area::-webkit-scrollbar { width: 6px; }
.share-sources-area::-webkit-scrollbar-track { background: transparent; }
.share-sources-area::-webkit-scrollbar-thumb { background: hsl(var(--foreground) / 0.1); border-radius: 3px; }
.share-sources-area::-webkit-scrollbar-thumb:hover { background: hsl(var(--foreground) / 0.2); }

.share-empty-state {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.sources-grid { display: grid; gap: 6px; }
.sources-grid.cols-2 { grid-template-columns: repeat(3, 1fr); }
.sources-grid.cols-3 { grid-template-columns: repeat(4, 1fr); }

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
.source-card:hover { background: hsl(var(--muted) / 0.55); }
.source-card.selected { border-color: hsl(var(--primary)); background: hsl(var(--primary) / 0.06); }

.thumbnail-wrapper {
    border-radius: 3px;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    background: hsl(var(--background));
    display: flex;
    align-items: center;
    justify-content: center;
}
.thumbnail { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }

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
.source-label-row .source-label { margin-top: 0; padding: 0; }
.source-app-icon { width: 12px; height: 12px; flex-shrink: 0; }

.share-settings {
    padding: 8px 14px;
    border-top: 1px solid hsl(var(--border) / 0.5);
}

.share-settings-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.setting-group { display: flex; align-items: center; gap: 6px; }
.setting-label { font-size: 12px; color: hsl(var(--muted-foreground)); white-space: nowrap; }

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
.setting-select:focus { border-color: hsl(var(--primary) / 0.5); }

.audio-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    cursor: pointer;
    color: hsl(var(--foreground) / 0.8);
}

.share-footer {
    padding: 0 14px 12px;
}
</style>
