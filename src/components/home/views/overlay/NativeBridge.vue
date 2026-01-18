<template>
    <div class="p-3 flex-shrink-0">
        <h4 class="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
            GDI+ Overlay
            <span 
                class="w-2 h-2 rounded-full"
                :class="isNativeAvailable ? 'bg-green-500' : 'bg-red-500'"
            />
        </h4>
        
        <div v-if="!isNativeAvailable" class="text-[9px] text-muted-foreground p-1.5 bg-zinc-800/50 rounded">
            Pipe not configured for overlay streaming.
        </div>
        
        <div v-else class="space-y-1.5">
            <div v-if="error" class="text-[9px] text-red-400 p-1 bg-red-900/30 rounded">
                {{ error }}
            </div>
            
            <div class="flex items-center justify-between text-[9px]">
                <span class="text-muted-foreground">Status:</span>
                <span 
                    class="px-1.5 py-0.5 rounded text-[8px] font-mono"
                    :class="isActive ? 'bg-green-700 text-green-200' : 'bg-zinc-700 text-zinc-300'"
                >
                    {{ isActive ? 'streaming' : 'idle' }}
                </span>
            </div>
            
            <!-- Render Mode Toggle -->
            <div class="flex items-center justify-between text-[9px]">
                <span class="text-muted-foreground">Mode:</span>
                <div class="flex gap-0.5 bg-zinc-800 rounded p-0.5">
                    <button
                        @click="renderMode = 'tiles'"
                        :disabled="isActive"
                        class="px-1.5 py-0.5 rounded text-[8px] transition-colors"
                        :class="renderMode === 'tiles' 
                            ? 'bg-purple-600 text-white' 
                            : 'text-zinc-400 hover:text-white disabled:opacity-50'"
                    >
                        Tiles
                    </button>
                    <button
                        @click="renderMode = 'full'"
                        :disabled="isActive"
                        class="px-1.5 py-0.5 rounded text-[8px] transition-colors"
                        :class="renderMode === 'full' 
                            ? 'bg-purple-600 text-white' 
                            : 'text-zinc-400 hover:text-white disabled:opacity-50'"
                    >
                        Full Frame
                    </button>
                </div>
            </div>
            
            <!-- Recovery Interval (only for tiles mode) -->
            <div v-if="renderMode === 'tiles'" class="flex items-center justify-between text-[9px]">
                <span class="text-muted-foreground">Recovery:</span>
                <div class="flex items-center gap-1">
                    <input
                        type="range"
                        v-model.number="recoveryInterval"
                        :disabled="isActive"
                        min="0"
                        max="30"
                        step="1"
                        class="w-16 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                    />
                    <span class="text-[8px] font-mono w-8 text-right">
                        {{ recoveryInterval === 0 ? 'off' : `${recoveryInterval}s` }}
                    </span>
                </div>
            </div>
            
            <button 
                v-if="!isActive"
                @click="start"
                :disabled="!isRunning"
                class="w-full px-2 py-1 rounded-md text-[10px] bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
            >
                Start Native Stream
            </button>
            <template v-else>
                <button 
                    @click="stop"
                    class="w-full px-2 py-1 rounded-md text-[10px] bg-red-600 hover:bg-red-500 text-white"
                >
                    Stop Native Stream
                </button>
                <div class="flex gap-1">
                    <button 
                        @click="forceRerender"
                        class="flex-1 px-2 py-1 rounded-md text-[10px] bg-blue-600 hover:bg-blue-500 text-white"
                    >
                        Force Rerender
                    </button>
                    <button 
                        @click="clearOverlay"
                        class="flex-1 px-2 py-1 rounded-md text-[10px] bg-zinc-600 hover:bg-zinc-500 text-white"
                    >
                        Clear Overlay
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { native, argon } from '@argon/glue'
import type { IOverlayRenderer } from '@/lib/overlay'

const props = defineProps<{
    renderer: IOverlayRenderer | null
    isRunning: boolean
}>()

const isNativeAvailable = computed(() => argon.isArgonHost)
const isActive = ref(false)
const error = ref<string | null>(null)
const renderMode = ref<'tiles' | 'full'>('tiles')
const recoveryInterval = ref(5) // seconds, 0 = disabled
let stopCapture: (() => void) | null = null

function uint8ToBase64(data: Uint8Array): string {
    let binary = ''
    const len = data.length
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(data[i])
    }
    return btoa(binary)
}

async function start() {
    if (!props.renderer || !isNativeAvailable.value) return
    
    try {
        error.value = null
        
        const config = props.renderer.getInitConfig()
        await native.overlayController.init(config)
        console.log('[NativeBridge] Initialized:', config, 'mode:', renderMode.value)
        
        if (renderMode.value === 'full') {
            // Full frame mode - send entire canvas as one piece
            stopCapture = startFullFrameCapture()
        } else {
            // Tiles mode - dirty tile tracking with recovery
            stopCapture = props.renderer.startDirtyCapture(async (capture) => {
                try {
                    const bridgeTiles = capture.dirtyTiles.map(tile => ({
                        tx: tile.tileX,
                        ty: tile.tileY,
                        x: tile.x,
                        y: tile.y,
                        w: tile.width,
                        h: tile.height,
                        data: uint8ToBase64(tile.data)
                    }))
                    
                    // Count tiles (transparent tiles now have real data, not empty)
                    const totalTiles = bridgeTiles.length
                    
                    if (capture.fullRefresh) {
                        await native.overlayController.sendFullFrame({
                            timestamp: Math.floor(capture.timestamp),
                            width: capture.screenWidth,
                            height: capture.screenHeight,
                            tiles: bridgeTiles
                        })
                        console.log('[NativeBridge] Sent full frame:', totalTiles, 'tiles, transparent:', capture.transparentSkipped)
                    } else if (bridgeTiles.length > 0) {
                        await native.overlayController.sendDelta({
                            timestamp: Math.floor(capture.timestamp),
                            tiles: bridgeTiles,
                            skippedTransparent: capture.transparentSkipped
                        })
                        console.log('[NativeBridge] Sent delta:', totalTiles, 'tiles, transparent:', capture.transparentSkipped)
                    }
                } catch (e) {
                    console.error('[NativeBridge] Send error:', e)
                }
            }, 30, false, recoveryInterval.value)
        }
        
        isActive.value = true
        console.log('[NativeBridge] Streaming started in', renderMode.value, 'mode')
        
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
        console.error('[NativeBridge] Start error:', e)
    }
}

function startFullFrameCapture(): () => void {
    let isCapturing = true
    const fps = 30
    const interval = 1000 / fps
    let lastCapture = 0
    
    const captureLoop = () => {
        if (!isCapturing || !props.renderer) return
        
        const now = performance.now()
        if (now - lastCapture >= interval) {
            lastCapture = now
            
            try {
                // Get full canvas data
                const canvas = props.renderer.getCanvas()
                const width = canvas.width
                const height = canvas.height
                
                // Create temp 2D canvas to read WebGPU canvas
                const tempCanvas = document.createElement('canvas')
                tempCanvas.width = width
                tempCanvas.height = height
                const ctx = tempCanvas.getContext('2d', { willReadFrequently: true })!
                ctx.drawImage(canvas, 0, 0)
                const imageData = ctx.getImageData(0, 0, width, height)
                
                // Send as single "tile" covering entire canvas
                const fullFrameData = {
                    timestamp: Math.floor(now),
                    width,
                    height,
                    tiles: [{
                        tx: 0,
                        ty: 0,
                        x: 0,
                        y: 0,
                        w: width,
                        h: height,
                        data: uint8ToBase64(new Uint8Array(imageData.data.buffer))
                    }]
                }
                
                native.overlayController.sendFullFrame(fullFrameData)
                    .then(() => console.log('[NativeBridge] Full frame sent:', width, 'x', height))
                    .catch((e: unknown) => console.error('[NativeBridge] Full frame error:', e))
                    
            } catch (e) {
                console.error('[NativeBridge] Full frame capture error:', e)
            }
        }
        
        requestAnimationFrame(captureLoop)
    }
    
    captureLoop()
    
    return () => {
        isCapturing = false
    }
}

async function stop() {
    if (stopCapture) {
        stopCapture()
        stopCapture = null
    }
    
    if (isActive.value) {
        try {
            await native.overlayController.clear()
            await native.overlayController.dispose()
        } catch (e) {
            console.error('[NativeBridge] Stop error:', e)
        }
    }
    
    isActive.value = false
    console.log('[NativeBridge] Stopped')
}

async function clearOverlay() {
    try {
        await native.overlayController.clear()
        console.log('[NativeBridge] Overlay cleared')
    } catch (e) {
        console.error('[NativeBridge] Clear error:', e)
        error.value = e instanceof Error ? e.message : String(e)
    }
}

function forceRerender() {
    if (props.renderer) {
        props.renderer.invalidateFrame()
        console.log('[NativeBridge] Frame invalidated, full refresh on next capture')
    }
}

onUnmounted(() => {
    stop()
})

// Expose for parent component
defineExpose({ stop })
</script>
