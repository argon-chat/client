<template>
    <div class="w-full rounded-2xl shadow p-5">
        <div class="flex items-baseline justify-between mb-4">
            <h2 class="text-xl font-semibold">{{ t("storage.space") }}</h2>
            <div v-if="quota > 0" class="text-sm text-gray-200">{{ t("storage.total") }}: {{ fmt(quota) }}</div>
        </div>

        <div class="w-full h-4 bg-gray-800 rounded-full overflow-hidden" role="progressbar" :aria-valuemin="0"
            :aria-valuemax="quota > 0 ? quota : usedTotal" :aria-valuenow="usedTotal"
            aria-label="Used storage">
            <div class="flex h-full w-full">
                <template v-for="(s, i) in barSegments" :key="'seg-'+i">
                    <div class="h-full" :class="{
                        'rounded-l-full': i === 0,
                        'rounded-r-full': i === barSegments.length - 1,
                    }" :style="{
                width: s.percent + '%',
                minWidth: s.bytes > 0 && s.percent < 1 ? '2px' : undefined,
                backgroundColor: colorFor(s.name)
            }" :title="segmentTitle(s)" />
                </template>
            </div>
        </div>

        <ul class="mt-4 divide-y divide-gray-800">
            <li v-for="it in legendItems" :key="`lg-${it.name}`" class="py-2">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-start gap-2 min-w-0">
                        <span class="mt-1 inline-block h-3 w-3 rounded-full shrink-0"
                            :style="{ backgroundColor: colorFor(it.name) }"></span>
                        <span class="text-sm text-gray-400 break-words whitespace-normal">{{ label(it.name) }}</span>
                    </div>
                    <div class="text-sm text-gray-300 tabular-nums text-right whitespace-nowrap">
                        <span class="mr-2">{{ fmt(it.bytes) }}</span>
                        <span class="text-gray-400">{{ (it.bytes > 0 && it.percent < 0.1 ? `≤0.1` : floorToFixed(it.percent, 1) ) }}%</span>
                    </div>
                </div>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { computed } from 'vue'

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
</script>

<style scoped>
:root {
    color-scheme: light dark;
}
</style>
