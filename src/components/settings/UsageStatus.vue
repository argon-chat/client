<template>
    <div class="usage-status-card">
        <div class="flex items-center justify-between mb-5">
            <div class="flex items-center gap-2">
                <ChartPieIcon class="w-5 h-5 text-primary" />
                <h3 class="text-lg font-semibold">{{ t("storage.space") }}</h3>
            </div>
            <div v-if="quota > 0" class="text-sm font-medium text-muted-foreground">
                {{ t("storage.total") }}: <span class="text-foreground">{{ fmt(quota) }}</span>
            </div>
        </div>

        <!-- Summary Stats -->
        <div class="stats-grid">
            <div class="stat-item">
                <DatabaseIcon class="w-4 h-4 text-primary/60" />
                <div class="flex-1">
                    <div class="text-xs text-muted-foreground">Used Space</div>
                    <div class="text-base font-semibold">{{ fmt(usedTotal) }}</div>
                </div>
            </div>
            <div v-if="quota > 0" class="stat-item">
                <CheckCircle2Icon class="w-4 h-4 text-green-500/60" />
                <div class="flex-1">
                    <div class="text-xs text-muted-foreground">Available</div>
                    <div class="text-base font-semibold">{{ fmt(freeBytes) }}</div>
                </div>
            </div>
            <div class="stat-item">
                <PercentIcon class="w-4 h-4 text-blue-500/60" />
                <div class="flex-1">
                    <div class="text-xs text-muted-foreground">Usage</div>
                    <div class="text-base font-semibold">
                        {{ quota > 0 ? floorToFixed((usedTotal / quota) * 100, 1) : '100.0' }}%
                    </div>
                </div>
            </div>
        </div>

        <!-- Progress Bar -->
        <div class="progress-container">
            <div class="progress-bar" role="progressbar" 
                :aria-valuemin="0"
                :aria-valuemax="quota > 0 ? quota : usedTotal" 
                :aria-valuenow="usedTotal"
                aria-label="Used storage">
                <template v-for="(s, i) in barSegments" :key="'seg-'+i">
                    <div 
                        class="progress-segment group" 
                        :class="{
                            'rounded-l-full': i === 0,
                            'rounded-r-full': i === barSegments.length - 1,
                        }" 
                        :style="{
                            width: s.percent + '%',
                            minWidth: s.bytes > 0 && s.percent < 1 ? '2px' : undefined,
                            background: s.name !== 'free' 
                                ? `linear-gradient(180deg, ${lighten(colorFor(s.name), 20)} 0%, ${colorFor(s.name)} 50%, ${darken(colorFor(s.name), 10)} 100%)`
                                : colorFor(s.name),
                            boxShadow: s.name !== 'free' 
                                ? `0 0 15px ${colorFor(s.name)}60, inset 0 1px 0 rgba(255,255,255,0.2)` 
                                : 'none',
                            animation: 'progressFill 0.6s ease-out'
                        }" 
                        :title="segmentTitle(s)" 
                    >
                        <div v-if="s.name !== 'free'" class="progress-shine"></div>
                    </div>
                </template>
            </div>
            
            <!-- Progress Labels -->
            <div class="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>0%</span>
                <span v-if="quota > 0" class="font-medium">
                    {{ floorToFixed((usedTotal / quota) * 100, 1) }}% used
                </span>
                <span v-if="quota > 0">100%</span>
            </div>
        </div>

        <!-- Legend -->
        <div class="legend-container">
            <div v-for="it in legendItems" :key="`lg-${it.name}`" class="legend-item">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <span 
                        class="legend-dot" 
                        :style="{ 
                            backgroundColor: colorFor(it.name),
                            boxShadow: it.name !== 'free' ? `0 0 8px ${colorFor(it.name)}60` : 'none'
                        }"
                    />
                    <span class="text-sm text-muted-foreground truncate">{{ label(it.name) }}</span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-sm font-medium tabular-nums">{{ fmt(it.bytes) }}</span>
                    <span class="legend-percent">
                        {{ (it.bytes > 0 && it.percent < 0.1 ? `≤0.1` : floorToFixed(it.percent, 1)) }}%
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { computed } from 'vue';
import { ChartPieIcon, DatabaseIcon, CheckCircle2Icon, PercentIcon } from 'lucide-vue-next';

const { t } = useLocale();

export type Group = { name: string; usedBytes: number }

const props = defineProps<{
    groups: Group[]
    quotaBytes?: number | null
    storageUsedBytes?: number | null
}>()

const quota = computed(() => Number(props.quotaBytes ?? 0) || 0)

const SYSTEM = new Set(['indexedDB', 'fileSystem', 'serviceWorkerRegistrations']);
const MEDIA = new Set(['images', 'stickers', 'gifs', 'videos']);
const MEDIA_KEY = "media";
const SYSTEM_KEY = 'systemCache'

const mergedGroups = computed(() => {
    let systemSum = 0;
    let mediaSum = 0;
    const out: Group[] = []
    for (const g of props.groups ?? []) {
        const n = toNum(g.usedBytes)
        if (SYSTEM.has(g.name)) systemSum += n;
        else if(MEDIA.has(g.name)) mediaSum += n;
        else out.push({ name: g.name, usedBytes: n })
    }
    if (systemSum > 0) out.push({ name: SYSTEM_KEY, usedBytes: systemSum })
    if (mediaSum > 0) out.push({ name: MEDIA_KEY, usedBytes: mediaSum })

    const map = new Map<string, number>()
    for (const g of out) map.set(g.name, (map.get(g.name) ?? 0) + toNum(g.usedBytes))
    return Array.from(map, ([name, usedBytes]) => ({ name, usedBytes }))
})

const ORDER = [MEDIA_KEY, 'voices', 'files', SYSTEM_KEY]
const ordered = computed(() => {
    const dict = new Map(mergedGroups.value.map(g => [g.name, g.usedBytes]))
    const res: Group[] = []
    for (const k of ORDER) if (dict.has(k)) res.push({ name: k, usedBytes: dict.get(k)! })
    for (const [k, v] of dict) if (!ORDER.includes(k)) res.push({ name: k, usedBytes: v })
    return res
})

const groupsSum = computed(() => ordered.value.reduce((s, g) => s + g.usedBytes, 0))
const usedTotal = computed(() => toNum(props.storageUsedBytes ?? groupsSum.value))
const freeBytes = computed(() => Math.max(0, quota.value > 0 ? quota.value - usedTotal.value : 0))

const OTHER_KEY = 'other'
const withOther = computed(() => {
    const arr = ordered.value.slice()
    const diff = Math.max(0, usedTotal.value - groupsSum.value)
    if (diff > 0) arr.push({ name: OTHER_KEY, usedBytes: diff })
    return arr
})

const barSegments = computed(() => {
    const base = quota.value > 0 ? quota.value : usedTotal.value || 1
    const segs = withOther.value.map(g => ({ name: g.name, bytes: g.usedBytes, percent: (g.usedBytes / base) * 100 }))
    if (quota.value > 0 && freeBytes.value > 0) segs.push({ name: 'free', bytes: freeBytes.value, percent: (freeBytes.value / base) * 100 })
    return segs.filter(s => s.bytes > 0)
})

const legendItems = computed(() => {
    const items = withOther.value
        .filter(g => g.usedBytes > 0)
        .map(g => ({ name: g.name, bytes: g.usedBytes, percent: pctOf(quota.value > 0 ? quota.value : usedTotal.value, g.usedBytes) }))
    if (freeBytes.value > 0) items.push({ name: 'free', bytes: freeBytes.value, percent: pctOf(quota.value, freeBytes.value) })
    return items
});

const floorToFixed = (num: number, decimals: number) => {
  const factor = 10 ** decimals;
  return (Math.floor(num * factor) / factor).toFixed(decimals);
}

const PALETTE: Record<string, string> = {
    images: '#a4fa60', 
    stickers: '#f59e0b', 
    voices: '#22c55e', 
    gifs: '#ef4444', 
    videos: '#8b5cf6', 
    files: '#ef7c3a',
    [SYSTEM_KEY]: '#06b6d4', 
    [OTHER_KEY]: '#465779', 
    free: '#353535', 
}
const FALLBACK = ['#93c5fd', '#fde68a', '#bbf7d0', '#fecaca', '#ddd6fe', '#fca5a5', '#5eead4', '#a3a3a3']

function colorFor(name: string): string {
    if (PALETTE[name]) return PALETTE[name]
    const i = Math.abs(hash(name)) % FALLBACK.length
    return FALLBACK[i]
}

function label(k: string): string {
    return t(`storage.${k}`);
}

function segmentTitle(s: { name: string; bytes: number; percent: number }): string {
    const nm = label(s.name)
    return `${nm}: ${fmt(s.bytes)} (${s.percent.toFixed(1)}%)`
}

function toNum(v: unknown) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }
function pctOf(base: number, part: number) { const b = base || 1; return (part / b) * 100 }
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i); return h | 0 }
function fmt(n: number): string {
    const units = ['b', 'Kb', 'Mb', 'Gb', 'Tb']
    let i = 0, v = n
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    const digits = v < 10 && i > 0 ? 2 : v < 100 && i > 0 ? 1 : 0
    return `${v.toFixed(digits)} ${units[i]}`
}

function lighten(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(0x1000000 + (R * 0x10000) + (G * 0x100) + B).toString(16).slice(1)}`;
}

function darken(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return `#${(0x1000000 + (R * 0x10000) + (G * 0x100) + B).toString(16).slice(1)}`;
}
</script>

<style scoped>
.usage-status-card {
    @apply w-full;
}

.stats-grid {
    @apply grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5;
}

.stat-item {
    @apply flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50 transition-all hover:bg-muted/50;
}

.progress-container {
    @apply mb-5;
}

.progress-bar {
    @apply w-full h-4 bg-muted rounded-full overflow-hidden flex relative;
    box-shadow: inset 0 2px 6px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.1);
    border: 1px solid rgba(255,255,255,0.05);
}

.progress-segment {
    @apply h-full transition-all duration-300 relative overflow-hidden;
    animation: progressFill 0.6s ease-out;
}

.progress-segment:hover {
    filter: brightness(1.3);
    transform: scaleY(1.05);
}

.progress-shine {
    @apply absolute inset-0 opacity-40;
    background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(255, 255, 255, 0.3) 50%,
        transparent 100%
    );
    animation: shine 2s ease-in-out infinite;
}

@keyframes progressFill {
    from {
        transform: scaleX(0);
        transform-origin: left;
    }
    to {
        transform: scaleX(1);
        transform-origin: left;
    }
}

@keyframes shine {
    0% {
        transform: translateX(-100%);
    }
    100% {
        transform: translateX(100%);
    }
}

.legend-container {
    @apply space-y-2;
}

.legend-item {
    @apply flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors;
}

.legend-dot {
    @apply inline-block h-3 w-3 rounded-full shrink-0 transition-transform duration-200;
}

.legend-item:hover .legend-dot {
    @apply scale-125;
}

.legend-percent {
    @apply text-sm text-muted-foreground font-mono min-w-[3rem] text-right;
}

:root {
    color-scheme: light dark;
}
</style>
