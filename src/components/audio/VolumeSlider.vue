<template>
    <div
        class="member-volume"
        :class="[`member-volume--${zone}`, { 'is-disabled': disabled, 'is-resetting': resetting }]"
        @dblclick.prevent="reset"
    >
        <!-- One row of the member's menu: icon, track, reading. 100 is the member heard as they
             are; the notch marks it, and anything above it is gain the user added, coloured as
             such. A double-click anywhere on the row, or a click on the reading, puts the member
             back at 100. -->
        <component :is="icon" class="member-volume__icon" aria-hidden="true" />

        <SliderRoot
            class="member-volume__slider"
            :model-value="[level]"
            :min="0"
            :max="200"
            :step="1"
            :disabled="disabled"
            :aria-label="t('member_volume')"
            @update:model-value="onChange"
        >
            <SliderTrack class="member-volume__track">
                <SliderRange class="member-volume__range" />
                <span class="member-volume__notch" aria-hidden="true" />
            </SliderTrack>
            <SliderThumb class="member-volume__thumb" />
        </SliderRoot>

        <button
            type="button"
            class="member-volume__reading"
            :disabled="disabled"
            :title="t('member_volume_reset')"
            data-testid="member-volume-reading"
            @click.stop="reset"
        >
            {{ level }}%
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "reka-ui";
import { Volume1, Volume2, VolumeX } from "lucide-vue-next";
import type { IRealtimeChannelUserWithData } from "@/store/data/poolStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useSystemStore } from "@/store/system/systemStore";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{ user: IRealtimeChannelUserWithData }>();

const voice = useUnifiedCall();
const sys = useSystemStore();
const { t } = useLocale();

const level = computed(() => Math.round(props.user.volume?.[0] ?? 100));
/** Up to 100 the member is as they are; to 170 they are boosted; past that they are loud. */
const zone = computed(() => (level.value > 170 ? "hot" : level.value > 100 ? "boost" : "plain"));
const icon = computed(() => (level.value === 0 ? VolumeX : level.value > 100 ? Volume2 : Volume1));
const disabled = computed(() => sys.headphoneMuted);

function apply(value: number): void {
    const v = Math.max(0, Math.min(200, Math.round(value)));
    voice.setVolume(props.user.userId, v);
    // The call writes the level back into this row once the member has audio; until then the row
    // keeps its own copy, so the handle follows the pointer either way.
    if (props.user.volume?.[0] !== v) props.user.volume = [v];
}

function onChange(value: number[] | undefined): void {
    const v = value?.[0];
    if (v !== undefined) apply(v);
}

// The reading swells for a beat on reset, so the jump back to 100 reads as an answer to the click.
const resetting = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | null = null;

function reset(): void {
    if (disabled.value) return;
    apply(100);
    resetting.value = true;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { resetting.value = false; }, 260);
}

onUnmounted(() => {
    if (resetTimer) clearTimeout(resetTimer);
});
</script>

<style scoped>
.member-volume {
    --vol-accent: hsl(var(--primary));
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0;
    user-select: none;
}

.member-volume--boost { --vol-accent: theme(colors.orange.500); }
.member-volume--hot { --vol-accent: theme(colors.red.500); }
.member-volume.is-disabled { opacity: 0.5; }

.member-volume__icon {
    width: 0.875rem;
    height: 0.875rem;
    flex: none;
    color: var(--vol-accent);
    transition: color 0.15s ease;
}

.member-volume__slider {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    height: 1.25rem;
    touch-action: none;
    cursor: pointer;
}

.member-volume__slider[data-disabled] { cursor: not-allowed; }

.member-volume__track {
    position: relative;
    width: 100%;
    height: 0.375rem;
    border-radius: 9999px;
    background: hsl(var(--secondary));
}

.member-volume__range {
    position: absolute;
    height: 100%;
    border-radius: 9999px;
    background: var(--vol-accent);
    transition: background-color 0.15s ease;
}

/* The notch sits at 100 so the neutral point can be aimed at, not guessed. */
.member-volume__notch {
    position: absolute;
    left: 50%;
    top: -0.1875rem;
    bottom: -0.1875rem;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: hsl(var(--foreground) / 0.35);
    pointer-events: none;
}

.member-volume__thumb {
    display: block;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 9999px;
    background: hsl(var(--background));
    border: 2px solid var(--vol-accent);
    box-shadow: 0 1px 2px hsl(0 0% 0% / 0.4);
    outline: none;
    transition: border-color 0.15s ease, transform 0.12s ease;
}

.member-volume__thumb:hover,
.member-volume__thumb:active { transform: scale(1.15); }

.member-volume__thumb:focus-visible {
    outline: 2px solid var(--vol-accent);
    outline-offset: 2px;
}

.member-volume__reading {
    flex: none;
    min-width: 3.25rem;
    height: 1.5rem;
    padding: 0 0.5rem;
    border-radius: 9999px;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--secondary) / 0.5);
    color: var(--vol-accent);
    font-size: 11px;
    line-height: 1;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-align: center;
    cursor: pointer;
    transition:
        background-color 0.15s ease,
        color 0.15s ease,
        border-color 0.15s ease,
        transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.member-volume__reading:hover:not(:disabled) {
    background: hsl(var(--secondary));
    border-color: var(--vol-accent);
}

.member-volume__reading:focus-visible {
    outline: 2px solid var(--vol-accent);
    outline-offset: 2px;
}

.member-volume__reading:disabled { cursor: not-allowed; }

.member-volume.is-resetting .member-volume__reading { transform: scale(1.08); }

@media (prefers-reduced-motion: reduce) {
    .member-volume__icon,
    .member-volume__range,
    .member-volume__thumb,
    .member-volume__reading { transition: none; }
}
</style>
