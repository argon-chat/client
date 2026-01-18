<template>
    <div v-if="diagnostics" class="p-3 border-b border-border space-y-2 overflow-y-auto flex-1 min-h-0">
        <div class="flex justify-between items-center">
            <h4 class="text-xs font-medium text-muted-foreground">Performance</h4>
            <span class="text-xs font-mono" :class="diagnostics.fps >= 55 ? 'text-green-400' : diagnostics.fps >= 30 ? 'text-yellow-400' : 'text-red-400'">
                {{ diagnostics.fps }} FPS
            </span>
        </div>
        
        <!-- Frame Time Graph -->
        <div class="h-10 bg-zinc-900 rounded relative overflow-hidden">
            <svg class="w-full h-full" viewBox="0 0 100 40" preserveAspectRatio="none">
                <polyline
                    :points="frameTimeGraphPoints"
                    fill="none"
                    stroke="rgb(74, 222, 128)"
                    stroke-width="1"
                    stroke-linejoin="round"
                    vector-effect="non-scaling-stroke"
                />
            </svg>
            <div class="absolute top-0.5 left-1 text-[9px] text-muted-foreground">
                Frame: {{ diagnostics.frameTime.toFixed(2) }}ms
            </div>
        </div>
        
        <!-- CPU/GPU Time Graphs -->
        <div class="grid grid-cols-2 gap-1">
            <!-- CPU Time Graph -->
            <div class="h-8 bg-zinc-900 rounded relative overflow-hidden">
                <svg class="w-full h-full" viewBox="0 0 100 32" preserveAspectRatio="none">
                    <polyline
                        :points="cpuTimeGraphPoints"
                        fill="none"
                        stroke="rgb(96, 165, 250)"
                        stroke-width="1"
                        stroke-linejoin="round"
                        vector-effect="non-scaling-stroke"
                    />
                </svg>
                <div class="absolute top-0.5 left-1 text-[8px] text-blue-400">
                    CPU: {{ diagnostics.cpuTime.toFixed(2) }}ms
                </div>
            </div>
            
            <!-- GPU Time Graph -->
            <div class="h-8 bg-zinc-900 rounded relative overflow-hidden">
                <svg class="w-full h-full" viewBox="0 0 100 32" preserveAspectRatio="none">
                    <polyline
                        :points="gpuTimeGraphPoints"
                        fill="none"
                        stroke="rgb(251, 146, 60)"
                        stroke-width="1"
                        stroke-linejoin="round"
                        vector-effect="non-scaling-stroke"
                    />
                </svg>
                <div class="absolute top-0.5 left-1 text-[8px] text-orange-400">
                    GPU: {{ diagnostics.gpuTime ? diagnostics.gpuTime.toFixed(3) + 'ms' : 'N/A' }}
                </div>
            </div>
        </div>
        
        <!-- Stats grid -->
        <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
            <div class="flex justify-between">
                <span class="text-muted-foreground">Draw calls:</span>
                <span class="text-foreground font-mono">{{ diagnostics.drawCalls }}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-muted-foreground">Vertices:</span>
                <span class="text-foreground font-mono">{{ diagnostics.vertexCount }}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-muted-foreground">Triangles:</span>
                <span class="text-foreground font-mono">{{ diagnostics.triangleCount }}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-muted-foreground">Sprites:</span>
                <span class="text-foreground font-mono">{{ diagnostics.spriteCount }}</span>
            </div>
        </div>
        
        <!-- VRAM -->
        <div class="pt-1 border-t border-zinc-700">
            <div class="flex justify-between items-center text-[9px]">
                <span class="text-muted-foreground">VRAM Usage:</span>
                <span class="text-foreground font-mono">{{ formatBytes(diagnostics.vramUsage.total) }}</span>
            </div>
            <div class="flex gap-2 text-[9px] text-muted-foreground mt-0.5">
                <span>Buffers: {{ formatBytes(diagnostics.vramUsage.buffers) }}</span>
                <span>Textures: {{ formatBytes(diagnostics.vramUsage.textures) }}</span>
            </div>
        </div>
        
        <!-- Resources -->
        <div class="pt-1 border-t border-zinc-700">
            <div class="grid grid-cols-3 gap-x-2 gap-y-0.5 text-[9px]">
                <div class="flex justify-between">
                    <span class="text-muted-foreground">Widgets:</span>
                    <span class="text-foreground font-mono">{{ diagnostics.visibleWidgetCount }}/{{ diagnostics.widgetCount }}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-muted-foreground">Textures:</span>
                    <span class="text-foreground font-mono">{{ diagnostics.textureCount }}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-muted-foreground">Pipelines:</span>
                    <span class="text-foreground font-mono">{{ diagnostics.pipelineCount }}</span>
                </div>
            </div>
        </div>
        
        <!-- GPU Info (collapsed) -->
        <details class="text-[9px]">
            <summary class="text-muted-foreground cursor-pointer hover:text-foreground">GPU Info</summary>
            <div v-if="diagnostics.gpuInfo" class="mt-1 p-1 bg-zinc-900 rounded space-y-0.5">
                <p><span class="text-muted-foreground">Vendor:</span> {{ diagnostics.gpuInfo.vendor }}</p>
                <p><span class="text-muted-foreground">Device:</span> {{ diagnostics.gpuInfo.device }}</p>
                <p><span class="text-muted-foreground">Arch:</span> {{ diagnostics.gpuInfo.architecture }}</p>
                <p class="truncate"><span class="text-muted-foreground">Desc:</span> {{ diagnostics.gpuInfo.description }}</p>
                <details class="mt-1">
                    <summary class="text-muted-foreground cursor-pointer">Features ({{ diagnostics.gpuInfo.features.length }})</summary>
                    <div class="max-h-16 overflow-y-auto mt-0.5">
                        <p v-for="f in diagnostics.gpuInfo.features" :key="f" class="text-[8px]">{{ f }}</p>
                    </div>
                </details>
            </div>
        </details>
        
        <!-- Dirty Capture Stats (collapsed) -->
        <details v-if="diagnostics.dirtyCapture.captureCount > 0" class="text-[9px]">
            <summary class="text-muted-foreground cursor-pointer hover:text-foreground">
                Dirty Capture 
                <span class="text-amber-400">({{ diagnostics.dirtyCapture.avgCaptureTime.toFixed(2) }}ms avg)</span>
            </summary>
            <div class="mt-1 p-1 bg-zinc-900 rounded space-y-1">
                <div class="flex justify-between">
                    <span class="text-muted-foreground">Grid:</span>
                    <span class="font-mono">{{ diagnostics.dirtyCapture.tilesX }}×{{ diagnostics.dirtyCapture.tilesY }} ({{ diagnostics.dirtyCapture.totalTiles }} @ {{ diagnostics.dirtyCapture.tileSize }}px)</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-muted-foreground">Frame buffer:</span>
                    <span class="font-mono text-yellow-400">{{ formatBytes(diagnostics.dirtyCapture.previousFrameMemory) }}</span>
                </div>
                
                <div class="pt-1 border-t border-zinc-800">
                    <p class="text-muted-foreground mb-0.5">Last capture:</p>
                    <div class="grid grid-cols-2 gap-x-2">
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Total:</span>
                            <span class="font-mono">{{ diagnostics.dirtyCapture.lastCaptureTime.toFixed(2) }}ms</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Compare:</span>
                            <span class="font-mono">{{ diagnostics.dirtyCapture.lastCompareTime.toFixed(2) }}ms</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Extract:</span>
                            <span class="font-mono">{{ diagnostics.dirtyCapture.lastExtractTime.toFixed(2) }}ms</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Dirty:</span>
                            <span class="font-mono" :class="diagnostics.dirtyCapture.lastDirtyPercent < 20 ? 'text-green-400' : 'text-yellow-400'">{{ diagnostics.dirtyCapture.lastDirtyPercent.toFixed(1) }}%</span>
                        </div>
                    </div>
                </div>
                
                <div class="pt-1 border-t border-zinc-800">
                    <p class="text-muted-foreground mb-0.5">Averages ({{ diagnostics.dirtyCapture.captureCount }}):</p>
                    <div class="grid grid-cols-2 gap-x-2">
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Time:</span>
                            <span class="font-mono text-green-400">{{ diagnostics.dirtyCapture.avgCaptureTime.toFixed(2) }}ms</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Dirty:</span>
                            <span class="font-mono">{{ diagnostics.dirtyCapture.avgDirtyPercent.toFixed(1) }}%</span>
                        </div>
                        <div class="flex justify-between col-span-2">
                            <span class="text-muted-foreground">Data/capture:</span>
                            <span class="font-mono text-green-400">{{ formatBytes(diagnostics.dirtyCapture.avgBytesPerCapture) }}</span>
                        </div>
                    </div>
                </div>
                
                <div v-if="diagnostics.dirtyCapture.totalTransparentSkipped > 0" class="pt-1 border-t border-zinc-800">
                    <p class="text-muted-foreground mb-0.5">Transparency skip:</p>
                    <div class="grid grid-cols-2 gap-x-2">
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Last:</span>
                            <span class="font-mono text-cyan-400">{{ diagnostics.dirtyCapture.lastTransparentSkipped }} tiles</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Saved:</span>
                            <span class="font-mono text-cyan-400">{{ formatBytes(diagnostics.dirtyCapture.lastTransparentSaved) }}</span>
                        </div>
                        <div class="flex justify-between col-span-2">
                            <span class="text-muted-foreground">Total saved:</span>
                            <span class="font-mono text-cyan-400">{{ formatBytes(diagnostics.dirtyCapture.totalTransparentSaved) }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </details>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { OverlayDiagnostics } from '@/lib/overlay'

const props = defineProps<{
    diagnostics: OverlayDiagnostics | null
}>()

// Fixed scale constants for stable graphs
const FRAME_TIME_MAX = 33.33  // ~30fps baseline (fixed scale)
const CPU_TIME_MAX = 5        // 5ms fixed scale for CPU
const GPU_TIME_MAX = 2        // 2ms fixed scale for GPU

const frameTimeGraphPoints = computed(() => {
    if (!props.diagnostics?.frameTimeHistory.length) return ''
    
    const history = props.diagnostics.frameTimeHistory
    const width = 100
    const height = 40
    const padding = 4
    const usableHeight = height - padding * 2
    
    return history.map((time, i) => {
        const x = (i / (history.length - 1 || 1)) * width
        const normalized = Math.min(time / FRAME_TIME_MAX, 1)
        const y = padding + usableHeight - normalized * usableHeight
        return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
})

const cpuTimeGraphPoints = computed(() => {
    if (!props.diagnostics?.cpuTimeHistory?.length) return ''
    
    const history = props.diagnostics.cpuTimeHistory
    const width = 100
    const height = 32
    const padding = 3
    const usableHeight = height - padding * 2
    
    return history.map((time, i) => {
        const x = (i / (history.length - 1 || 1)) * width
        const normalized = Math.min(time / CPU_TIME_MAX, 1)
        const y = padding + usableHeight - normalized * usableHeight
        return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
})

const gpuTimeGraphPoints = computed(() => {
    if (!props.diagnostics?.gpuTimeHistory?.length) return ''
    
    const history = props.diagnostics.gpuTimeHistory
    const width = 100
    const height = 32
    const padding = 3
    const usableHeight = height - padding * 2
    
    return history.map((time, i) => {
        const x = (i / (history.length - 1 || 1)) * width
        const normalized = Math.min(time / GPU_TIME_MAX, 1)
        const y = padding + usableHeight - normalized * usableHeight
        return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
})

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
</script>
