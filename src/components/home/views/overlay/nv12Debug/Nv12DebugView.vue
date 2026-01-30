<template>
    <div class="nv12-debug-view h-full w-full flex-1 bg-background overflow-y-auto">
        <div class="p-4 space-y-4 max-w-7xl mx-auto">
            <!-- Video Preview -->
            <section class="bg-card border border-border rounded-xl overflow-hidden">
                <div class="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <Video :size="14" class="text-muted-foreground" />
                        <h3 class="text-sm font-medium text-foreground">Video Preview</h3>
                        <span v-if="isStreaming" class="text-xs text-green-400">● Streaming</span>
                    </div>
                    <div class="flex items-center gap-2 text-xs text-muted-foreground">
                        <span v-if="videoTrack">{{ videoWidth }}x{{ videoHeight }} @ {{ frameRate }}fps</span>
                    </div>
                </div>
                <div class="relative bg-black" style="aspect-ratio: 16/9;">
                    <video
                        ref="videoElement"
                        class="w-full h-full object-contain"
                        autoplay
                        muted
                    />
                    <div v-if="!isStreaming" class="absolute inset-0 flex items-center justify-center text-muted-foreground">
                        <div class="text-center">
                            <VideoOff :size="48" class="mx-auto mb-2 opacity-30" />
                            <p class="text-sm">No video stream</p>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Main Grid -->
            <div class="grid grid-cols-3 gap-4">
                <!-- Column 1: Stream Control -->
                <section class="bg-card border border-border rounded-xl p-4 space-y-4">
                    <h3 class="text-sm font-medium text-foreground flex items-center gap-2">
                        <Play :size="14" class="text-muted-foreground" />
                        Stream Control
                    </h3>

                    <div>
                        <label class="text-xs text-muted-foreground mb-1 block">
                            Display Index
                        </label>
                        <input
                            v-model.number="displayIndex"
                            type="number"
                            min="0"
                            class="w-full px-2 py-1.5 bg-background border border-border rounded text-foreground text-xs font-mono"
                            placeholder="0"
                        />
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="text-xs text-muted-foreground mb-1 block">
                                Width
                            </label>
                            <input
                                v-model.number="textureWidth"
                                type="number"
                                min="1"
                                class="w-full px-2 py-1.5 bg-background border border-border rounded text-foreground text-xs font-mono"
                                placeholder="1920"
                            />
                        </div>
                        <div>
                            <label class="text-xs text-muted-foreground mb-1 block">
                                Height
                            </label>
                            <input
                                v-model.number="textureHeight"
                                type="number"
                                min="1"
                                class="w-full px-2 py-1.5 bg-background border border-border rounded text-foreground text-xs font-mono"
                                placeholder="1080"
                            />
                        </div>
                    </div>

                    <button
                        @click="initializeMonitor"
                        :disabled="isInitializing || isStreaming"
                        class="w-full px-2 py-1.5 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors flex items-center justify-center gap-1"
                    >
                        <Monitor :size="12" />
                        Initialize Monitor
                    </button>

                    <div v-if="streamId" class="pt-2 border-t border-border">
                        <label class="text-xs text-muted-foreground mb-1 block">
                            Stream ID (auto-generated)
                        </label>
                        <div class="w-full px-2 py-1.5 bg-muted border border-border rounded text-foreground text-xs font-mono break-all">
                            {{ streamId }}
                        </div>
                    </div>

                    <button
                        @click="startStreaming"
                        :disabled="isStreaming || !streamId || isInitializing"
                        class="w-full px-2 py-1.5 bg-green-500/15 text-green-400 hover:bg-green-500/25 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors flex items-center justify-center gap-1"
                    >
                        <Play :size="12" />
                        {{ streamId ? 'Start Stream' : 'Initialize Monitor First' }}
                    </button>

                    <button
                        @click="stopStreaming"
                        :disabled="!isStreaming"
                        class="w-full px-2 py-1.5 bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors flex items-center justify-center gap-1"
                    >
                        <Square :size="12" />
                        Stop Stream
                    </button>

                    <!-- Track State -->
                    <div class="pt-2 border-t border-border space-y-2">
                        <div class="flex justify-between text-xs">
                            <span class="text-muted-foreground">Ready State:</span>
                            <span :class="getReadyStateClass()" class="font-mono">
                                {{ readyState }}
                            </span>
                        </div>
                        <div class="flex justify-between text-xs">
                            <span class="text-muted-foreground">Enabled:</span>
                            <span class="font-mono" :class="trackEnabled ? 'text-green-400' : 'text-red-400'">
                                {{ trackEnabled }}
                            </span>
                        </div>
                        <div class="flex justify-between text-xs">
                            <span class="text-muted-foreground">Muted:</span>
                            <span class="font-mono" :class="trackMuted ? 'text-yellow-400' : 'text-foreground'">
                                {{ trackMuted }}
                            </span>
                        </div>
                    </div>
                </section>

                <!-- Column 2: Track Info -->
                <section class="bg-card border border-border rounded-xl p-4 space-y-4">
                    <h3 class="text-sm font-medium text-foreground flex items-center gap-2">
                        <Info :size="14" class="text-muted-foreground" />
                        Track Info
                    </h3>

                    <div v-if="videoTrack" class="space-y-2 text-xs font-mono">
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Track ID:</span>
                            <span class="text-foreground truncate ml-2 max-w-[150px]" :title="trackId">
                                {{ trackId }}
                            </span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Label:</span>
                            <span class="text-foreground">{{ trackLabel || 'N/A' }}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Kind:</span>
                            <span class="text-foreground">{{ trackKind }}</span>
                        </div>
                    </div>

                    <div v-if="videoTrack" class="pt-2 border-t border-border">
                        <h4 class="text-xs font-medium text-muted-foreground mb-2">Settings</h4>
                        <div class="space-y-1 text-xs font-mono">
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Width:</span>
                                <span class="text-foreground">{{ videoWidth }}px</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Height:</span>
                                <span class="text-foreground">{{ videoHeight }}px</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Frame Rate:</span>
                                <span class="text-foreground">{{ frameRate }} fps</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Aspect Ratio:</span>
                                <span class="text-foreground">{{ aspectRatio }}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Facing Mode:</span>
                                <span class="text-foreground">{{ facingMode || 'N/A' }}</span>
                            </div>
                        </div>
                    </div>

                    <div v-if="!videoTrack" class="text-center py-8 text-muted-foreground text-xs">
                        No active video track
                    </div>
                </section>

                <!-- Column 3: Stream Info -->
                <section class="bg-card border border-border rounded-xl p-4 space-y-4">
                    <h3 class="text-sm font-medium text-foreground flex items-center gap-2">
                        <Layers :size="14" class="text-muted-foreground" />
                        Stream Info
                    </h3>

                    <div v-if="mediaStream" class="space-y-2 text-xs font-mono">
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Stream ID:</span>
                            <span class="text-foreground truncate ml-2 max-w-[150px]" :title="mediaStream.id">
                                {{ mediaStream.id }}
                            </span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Active:</span>
                            <span :class="mediaStream.active ? 'text-green-400' : 'text-red-400'">
                                {{ mediaStream.active }}
                            </span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Video Tracks:</span>
                            <span class="text-foreground">{{ videoTracksCount }}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Audio Tracks:</span>
                            <span class="text-foreground">{{ audioTracksCount }}</span>
                        </div>
                    </div>

                    <div v-if="!mediaStream" class="text-center py-8 text-muted-foreground text-xs">
                        No active stream
                    </div>

                    <!-- Error Display -->
                    <div v-if="lastError" class="pt-2 border-t border-border">
                        <div class="text-xs font-medium text-red-400 mb-1 flex items-center gap-1">
                            <AlertCircle :size="12" />
                            Last Error
                        </div>
                        <div class="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 font-mono whitespace-pre-wrap">
                            {{ lastError }}
                        </div>
                    </div>

                    <!-- WebView2 API Status -->
                    <div class="pt-2 border-t border-border">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs font-medium text-muted-foreground">WebView2 API</span>
                            <span 
                                class="text-xs font-mono"
                                :class="webviewApiAvailable ? 'text-green-400' : 'text-red-400'"
                            >
                                {{ webviewApiAvailable ? 'Available' : 'Not Available' }}
                            </span>
                        </div>
                        <div v-if="!webviewApiAvailable" class="text-[10px] text-muted-foreground">
                            window.chrome.webview.getTextureStream is not available
                        </div>
                    </div>
                </section>
            </div>

            <!-- Event Log - Full Width -->
            <section class="bg-card border border-border rounded-xl overflow-hidden">
                <div class="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <ScrollText :size="14" class="text-muted-foreground" />
                        <h3 class="text-sm font-medium text-foreground">Event Log</h3>
                        <span class="text-xs text-muted-foreground">{{ eventLog.length }} events</span>
                    </div>
                    <button @click="clearEventLog" class="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                        <Trash2 :size="12" />
                        Clear
                    </button>
                </div>
                <div class="p-3 h-32 overflow-y-auto font-mono text-[11px]">
                    <div v-if="eventLog.length === 0" class="text-muted-foreground text-center py-4">
                        No events yet
                    </div>
                    <div v-for="(event, idx) in eventLog" :key="idx" class="flex gap-2 py-0.5">
                        <span class="text-muted-foreground shrink-0">{{ event.time }}</span>
                        <span :class="getEventTypeClass(event.type)" class="font-medium shrink-0 min-w-[80px]">{{ event.type }}</span>
                        <span class="text-foreground">{{ event.data }}</span>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
    Video,
    VideoOff,
    Play,
    Square,
    Info,
    Layers,
    ScrollText,
    Trash2,
    AlertCircle,
    Monitor
} from 'lucide-vue-next'
import { native } from '@argon/glue'

// Monitor configuration
const displayIndex = ref(0)
const textureWidth = ref(2560)
const textureHeight = ref(1440)
const isInitializing = ref(false)

// Stream state
const streamId = ref('')
const isStreaming = ref(false)
const mediaStream = ref<MediaStream | null>(null)
const videoTrack = ref<MediaStreamTrack | null>(null)
const videoElement = ref<HTMLVideoElement | null>(null)
const lastError = ref<string>('')

// Track state
const readyState = ref<string>('N/A')
const trackEnabled = ref(false)
const trackMuted = ref(false)
const trackId = ref('')
const trackLabel = ref('')
const trackKind = ref('')

// Video settings
const videoWidth = ref(0)
const videoHeight = ref(0)
const frameRate = ref(0)
const aspectRatio = ref(0)
const facingMode = ref('')

// Stream info
const videoTracksCount = computed(() => mediaStream.value?.getVideoTracks().length || 0)
const audioTracksCount = computed(() => mediaStream.value?.getAudioTracks().length || 0)

// WebView2 API availability
const webviewApiAvailable = computed(() => {
    return !!(window as any).chrome?.webview?.getTextureStream
})

// Event log
interface LogEvent {
    time: string
    type: string
    data: string
}
const eventLog = ref<LogEvent[]>([])

async function initializeMonitor() {
    if (isInitializing.value || isStreaming.value) return

    try {
        isInitializing.value = true
        lastError.value = ''
        logEvent('Monitor', `Initializing display ${displayIndex.value} (${textureWidth.value}x${textureHeight.value})`)

        // Call native method to start shared texture streaming
        const generatedStreamId = await native.hostProc.startSharedTextureWithStreamingByMonitor(
            displayIndex.value,
            textureWidth.value,
            textureHeight.value
        )

        if (!generatedStreamId) {
            throw new Error('Failed to get stream ID from host')
        }

        streamId.value = generatedStreamId
        logEvent('Monitor', `Stream ID received: ${generatedStreamId}`)
        logEvent('Success', 'Monitor initialized successfully')

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        lastError.value = errorMsg
        logEvent('Error', `Monitor init failed: ${errorMsg}`)
        console.error('[Nv12DebugView] Monitor initialization error:', error)
    } finally {
        isInitializing.value = false
    }
}

async function startStreaming() {
    if (!streamId.value) {
        logEvent('Error', 'Stream ID is required')
        return
    }

    if (!webviewApiAvailable.value) {
        lastError.value = 'WebView2 API not available. Make sure you are running in WebView2 context.'
        logEvent('Error', 'WebView2 API not available')
        return
    }

    try {
        logEvent('Stream', `Requesting stream: ${streamId.value}`)
        
        // Request stream from the host
        const stream = await (window as any).chrome.webview.getTextureStream(streamId.value)
        
        if (!stream) {
            throw new Error('getTextureStream returned null or undefined')
        }

        mediaStream.value = stream
        logEvent('Stream', 'Stream acquired successfully')

        // Get video track
        const tracks = stream.getVideoTracks()
        if (tracks.length === 0) {
            throw new Error('No video tracks in stream')
        }

        videoTrack.value = tracks[0]
        logEvent('Track', `Video track acquired: ${tracks[0].id}`)

        // Update track info
        updateTrackInfo()

        // Setup event listeners
        setupTrackListeners()

        // Attach to video element
        if (videoElement.value) {
            videoElement.value.srcObject = stream
            logEvent('Video', 'Stream attached to video element')
        }

        isStreaming.value = true
        lastError.value = ''

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        lastError.value = errorMsg
        logEvent('Error', errorMsg)
        console.error('[Nv12DebugView] Stream error:', error)
    }
}

function stopStreaming() {
    if (!videoTrack.value) return

    try {
        logEvent('Stream', 'Stopping stream...')

        // Stop the track
        videoTrack.value.stop()

        // Clear video element
        if (videoElement.value) {
            videoElement.value.srcObject = null
        }

        // Clear refs
        videoTrack.value = null
        mediaStream.value = null
        isStreaming.value = false

        // Reset info
        resetTrackInfo()

        logEvent('Stream', 'Stream stopped')
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logEvent('Error', errorMsg)
        console.error('[Nv12DebugView] Stop error:', error)
    }
}

function setupTrackListeners() {
    if (!videoTrack.value) return

    const track = videoTrack.value

    track.addEventListener('ended', () => {
        logEvent('Track', 'Track ended')
        isStreaming.value = false
        resetTrackInfo()
    })

    track.addEventListener('mute', () => {
        logEvent('Track', 'Track muted')
        trackMuted.value = true
    })

    track.addEventListener('unmute', () => {
        logEvent('Track', 'Track unmuted')
        trackMuted.value = false
    })
}

function updateTrackInfo() {
    if (!videoTrack.value) return

    const track = videoTrack.value

    trackId.value = track.id
    trackLabel.value = track.label
    trackKind.value = track.kind
    readyState.value = track.readyState
    trackEnabled.value = track.enabled
    trackMuted.value = track.muted

    // Get settings
    try {
        const settings = track.getSettings()
        videoWidth.value = settings.width || 0
        videoHeight.value = settings.height || 0
        frameRate.value = settings.frameRate || 0
        aspectRatio.value = settings.aspectRatio || 0
        facingMode.value = settings.facingMode || ''
    } catch (error) {
        console.error('[Nv12DebugView] Failed to get settings:', error)
    }
}

function resetTrackInfo() {
    trackId.value = ''
    trackLabel.value = ''
    trackKind.value = ''
    readyState.value = 'N/A'
    trackEnabled.value = false
    trackMuted.value = false
    videoWidth.value = 0
    videoHeight.value = 0
    frameRate.value = 0
    aspectRatio.value = 0
    facingMode.value = ''
}

// Periodic update for track state
let updateIntervalId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
    logEvent('Debug', 'Nv12DebugView mounted')
    
    updateIntervalId = setInterval(() => {
        if (videoTrack.value) {
            updateTrackInfo()
        }
    }, 1000)
})

onUnmounted(() => {
    logEvent('Debug', 'Nv12DebugView unmounting')
    
    if (updateIntervalId) {
        clearInterval(updateIntervalId)
    }

    if (isStreaming.value) {
        stopStreaming()
    }
})

function logEvent(type: string, data: string) {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    eventLog.value.unshift({ time, type, data })
    if (eventLog.value.length > 50) eventLog.value.length = 50
}

function clearEventLog() {
    eventLog.value = []
}

function getReadyStateClass() {
    switch (readyState.value) {
        case 'live': return 'text-green-400'
        case 'ended': return 'text-red-400'
        default: return 'text-muted-foreground'
    }
}

function getEventTypeClass(type: string) {
    switch (type) {
        case 'Error': return 'text-red-400'
        case 'Stream': return 'text-blue-400'
        case 'Track': return 'text-purple-400'
        case 'Video': return 'text-green-400'
        case 'Debug': return 'text-yellow-400'
        case 'Monitor': return 'text-cyan-400'
        case 'Success': return 'text-green-400'
        default: return 'text-foreground'
    }
}
</script>

<style scoped>
.overflow-y-auto::-webkit-scrollbar {
    width: 4px;
}

.overflow-y-auto::-webkit-scrollbar-track {
    background: transparent;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
    background: hsl(var(--muted));
    border-radius: 4px;
}
</style>