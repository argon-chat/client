<template>
    <div class="p-3 border-b border-border space-y-2 flex-shrink-0">
        <h4 class="text-xs font-medium text-muted-foreground">Frame Capture</h4>
        
        <!-- Capture mode toggle -->
        <div class="flex gap-0.5 p-0.5 bg-zinc-800 rounded-md">
            <button 
                @click="captureMode = 'full'"
                :class="[
                    'flex-1 px-1.5 py-0.5 rounded text-[10px] transition-colors',
                    captureMode === 'full' 
                        ? 'bg-zinc-600 text-white' 
                        : 'text-muted-foreground hover:text-foreground'
                ]"
            >
                Full
            </button>
            <button 
                @click="captureMode = 'fragment'"
                :class="[
                    'flex-1 px-1.5 py-0.5 rounded text-[10px] transition-colors',
                    captureMode === 'fragment' 
                        ? 'bg-zinc-600 text-white' 
                        : 'text-muted-foreground hover:text-foreground'
                ]"
            >
                Fragment
            </button>
            <button 
                @click="captureMode = 'dirty'"
                :class="[
                    'flex-1 px-1.5 py-0.5 rounded text-[10px] transition-colors',
                    captureMode === 'dirty' 
                        ? 'bg-zinc-600 text-white' 
                        : 'text-muted-foreground hover:text-foreground'
                ]"
            >
                Dirty
            </button>
        </div>
        
        <div v-if="captureMode === 'full'" class="flex gap-1.5">
            <select 
                v-model="captureFormat" 
                class="flex-1 px-1.5 py-1 rounded-md text-[10px] bg-zinc-800 border border-zinc-600 text-foreground"
            >
                <option value="raw">Raw RGBA</option>
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/webp">WebP</option>
            </select>
            <button 
                @click="captureFrame"
                :disabled="!isRunning"
                class="px-2 py-1 rounded-md text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
            >
                Capture
            </button>
        </div>
        
        <div v-else-if="captureMode === 'fragment'" class="space-y-1.5">
            <button 
                @click="captureFragments"
                :disabled="!isRunning"
                class="w-full px-2 py-1 rounded-md text-[10px] bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
            >
                Capture Fragments
            </button>
            <button 
                @click="captureCombined"
                :disabled="!isRunning"
                class="w-full px-2 py-1 rounded-md text-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
            >
                Capture Combined
            </button>
        </div>
        
        <!-- Dirty Tiles Mode -->
        <div v-else-if="captureMode === 'dirty'" class="space-y-1.5">
            <div class="flex items-center gap-1.5">
                <label class="text-[9px] text-muted-foreground">Tile:</label>
                <select 
                    v-model.number="dirtyTileSize" 
                    @change="updateDirtyTileSize"
                    class="flex-1 px-1.5 py-0.5 rounded-md text-[10px] bg-zinc-800 border border-zinc-600 text-foreground"
                >
                    <option :value="16">16×16</option>
                    <option :value="32">32×32</option>
                    <option :value="64">64×64</option>
                    <option :value="128">128×128</option>
                </select>
            </div>
            
            <div class="flex gap-1.5">
                <button 
                    @click="captureDirtyTiles"
                    :disabled="!isRunning"
                    class="flex-1 px-2 py-1 rounded-md text-[10px] bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                >
                    Capture
                </button>
                <button 
                    @click="toggleDirtyStream"
                    :disabled="!isRunning"
                    :class="[
                        'flex-1 px-2 py-1 rounded-md text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white',
                        isDirtyStreaming 
                            ? 'bg-red-600 hover:bg-red-500' 
                            : 'bg-green-600 hover:bg-green-500'
                    ]"
                >
                    {{ isDirtyStreaming ? 'Stop' : 'Stream' }}
                </button>
            </div>
            
            <!-- Dirty stats -->
            <div v-if="dirtyStats" class="p-1.5 bg-zinc-900/50 rounded text-[9px] space-y-0.5">
                <div class="flex justify-between">
                    <span class="text-muted-foreground">Dirty:</span>
                    <span class="font-mono" :class="dirtyStats.dirtyPercent < 20 ? 'text-green-400' : 'text-yellow-400'">
                        {{ dirtyStats.dirtyCount }}/{{ dirtyStats.totalTiles }} ({{ dirtyStats.dirtyPercent.toFixed(1) }}%)
                    </span>
                </div>
                <div class="flex justify-between">
                    <span class="text-muted-foreground">Data:</span>
                    <span class="font-mono text-green-400">{{ formatBytes(dirtyStats.totalBytes) }}</span>
                </div>
            </div>
        </div>
        
        <div v-if="lastCapture" class="text-[9px] text-muted-foreground">
            <span>{{ lastCapture.width }}×{{ lastCapture.height }}</span> · 
            <span>{{ formatBytes(lastCapture.bytes) }}</span> · 
            <span>{{ lastCapture.captureTime.toFixed(1) }}ms</span>
            <span v-if="lastCapture.savings" class="text-green-400 ml-1">(-{{ lastCapture.savings }}%)</span>
        </div>
        
        <!-- Preview thumbnail -->
        <div v-if="capturePreview" class="space-y-1.5">
            <img 
                :src="capturePreview" 
                class="w-full rounded border border-zinc-600"
                alt="Capture preview"
            />
            <button 
                @click="downloadCapture"
                class="w-full px-2 py-1 rounded-md text-[10px] bg-green-600 hover:bg-green-500 text-white"
            >
                Download
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import type { IOverlayRenderer, DirtyCapture } from '@/lib/overlay'

const props = defineProps<{
    renderer: IOverlayRenderer | null
    isRunning: boolean
}>()

const captureMode = ref<'full' | 'fragment' | 'dirty'>('dirty')
const captureFormat = ref<'raw' | 'image/png' | 'image/jpeg' | 'image/webp'>('image/png')
const capturePreview = ref<string | null>(null)
const lastCapture = ref<{
    width: number
    height: number
    bytes: number
    captureTime: number
    blob?: Blob
    regions?: number
    fullFrameBytes?: number
    savings?: number
} | null>(null)

// Dirty tile capture state
const dirtyTileSize = ref(32)
const isDirtyStreaming = ref(false)
const dirtyStats = ref<{
    tilesX: number
    tilesY: number
    totalTiles: number
    dirtyCount: number
    dirtyPercent: number
    totalBytes: number
    fullRefresh: boolean
    transparentSkipped: number
    transparentSaved: number
} | null>(null)
let stopDirtyStream: (() => void) | null = null

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function captureFrame() {
    if (!props.renderer) return
    
    const startTime = performance.now()
    
    try {
        if (captureFormat.value === 'raw') {
            const { data, width, height } = await props.renderer.captureRawFrame()
            const captureTime = performance.now() - startTime
            
            lastCapture.value = { width, height, bytes: data.byteLength, captureTime }
            
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = width
            tempCanvas.height = height
            const ctx = tempCanvas.getContext('2d')!
            const imageData = new ImageData(new Uint8ClampedArray(data), width, height)
            ctx.putImageData(imageData, 0, 0)
            capturePreview.value = tempCanvas.toDataURL('image/png')
            
        } else {
            const blob = await props.renderer.captureBlob(captureFormat.value as any, 0.92)
            const captureTime = performance.now() - startTime
            
            const { width, height } = props.renderer.getFrameInfo()
            
            lastCapture.value = { width, height, bytes: blob.size, captureTime, blob }
            
            if (capturePreview.value) URL.revokeObjectURL(capturePreview.value)
            capturePreview.value = URL.createObjectURL(blob)
        }
    } catch (error) {
        console.error('[FrameCapture] Capture failed:', error)
    }
}

function downloadCapture() {
    if (!lastCapture.value || !capturePreview.value) return
    
    const link = document.createElement('a')
    link.href = capturePreview.value
    
    const ext = captureFormat.value === 'raw' ? 'png' : 
                captureFormat.value === 'image/png' ? 'png' :
                captureFormat.value === 'image/jpeg' ? 'jpg' : 'webp'
    
    link.download = `overlay-capture-${Date.now()}.${ext}`
    link.click()
}

async function captureFragments() {
    if (!props.renderer) return
    
    const startTime = performance.now()
    
    try {
        const capture = await props.renderer.captureFragments()
        const captureTime = performance.now() - startTime
        
        const fullFrameBytes = capture.screenWidth * capture.screenHeight * 4
        const savings = Math.round((1 - capture.totalBytes / fullFrameBytes) * 100)
        
        const bounds = props.renderer.getVisibleBounds()
        if (bounds) {
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = bounds.width
            tempCanvas.height = bounds.height
            const ctx = tempCanvas.getContext('2d')!
            
            for (const region of capture.regions) {
                const dataCopy = new Uint8ClampedArray(region.data.length)
                dataCopy.set(region.data)
                const imageData = new ImageData(dataCopy, region.width, region.height)
                ctx.putImageData(imageData, region.x - bounds.x, region.y - bounds.y)
            }
            
            if (capturePreview.value?.startsWith('blob:')) URL.revokeObjectURL(capturePreview.value)
            capturePreview.value = tempCanvas.toDataURL('image/png')
        }
        
        lastCapture.value = {
            width: capture.screenWidth,
            height: capture.screenHeight,
            bytes: capture.totalBytes,
            captureTime,
            regions: capture.regions.length,
            fullFrameBytes,
            savings
        }
    } catch (error) {
        console.error('[FrameCapture] Fragment capture failed:', error)
    }
}

async function captureCombined() {
    if (!props.renderer) return
    
    const startTime = performance.now()
    
    try {
        const region = await props.renderer.captureCombinedRegion()
        if (!region) return
        
        const captureTime = performance.now() - startTime
        const fullFrameBytes = props.renderer.getFrameInfo().totalBytes
        const savings = Math.round((1 - region.data.length / fullFrameBytes) * 100)
        
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = region.width
        tempCanvas.height = region.height
        const ctx = tempCanvas.getContext('2d')!
        const imageData = new ImageData(new Uint8ClampedArray(region.data), region.width, region.height)
        ctx.putImageData(imageData, 0, 0)
        
        if (capturePreview.value?.startsWith('blob:')) URL.revokeObjectURL(capturePreview.value)
        capturePreview.value = tempCanvas.toDataURL('image/png')
        
        lastCapture.value = {
            width: region.width,
            height: region.height,
            bytes: region.data.length,
            captureTime,
            regions: 1,
            fullFrameBytes,
            savings
        }
    } catch (error) {
        console.error('[FrameCapture] Combined capture failed:', error)
    }
}

function updateDirtyTileSize() {
    if (props.renderer) {
        props.renderer.setDirtyTileSize(dirtyTileSize.value)
    }
}

function captureDirtyTiles() {
    if (!props.renderer) return
    
    const startTime = performance.now()
    
    try {
        const capture = props.renderer.captureDirtyTiles()
        const captureTime = performance.now() - startTime
        
        dirtyStats.value = {
            tilesX: capture.tilesX,
            tilesY: capture.tilesY,
            totalTiles: capture.totalTiles,
            dirtyCount: capture.dirtyCount,
            dirtyPercent: capture.dirtyPercent,
            totalBytes: capture.totalBytes,
            fullRefresh: capture.fullRefresh,
            transparentSkipped: capture.transparentSkipped,
            transparentSaved: capture.transparentSaved
        }
        
        createDirtyPreview(capture)
        
        const fullFrameBytes = capture.screenWidth * capture.screenHeight * 4
        const savings = fullFrameBytes > 0 ? Math.round((1 - capture.totalBytes / fullFrameBytes) * 100) : 0
        
        lastCapture.value = {
            width: capture.screenWidth,
            height: capture.screenHeight,
            bytes: capture.totalBytes,
            captureTime,
            regions: capture.dirtyCount,
            fullFrameBytes,
            savings
        }
    } catch (error) {
        console.error('[FrameCapture] Dirty capture failed:', error)
    }
}

function createDirtyPreview(capture: DirtyCapture) {
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = capture.screenWidth
    tempCanvas.height = capture.screenHeight
    const ctx = tempCanvas.getContext('2d')!
    
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, capture.screenWidth, capture.screenHeight)
    
    for (const tile of capture.dirtyTiles) {
        // Skip empty tiles
        if (!tile.data || tile.data.length === 0 || tile.width === 0 || tile.height === 0) continue
        
        const imageData = new ImageData(new Uint8ClampedArray(tile.data), tile.width, tile.height)
        ctx.putImageData(imageData, tile.x, tile.y)
        
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'
        ctx.lineWidth = 1
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, tile.width - 1, tile.height - 1)
    }
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.lineWidth = 0.5
    for (let x = 0; x < capture.screenWidth; x += capture.tileSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, capture.screenHeight)
        ctx.stroke()
    }
    for (let y = 0; y < capture.screenHeight; y += capture.tileSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(capture.screenWidth, y)
        ctx.stroke()
    }
    
    if (capturePreview.value?.startsWith('blob:')) URL.revokeObjectURL(capturePreview.value)
    capturePreview.value = tempCanvas.toDataURL('image/png')
}

function toggleDirtyStream() {
    if (isDirtyStreaming.value) {
        if (stopDirtyStream) {
            stopDirtyStream()
            stopDirtyStream = null
        }
        isDirtyStreaming.value = false
    } else {
        if (!props.renderer) return
        
        isDirtyStreaming.value = true
        let frameCount = 0
        let totalBytes = 0
        const startTime = performance.now()
        
        stopDirtyStream = props.renderer.startDirtyCapture((capture) => {
            frameCount++
            totalBytes += capture.totalBytes
            
            dirtyStats.value = {
                tilesX: capture.tilesX,
                tilesY: capture.tilesY,
                totalTiles: capture.totalTiles,
                dirtyCount: capture.dirtyCount,
                dirtyPercent: capture.dirtyPercent,
                totalBytes: capture.totalBytes,
                fullRefresh: capture.fullRefresh,
                transparentSkipped: capture.transparentSkipped,
                transparentSaved: capture.transparentSaved
            }
            
            if (frameCount % 10 === 0) {
                createDirtyPreview(capture)
            }
        }, 30, true)
    }
}

onUnmounted(() => {
    if (stopDirtyStream) {
        stopDirtyStream()
        stopDirtyStream = null
    }
    
    if (capturePreview.value?.startsWith('blob:')) {
        URL.revokeObjectURL(capturePreview.value)
    }
})
</script>
