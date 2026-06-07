<template>
    <Dialog v-model:open="open">
        <DialogContent
            class="share-dialog"
            :style="{ maxWidth: '600px', width: '600px', padding: '0', gap: '0', overflow: 'hidden', borderRadius: 'var(--radius)' }"
        >
            <!-- Header -->
            <div class="sp-header">
                <DialogHeader>
                    <DialogTitle class="sp-title">{{ t("screencast") }}</DialogTitle>
                    <DialogDescription class="sp-desc">{{ t("screencast_title") }}</DialogDescription>
                </DialogHeader>
            </div>

            <!-- Source type tabs -->
            <div class="sp-tabs">
                <button class="sp-tab" :class="{ active: shareTab === 'screens' }" @click="shareTab = 'screens'">
                    <Monitor class="w-4 h-4 shrink-0" />
                    <span>{{ t("monitors") }}</span>
                </button>
                <button class="sp-tab" :class="{ active: shareTab === 'windows' }" @click="shareTab = 'windows'">
                    <AppWindow class="w-4 h-4 shrink-0" />
                    <span>{{ t("windows") }}</span>
                </button>
            </div>

            <!-- Sources -->
            <div class="sp-sources">
                <div v-if="sourcesLoading" class="sp-state">
                    <Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
                </div>

                <div
                    v-else-if="currentSources.length > 0"
                    class="sp-grid"
                    :class="shareTab === 'screens' ? 'is-screens' : 'is-windows'"
                >
                    <button
                        v-for="source in currentSources"
                        :key="source.id"
                        type="button"
                        class="sp-card"
                        :class="{ selected: selectedSourceId === source.id }"
                        @click="selectedSourceId = source.id"
                        @dblclick="onStart"
                    >
                        <div class="sp-thumb" :class="{ contain: shareTab === 'windows' }">
                            <img :src="source.thumbnailDataUrl" :alt="source.name" draggable="false" />
                            <span v-if="selectedSourceId === source.id" class="sp-check">
                                <Check class="w-3.5 h-3.5" />
                            </span>
                        </div>
                        <div class="sp-card-label">
                            <img v-if="source.appIconDataUrl" :src="source.appIconDataUrl" class="sp-app-icon" draggable="false" />
                            <Monitor v-else-if="shareTab === 'screens'" class="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            <AppWindow v-else class="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            <span class="sp-label-text">{{ source.name }}</span>
                        </div>
                    </button>
                </div>

                <div v-else class="sp-state">
                    <component :is="shareTab === 'screens' ? Monitor : AppWindow" class="w-7 h-7 text-muted-foreground/40 mb-2" />
                    <span class="sp-state-text">
                        {{ shareTab === 'screens' ? t("no_screens_found") : t("no_windows_found") }}
                    </span>
                </div>
            </div>

            <!-- Options -->
            <div class="sp-options">
                <div class="sp-opt">
                    <span class="sp-opt-label">{{ t("quality") }}</span>
                    <div class="sp-seg">
                        <button
                            v-for="q in visibleQuality"
                            :key="q.label"
                            type="button"
                            class="sp-seg-btn"
                            :class="{ active: quality === q.label, locked: q.premium && !hasPremium }"
                            @click="quality = q.label"
                        >
                            <Crown v-if="q.premium && !hasPremium" class="sp-seg-crown" />
                            {{ q.label }}
                        </button>
                    </div>
                </div>

                <div class="sp-opt">
                    <span class="sp-opt-label">{{ t("fps") }}</span>
                    <div class="sp-seg">
                        <button
                            v-for="f in visibleFps"
                            :key="f.label"
                            type="button"
                            class="sp-seg-btn"
                            :class="{ active: fps === f.value, locked: f.premium && !hasPremium }"
                            @click="fps = f.value"
                        >
                            <Crown v-if="f.premium && !hasPremium" class="sp-seg-crown" />
                            {{ f.value }}
                        </button>
                    </div>
                </div>

                <div class="sp-audio" :class="{ active: includeAudio }" role="button" tabindex="0" @click="includeAudio = !includeAudio">
                    <div class="sp-audio-info">
                        <Volume2 class="w-4 h-4 shrink-0" />
                        <span class="sp-audio-title">{{ t("enable_system_sound") }}</span>
                    </div>
                    <Switch :checked="includeAudio" class="sp-audio-switch" />
                </div>
            </div>

            <!-- Footer -->
            <div class="sp-footer">
                <Button variant="ghost" class="h-9" @click="open = false">{{ t("cancel") }}</Button>
                <button
                    v-if="needsPremium"
                    type="button"
                    class="sp-premium-btn"
                    @click="openPremium"
                >
                    <Crown class="w-4 h-4 mr-2" />
                    {{ t("required_premium") }}
                </button>
                <Button
                    v-else
                    variant="default"
                    class="h-9 flex-1"
                    :disabled="!selectedSourceId"
                    @click="onStart"
                >
                    <ScreenShare class="w-4 h-4 mr-2" />
                    {{ t("start") }}
                </Button>
            </div>
        </DialogContent>
    </Dialog>

    <BuyPremium v-model:open="showPremium" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Monitor, AppWindow, Loader2, ScreenShare, Check, Volume2, Crown } from "lucide-vue-next";
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
import { useMe } from "@/store/auth/meStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import BuyPremium from "./modals/BuyPremium.vue";
import {
    useScreenShareSources,
    qualityPresets,
    fpsPresets,
} from "@/composables/useScreenShareSources";

const { t } = useLocale();
const me = useMe();
const flags = useFeatureFlags();

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

const currentSources = computed(() =>
    shareTab.value === "screens" ? screenSources.value : windowSources.value,
);

// --- Premium gating ---
// `premiumEnabled` = whether premium (Ultima) exists in this build at all.
//   • off  → premium-only presets (1440p/4K/60fps) are hidden entirely.
//   • on   → they're shown; a non-subscriber can pick them but the Start button
//            turns into a "Required Premium" upsell that opens the purchase flow.
const hasPremium = computed(() => me.isPremium);
const premiumEnabled = computed(() => flags.ultimaActive);

const visibleQuality = computed(() =>
    qualityPresets.filter((q) => premiumEnabled.value || !q.premium),
);
const visibleFps = computed(() =>
    fpsPresets.filter((f) => premiumEnabled.value || !f.premium),
);

const selectedQuality = computed(() => qualityPresets.find((q) => q.label === quality.value));
const selectedFps = computed(() => fpsPresets.find((f) => f.value === fps.value));

const needsPremium = computed(() =>
    premiumEnabled.value && !hasPremium.value &&
    (!!selectedQuality.value?.premium || !!selectedFps.value?.premium),
);

const showPremium = ref(false);
function openPremium() {
    showPremium.value = true;
}

// Never keep a premium-only selection when premium isn't available in this build.
watch(premiumEnabled, (enabled) => {
    if (enabled) return;
    if (selectedQuality.value?.premium) quality.value = "1080p";
    if (selectedFps.value?.premium) fps.value = "30";
}, { immediate: true });

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
    if (!sourceId) return;
    open.value = false;

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
/* The dialog is a fixed-width column; nothing inside may widen it. */
:deep(.share-dialog) {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    max-width: 100%;
}

:deep(.share-dialog) * {
    min-width: 0;
}

/* Header */
.sp-header {
    padding: 16px 16px 12px;
}

.sp-title {
    font-size: 15px;
    font-weight: 600;
}

.sp-desc {
    font-size: 12px;
    color: hsl(var(--muted-foreground));
    margin-top: 2px;
}

/* Tabs */
.sp-tabs {
    display: flex;
    gap: 6px;
    padding: 0 16px 12px;
}

.sp-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
    background: hsl(var(--muted) / 0.4);
    border: 1px solid transparent;
    border-radius: calc(var(--radius) - 4px);
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s, border-color 0.15s;
}

.sp-tab:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--muted) / 0.6);
}

.sp-tab.active {
    color: hsl(var(--foreground));
    background: hsl(var(--primary) / 0.12);
    border-color: hsl(var(--primary) / 0.35);
}

/* Sources area — scrolls vertically only, never horizontally */
.sp-sources {
    height: 300px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 16px 14px;
}

.sp-sources::-webkit-scrollbar { width: 7px; }
.sp-sources::-webkit-scrollbar-track { background: transparent; }
.sp-sources::-webkit-scrollbar-thumb { background: hsl(var(--foreground) / 0.12); border-radius: 4px; }
.sp-sources::-webkit-scrollbar-thumb:hover { background: hsl(var(--foreground) / 0.22); }

.sp-state {
    height: 100%;
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.sp-state-text {
    font-size: 12px;
    color: hsl(var(--muted-foreground));
}

/* minmax(0, 1fr) lets columns shrink below their content so long window
   names can't blow the grid out and create a horizontal scrollbar. */
.sp-grid {
    display: grid;
    gap: 10px;
    width: 100%;
}

.sp-grid.is-screens { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.sp-grid.is-windows { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.sp-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 6px;
    border-radius: calc(var(--radius) - 2px);
    border: 2px solid transparent;
    background: hsl(var(--muted) / 0.3);
    cursor: pointer;
    transition: border-color 0.15s, background-color 0.15s;
    text-align: left;
}

.sp-card:hover { background: hsl(var(--muted) / 0.6); }

.sp-card.selected {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary) / 0.08);
}

.sp-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: calc(var(--radius) - 6px);
    overflow: hidden;
    background: hsl(var(--background));
}

.sp-thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    user-select: none;
}

/* Windows have arbitrary aspect ratios → show the whole window, letterboxed. */
.sp-thumb.contain img {
    object-fit: contain;
}

.sp-check {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.sp-card-label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0 2px;
}

.sp-app-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    border-radius: 3px;
}

.sp-label-text {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: hsl(var(--foreground) / 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Options */
.sp-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px;
    border-top: 1px solid hsl(var(--border) / 0.5);
}

.sp-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.sp-opt-label {
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
}

.sp-seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: hsl(var(--muted) / 0.4);
    border-radius: calc(var(--radius) - 4px);
}

.sp-seg-btn {
    min-width: 42px;
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
    background: transparent;
    border: none;
    border-radius: calc(var(--radius) - 6px);
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
}

.sp-seg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
}

.sp-seg-btn:hover { color: hsl(var(--foreground)); }

.sp-seg-btn.active {
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

/* Premium-only presets a free user can pick (gets gated at Start) */
.sp-seg-btn.locked { color: #e0b343; }
.sp-seg-btn.locked.active { color: #ffd60a; }
.sp-seg-crown { width: 11px; height: 11px; flex-shrink: 0; }

.sp-audio {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px;
    border-radius: calc(var(--radius) - 4px);
    background: hsl(var(--muted) / 0.3);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s;
}

.sp-audio:hover { background: hsl(var(--muted) / 0.5); }

.sp-audio.active {
    background: hsl(var(--primary) / 0.08);
    border-color: hsl(var(--primary) / 0.4);
}

.sp-audio-info {
    display: flex;
    align-items: center;
    gap: 8px;
    color: hsl(var(--foreground) / 0.9);
}

.sp-audio-title {
    font-size: 12px;
    font-weight: 500;
}

.sp-audio-switch {
    pointer-events: none;
    flex-shrink: 0;
}

/* Footer */
.sp-footer {
    display: flex;
    gap: 8px;
    padding: 12px 16px 16px;
    border-top: 1px solid hsl(var(--border) / 0.5);
}

/* "Required Premium" upsell — animated RGB */
.sp-premium-btn {
    position: relative;
    flex: 1;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: calc(var(--radius) - 4px);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    background: linear-gradient(90deg, #ff2d55, #ff9500, #ffd60a, #34c759, #00c7ff, #5e5ce6, #bf5af2, #ff2d55);
    background-size: 300% 100%;
    animation: sp-rgb 5s linear infinite;
    transition: transform 0.12s ease, filter 0.12s ease;
}

.sp-premium-btn::before {
    content: "";
    position: absolute;
    inset: -2px;
    z-index: -1;
    border-radius: inherit;
    background: inherit;
    background-size: 300% 100%;
    animation: sp-rgb 5s linear infinite;
    filter: blur(9px);
    opacity: 0.55;
}

.sp-premium-btn:hover {
    transform: translateY(-1px);
    filter: brightness(1.08);
}

.sp-premium-btn:active {
    transform: translateY(0);
}

@keyframes sp-rgb {
    to { background-position: 300% 50%; }
}

@media (prefers-reduced-motion: reduce) {
    .sp-premium-btn,
    .sp-premium-btn::before {
        animation: none;
    }
}
</style>
