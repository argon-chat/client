<template>
    <div class="audio-debug-view h-full w-full flex-1 bg-background overflow-y-auto">
        <div class="p-4 space-y-4 max-w-7xl mx-auto">
            <section class="bg-card border border-border rounded-xl overflow-hidden">
                <div class="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <GitBranch :size="14" class="text-muted-foreground" />
                        <h3 class="text-sm font-medium text-foreground">Audio Graph</h3>
                        <span v-if="activeWorklets.length > 0" class="text-xs text-muted-foreground">
                            ({{ activeWorklets.length }} worklets)
                        </span>
                    </div>
                    <div class="flex items-center gap-4 text-xs text-muted-foreground">
                        <span class="flex items-center gap-1">
                            <Mic :size="12" />
                            <span class="font-mono" :style="{ color: getLevelColor(inputLevelL) }">{{ inputLevelL }}</span>
                            <span class="text-muted-foreground/50">/</span>
                            <span class="font-mono" :style="{ color: getLevelColor(inputLevelR) }">{{ inputLevelR }}</span>
                        </span>
                        <span class="flex items-center gap-1">
                            <Volume2 :size="12" />
                            <span class="font-mono" :style="{ color: getLevelColor(outputLevel) }">{{ outputLevel.toFixed(0) }}%</span>
                        </span>
                    </div>
                </div>
                <div class="h-[500px] w-full">
                    <AudioGraph
                        :nodes="graphNodes"
                        :connections="graphConnections"
                        :input-level="inputLevel"
                        :output-level="outputLevel"
                        :channel-count="channelCount"
                        :sample-rate="sampleRate"
                        class="h-full w-full"
                        @node-click="onGraphNodeClick"
                    />
                </div>
            </section>

            <!-- Main Grid -->
            <div class="grid grid-cols-3 gap-4">
                <!-- Column 1: Devices -->
                <section class="bg-card border border-border rounded-xl p-4 space-y-4">
                    <h3 class="text-sm font-medium text-foreground flex items-center gap-2">
                        <Headphones :size="14" class="text-muted-foreground" />
                        Devices
                    </h3>
                    
                    <!-- Input Device -->
                    <div>
                        <label class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                            <Mic :size="10" /> Input
                        </label>
                        <select 
                            v-model="selectedInputDevice"
                            @change="onInputDeviceChange"
                            class="w-full px-2 py-1.5 bg-background border border-border rounded text-foreground text-xs"
                        >
                            <option v-for="device in inputDevices" :key="device.deviceId" :value="device.deviceId">
                                {{ device.label || `Device ${device.deviceId.slice(0, 8)}...` }}
                            </option>
                        </select>
                    </div>

                    <!-- Output Device -->
                    <div>
                        <label class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                            <Speaker :size="10" /> Output
                        </label>
                        <select 
                            v-model="selectedOutputDevice"
                            @change="onOutputDeviceChange"
                            class="w-full px-2 py-1.5 bg-background border border-border rounded text-foreground text-xs"
                        >
                            <option v-for="device in outputDevices" :key="device.deviceId" :value="device.deviceId">
                                {{ device.label || `Device ${device.deviceId.slice(0, 8)}...` }}
                            </option>
                        </select>
                    </div>

                    <button 
                        @click="refreshDevices"
                        class="w-full px-2 py-1.5 bg-muted text-foreground rounded text-xs hover:bg-muted/80 transition-colors flex items-center justify-center gap-1"
                    >
                        <RefreshCw :size="12" />
                        Refresh ({{ totalDevices }})
                    </button>

                    <!-- Audio Processing -->
                    <div class="pt-2 border-t border-border space-y-2">
                        <label class="flex items-center gap-2 cursor-pointer text-xs">
                            <input type="checkbox" v-model="echoCancellation" @change="onConstraintsChange" class="w-3 h-3" />
                            <span class="text-foreground">Echo Cancellation</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer text-xs">
                            <input type="checkbox" v-model="noiseSuppression" @change="onConstraintsChange" class="w-3 h-3" />
                            <span class="text-foreground">Noise Suppression</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer text-xs">
                            <input type="checkbox" v-model="autoGainControl" @change="onConstraintsChange" class="w-3 h-3" />
                            <span class="text-foreground">Auto Gain Control</span>
                        </label>
                    </div>
                </section>

                <!-- Column 2: Volume & VU -->
                <section class="bg-card border border-border rounded-xl p-4 space-y-4">
                    <h3 class="text-sm font-medium text-foreground flex items-center gap-2">
                        <Volume2 :size="14" class="text-muted-foreground" />
                        Volume
                    </h3>

                    <!-- Input Volume -->
                    <div>
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-xs text-muted-foreground flex items-center gap-1">
                                <Mic :size="10" /> Input
                            </span>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-mono">{{ inputVolume }}%</span>
                                <button 
                                    @click="toggleInputMute"
                                    :class="['w-6 h-6 rounded text-xs flex items-center justify-center', inputMuted ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400']"
                                >
                                    <MicOff v-if="inputMuted" :size="12" />
                                    <Mic v-else :size="12" />
                                </button>
                            </div>
                        </div>
                        <input 
                            type="range" min="0" max="100" v-model.number="inputVolume"
                            @input="onInputVolumeChange"
                            class="w-full h-1.5 mb-1"
                        />
                        <!-- Stereo VU Meters -->
                        <div class="space-y-0.5">
                            <div class="flex items-center gap-1">
                                <span class="text-[9px] text-muted-foreground w-2">L</span>
                                <div class="flex-1 h-1.5 rounded-full overflow-hidden bg-muted">
                                    <div 
                                        class="h-full transition-all duration-75"
                                        :style="{ width: `${inputLevelL}%`, backgroundColor: getLevelColor(inputLevelL) }"
                                    />
                                </div>
                                <span class="text-[9px] font-mono text-muted-foreground w-6 text-right">{{ inputLevelL }}</span>
                            </div>
                            <div class="flex items-center gap-1">
                                <span class="text-[9px] text-muted-foreground w-2">R</span>
                                <div class="flex-1 h-1.5 rounded-full overflow-hidden bg-muted">
                                    <div 
                                        class="h-full transition-all duration-75"
                                        :style="{ width: `${inputLevelR}%`, backgroundColor: getLevelColor(inputLevelR) }"
                                    />
                                </div>
                                <span class="text-[9px] font-mono text-muted-foreground w-6 text-right">{{ inputLevelR }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Output Volume -->
                    <div>
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-xs text-muted-foreground flex items-center gap-1">
                                <Speaker :size="10" /> Output
                            </span>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-mono">{{ outputVolume }}%</span>
                                <button 
                                    @click="toggleOutputMute"
                                    :class="['w-6 h-6 rounded text-xs flex items-center justify-center', outputMuted ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400']"
                                >
                                    <VolumeX v-if="outputMuted" :size="12" />
                                    <Volume2 v-else :size="12" />
                                </button>
                            </div>
                        </div>
                        <input 
                            type="range" min="0" max="100" v-model.number="outputVolume"
                            @input="onOutputVolumeChange"
                            class="w-full h-1.5 mb-1"
                        />
                        <div class="h-2 rounded-full overflow-hidden bg-muted">
                            <div 
                                class="h-full transition-all duration-75"
                                :style="{ width: `${outputLevel}%`, backgroundColor: getLevelColor(outputLevel) }"
                            />
                        </div>
                    </div>

                    <!-- System Info -->
                    <div class="pt-2 border-t border-border text-xs font-mono space-y-1">
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Time</span>
                            <span class="text-foreground">{{ currentTime.toFixed(1) }}s</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Latency</span>
                            <span class="text-foreground">{{ (baseLatency * 1000).toFixed(1) }}ms</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Input Stream</span>
                            <span :class="virtualStreamActive ? 'text-green-400' : 'text-red-400'">
                                {{ virtualStreamActive ? '● Active' : '○ Inactive' }}
                            </span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Output Stream</span>
                            <span :class="virtualOutputActive ? 'text-green-400' : 'text-red-400'">
                                {{ virtualOutputActive ? '● Active' : '○ Inactive' }}
                            </span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted-foreground">Worklets</span>
                            <span class="text-foreground">{{ activeWorklets.length }}</span>
                        </div>
                    </div>
                </section>

                <!-- Column 3: Tests -->
                <section class="bg-card border border-border rounded-xl p-4 space-y-3">
                    <h3 class="text-sm font-medium text-foreground flex items-center gap-2">
                        <FlaskConical :size="14" class="text-muted-foreground" />
                        Tests
                    </h3>

                    <div class="grid grid-cols-2 gap-2">
                        <button @click="playTestSound" class="test-btn bg-blue-500/15 text-blue-400 hover:bg-blue-500/25">
                            <AudioWaveform :size="12" /> 440Hz
                        </button>
                        <button @click="playTestChord" class="test-btn bg-blue-500/15 text-blue-400 hover:bg-blue-500/25">
                            <Music :size="12" /> Chord
                        </button>
                        <button @click="testDTMF" class="test-btn bg-purple-500/15 text-purple-400 hover:bg-purple-500/25">
                            <Phone :size="12" /> DTMF
                        </button>
                        <button @click="testBusyTone" class="test-btn bg-orange-500/15 text-orange-400 hover:bg-orange-500/25">
                            <PhoneOff :size="12" /> Busy
                        </button>
                        <button 
                            @click="toggleInputMonitoring"
                            :class="['test-btn col-span-2', isMonitoring ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-green-500/15 text-green-400 hover:bg-green-500/25']"
                        >
                            <component :is="isMonitoring ? Square : Play" :size="12" />
                            {{ isMonitoring ? 'Stop Monitor' : 'Monitor Input' }}
                        </button>
                    </div>

                    <div class="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                        <button @click="createVirtualStream" class="test-btn-sm bg-muted/50 text-muted-foreground hover:text-foreground">
                            <Radio :size="10" /> Init Input
                        </button>
                        <button @click="createRawStream" class="test-btn-sm bg-muted/50 text-muted-foreground hover:text-foreground">
                            <Waves :size="10" /> Raw Stream
                        </button>
                    </div>

                    <div v-if="streamInfo" class="p-2 bg-background rounded text-[10px] font-mono text-muted-foreground">
                        {{ streamInfo }}
                    </div>

                    <button 
                        @click="testAllWithMute" 
                        class="w-full test-btn bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25"
                    >
                        <FlaskConical :size="12" /> Test Mute Behavior
                    </button>

                    <div v-if="muteTestResult" class="p-2 bg-background rounded text-[10px] font-mono text-muted-foreground whitespace-pre-wrap max-h-24 overflow-y-auto">
                        {{ muteTestResult }}
                    </div>
                </section>
            </div>

            <!-- Worklets List (if any) -->
            <section v-if="activeWorklets.length > 0" class="bg-card border border-border rounded-xl overflow-hidden">
                <div class="px-4 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
                    <Cpu :size="14" class="text-muted-foreground" />
                    <h3 class="text-sm font-medium text-foreground">Active Worklets</h3>
                </div>
                <div class="p-3 grid grid-cols-4 gap-2">
                    <div 
                        v-for="[id, name] in activeWorklets" 
                        :key="id"
                        class="px-3 py-2 bg-background rounded border border-border text-xs"
                    >
                        <div class="flex items-center gap-2">
                            <Cpu :size="12" class="text-pink-400" />
                            <span class="font-medium text-foreground truncate">{{ name }}</span>
                        </div>
                        <div class="text-[10px] text-muted-foreground mt-1 font-mono truncate">{{ id }}</div>
                    </div>
                </div>
            </section>

            <!-- Event Log - Full Width -->
            <section class="bg-card border border-border rounded-xl overflow-hidden">
                <div class="px-4 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <ScrollText :size="14" class="text-muted-foreground" />
                        <h3 class="text-sm font-medium text-foreground">Event Log</h3>
                    </div>
                    <button @click="clearEventLog" class="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                        <Trash2 :size="12" /> Clear
                    </button>
                </div>
                <div class="p-3 h-32 overflow-y-auto font-mono text-[11px]">
                    <div v-if="eventLog.length === 0" class="text-muted-foreground text-center py-4">
                        No events logged
                    </div>
                    <div v-for="(event, idx) in eventLog" :key="idx" class="flex gap-2 py-0.5">
                        <span class="text-muted-foreground shrink-0">{{ event.time }}</span>
                        <span class="text-blue-400 shrink-0 w-24 truncate">{{ event.type }}</span>
                        <span class="text-foreground truncate">{{ event.data }}</span>
                    </div>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { audio, playDTMF, playBusyTone } from '@/lib/audio/AudioManager'
import { logger } from '@argon/core'
import type { Disposable } from '@argon/core'
import { Subscription } from 'rxjs'
import AudioGraph, { type AudioNode as GraphNode, type AudioConnection } from './audio/AudioGraph.vue'
import {
    Activity,
    GitBranch,
    Mic,
    MicOff,
    Volume2,
    VolumeX,
    Speaker,
    Headphones,
    RefreshCw,
    FlaskConical,
    AudioWaveform,
    Music,
    Phone,
    PhoneOff,
    Play,
    Square,
    Radio,
    Waves,
    Cpu,
    ScrollText,
    Trash2,
    Send,
    Gauge
} from 'lucide-vue-next'

// Device state
const inputDevices = ref<MediaDeviceInfo[]>([])
const outputDevices = ref<MediaDeviceInfo[]>([])
const selectedInputDevice = ref<string>('')
const selectedOutputDevice = ref<string>('')
const currentInputDevice = computed(() => audio.getInputDevice().value)
const currentOutputDevice = computed(() => audio.getOutputDevice().value)
const totalDevices = computed(() => inputDevices.value.length + outputDevices.value.length)

// Volume state
const inputVolume = ref(100)
const outputVolume = ref(100)
const inputMuted = ref(false)
const outputMuted = ref(false)
const inputLevel = ref(0)
const inputLevelL = ref(0)
const inputLevelR = ref(0)
const outputLevel = ref(0)

// Audio constraints
const echoCancellation = ref(true)
const noiseSuppression = ref(true)
const autoGainControl = ref(true)

// System info
const audioContextState = ref<string>('suspended')
const sampleRate = ref(48000)
const channelCount = ref(2)
const currentTime = ref(0)
const baseLatency = ref(0)
const virtualStreamActive = ref(false)
const virtualOutputActive = ref(false)

// Worklets
const activeWorklets = ref<[string, string][]>([])

// Remote audio sources
const remoteAudioGraphs = ref<Map<string, { label: string; volume: number; speaking: boolean }>>(new Map())
const mediaElementsCount = ref(0)

// Test state
const isMonitoring = ref(false)
let monitoringDisposable: Disposable<void> | null = null
const muteTestResult = ref<string>('')
const streamInfo = ref<string>('')

// Stereo VU meter
let stereoVuMeterDisposable: Disposable<AudioWorkletNode> | null = null

// Event log
interface LogEvent { time: string; type: string; data: string }
const eventLog = ref<LogEvent[]>([])

// Subscriptions
const subscriptions: Subscription[] = []

// Audio Graph - Dynamic layout based on actual audio sources
const graphNodes = computed<GraphNode[]>(() => {
    const nodes: GraphNode[] = []
    const nodeW = 180
    const nodeH = 100
    const inputY = 80
    const outputY = 380
    
    // ============== INPUT CHAIN (Top) ==============
    // Microphone source
    nodes.push({
        id: 'mic', label: 'Microphone', type: 'source',
        x: 300, y: inputY, width: nodeW, height: nodeH,
        active: virtualStreamActive.value, level: inputLevel.value, showLevel: true,
        inputs: [], outputs: ['audio'], channels: channelCount.value
    })
    
    // Input gain
    nodes.push({
        id: 'inputGain', label: 'Input Gain', type: 'processor',
        x: 540, y: inputY, width: nodeW, height: nodeH,
        active: virtualStreamActive.value && !inputMuted.value, 
        level: inputMuted.value ? 0 : inputLevel.value, showLevel: true,
        inputs: ['audio'], outputs: ['audio'], channels: channelCount.value
    })
    
    // Virtual output (for outgoing stream)
    nodes.push({
        id: 'virtualDest', label: 'Virtual Output', type: 'destination',
        x: 780, y: inputY, width: nodeW, height: nodeH,
        active: virtualStreamActive.value, level: 0, showLevel: false,
        inputs: ['audio'], outputs: [], channels: channelCount.value
    })
    
    // Add worklet nodes on input chain
    let workletX = 820
    for (const [id, name] of activeWorklets.value) {
        const displayName = name.includes('stereo') || name.includes('mono') ? 'Stereo→Mono' :
                           name.includes('vu') || name.includes('meter') ? 'VU Meter' : 
                           name.substring(0, 12)
        
        nodes.push({
            id: `worklet-${id}`,
            label: displayName,
            type: 'worklet',
            x: workletX,
            y: inputY,
            width: nodeW,
            height: nodeH,
            active: true,
            level: inputLevel.value,
            showLevel: true,
            inputs: ['audio'],
            outputs: ['audio'],
            channels: channelCount.value,
            workletName: name
        })
        workletX += 240
    }
    
    // ============== AUDIO SOURCES (Left column, feeding into master) ==============
    const remoteEntries = Array.from(remoteAudioGraphs.value.entries())
    const hasRemotes = remoteEntries.length > 0
    const hasMedia = mediaElementsCount.value > 0
    const totalSources = remoteEntries.length + (hasMedia ? 1 : 0)
    
    // Calculate vertical positioning for sources
    const sourceNodeH = 70
    const sourceGap = 120
    const sourceSpacing = sourceNodeH + sourceGap
    const sourceStartY = outputY - Math.max(0, (totalSources - 1)) * (sourceSpacing / 2)
    let sourceIdx = 0
    
    // Remote audio graphs (LiveKit participants, etc.)
    for (const [id, info] of remoteEntries) {
        nodes.push({
            id: `remote-${id}`,
            label: info.label || 'Remote User',
            type: 'source',
            x: 100,
            y: sourceStartY + sourceIdx * sourceSpacing,
            width: nodeW,
            height: sourceNodeH,
            active: true,
            level: info.speaking ? 80 : 20,
            showLevel: true,
            inputs: [],
            outputs: ['audio'],
            channels: 2
        })
        sourceIdx++
    }
    
    // Media elements node
    if (hasMedia) {
        nodes.push({
            id: 'mediaElements',
            label: `Media Elements (${mediaElementsCount.value})`,
            type: 'source',
            x: 100,
            y: sourceStartY + sourceIdx * sourceSpacing,
            width: nodeW,
            height: sourceNodeH,
            active: true,
            level: 50,
            showLevel: false,
            inputs: [],
            outputs: ['audio'],
            channels: 2
        })
        sourceIdx++
    }
    
    // Placeholder if no sources
    if (!hasRemotes && !hasMedia) {
        nodes.push({
            id: 'noSources',
            label: 'No Audio Sources',
            type: 'source',
            x: 100,
            y: outputY,
            width: nodeW,
            height: nodeH,
            active: false,
            level: 0,
            showLevel: false,
            inputs: [],
            outputs: ['audio'],
            channels: 2
        })
    }
    
    // ============== OUTPUT CHAIN (Right side) ==============
    // Master gain node
    nodes.push({
        id: 'masterGain', label: 'Master Gain', type: 'processor',
        x: 340, y: outputY, width: nodeW, height: nodeH,
        active: virtualOutputActive.value && !outputMuted.value,
        level: outputMuted.value ? 0 : outputLevel.value, showLevel: true,
        inputs: ['audio'], outputs: ['audio'], channels: channelCount.value
    })
    
    // Output analyser
    nodes.push({
        id: 'outputAnalyser', label: 'Output Analyser', type: 'analyzer',
        x: 580, y: outputY, width: nodeW, height: nodeH,
        active: virtualOutputActive.value, level: outputLevel.value, showLevel: true,
        inputs: ['audio'], outputs: ['audio'], channels: channelCount.value
    })
    
    // Speakers destination
    nodes.push({
        id: 'speakers', label: 'Speakers', type: 'destination',
        x: 820, y: outputY, width: nodeW, height: nodeH,
        active: virtualOutputActive.value, level: outputLevel.value, showLevel: false,
        inputs: ['audio'], outputs: [], channels: channelCount.value
    })
    
    return nodes
})

const graphConnections = computed<AudioConnection[]>(() => {
    const conns: AudioConnection[] = []
    
    // Input chain connections
    conns.push(
        { id: 'mic-to-gain', from: 'mic', to: 'inputGain', fromPort: 0, toPort: 0, active: virtualStreamActive.value, level: inputLevel.value },
        { id: 'gain-to-dest', from: 'inputGain', to: 'virtualDest', fromPort: 0, toPort: 0, active: virtualStreamActive.value, level: inputMuted.value ? 0 : inputLevel.value },
    )
    
    // Connect worklets in chain on input
    const workletIds = activeWorklets.value.map(([id]) => `worklet-${id}`)
    if (workletIds.length > 0) {
        conns.push({
            id: 'dest-to-worklet',
            from: 'virtualDest',
            to: workletIds[0],
            fromPort: 0, toPort: 0,
            active: virtualStreamActive.value,
            level: inputLevel.value
        })
        
        for (let i = 0; i < workletIds.length - 1; i++) {
            conns.push({
                id: `worklet-chain-${i}`,
                from: workletIds[i],
                to: workletIds[i + 1],
                fromPort: 0, toPort: 0,
                active: true,
                level: inputLevel.value
            })
        }
    }
    
    // Output chain connections
    conns.push(
        { id: 'master-to-analyser', from: 'masterGain', to: 'outputAnalyser', fromPort: 0, toPort: 0, active: virtualOutputActive.value, level: outputMuted.value ? 0 : outputLevel.value },
        { id: 'analyser-to-speakers', from: 'outputAnalyser', to: 'speakers', fromPort: 0, toPort: 0, active: virtualOutputActive.value, level: outputMuted.value ? 0 : outputLevel.value },
    )
    
    // Connect audio sources to master gain
    const remoteEntries = Array.from(remoteAudioGraphs.value.entries())
    const hasRemotes = remoteEntries.length > 0
    const hasMedia = mediaElementsCount.value > 0
    
    for (const [id, info] of remoteEntries) {
        conns.push({
            id: `remote-${id}-to-master`,
            from: `remote-${id}`,
            to: 'masterGain',
            fromPort: 0, toPort: 0,
            active: true,
            level: info.speaking ? 70 : 10
        })
    }
    
    if (hasMedia) {
        conns.push({
            id: 'media-to-master',
            from: 'mediaElements',
            to: 'masterGain',
            fromPort: 0, toPort: 0,
            active: true,
            level: 30
        })
    }
    
    // Placeholder connection if no sources
    if (!hasRemotes && !hasMedia) {
        conns.push({
            id: 'no-source-to-master',
            from: 'noSources',
            to: 'masterGain',
            fromPort: 0, toPort: 0,
            active: false,
            level: 0
        })
    }
    
    return conns
})

function onGraphNodeClick(node: GraphNode) {
    logEvent('NodeClick', node.id)
}

// Initialize
onMounted(async () => {
    logger.info('[AudioDebugView] Mounted')
    
    inputVolume.value = audio.getInputVolume().value
    outputVolume.value = audio.getOutputVolume().value
    inputMuted.value = audio.isInputMuted().value
    outputMuted.value = audio.isOutputMuted().value
    
    const constraints = audio.getAudioConstraints()
    echoCancellation.value = constraints.echoCancellation
    noiseSuppression.value = constraints.noiseSuppression
    autoGainControl.value = constraints.autoGainControl
    
    selectedInputDevice.value = currentInputDevice.value
    selectedOutputDevice.value = currentOutputDevice.value
    
    subscriptions.push(
        audio.onInputDeviceChanged((deviceId) => { logEvent('InputDevice', deviceId); selectedInputDevice.value = deviceId }),
        audio.onOutputDeviceChanged((deviceId) => { logEvent('OutputDevice', deviceId); selectedOutputDevice.value = deviceId }),
        audio.onInputVolumeChanged((volume) => { logEvent('InputVol', `${volume}%`); inputVolume.value = volume }),
        audio.onOutputVolumeChanged((volume) => { logEvent('OutputVol', `${volume}%`); outputVolume.value = volume }),
        audio.onInputMutedChanged((muted) => { logEvent('InputMute', String(muted)); inputMuted.value = muted }),
        audio.onOutputMutedChanged((muted) => { logEvent('OutputMute', String(muted)); outputMuted.value = muted }),
        audio.onDevicesChanged(() => { logEvent('Devices', 'Changed'); refreshDevices() }),
        audio.onOutputLevelChanged((level) => { outputLevel.value = Math.round(level) }),
    )
    
    // Setup stereo VU meter for microphone input
    try {
        stereoVuMeterDisposable = await audio.createVirtualVUMeterStereo((left, right) => {
            inputLevelL.value = left
            inputLevelR.value = right
            inputLevel.value = Math.round((left + right) / 2) // Combined level
        })
        logEvent('StereoVU', 'Started')
    } catch (err) {
        logger.error('[AudioDebugView] Failed to create stereo VU meter:', err)
    }
    
    await refreshDevices()
    updateSystemInfo()
})

let systemInfoIntervalId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
    systemInfoIntervalId = setInterval(updateSystemInfo, 500)
})

onUnmounted(() => {
    logger.info('[AudioDebugView] Unmounting')
    if (systemInfoIntervalId) clearInterval(systemInfoIntervalId)
    subscriptions.forEach(sub => sub.unsubscribe())
    if (isMonitoring.value && monitoringDisposable) {
        monitoringDisposable.dispose()
        monitoringDisposable = null
    }
    if (stereoVuMeterDisposable) {
        stereoVuMeterDisposable.dispose()
        stereoVuMeterDisposable = null
    }
})

async function refreshDevices() {
    try {
        inputDevices.value = await audio.enumerateDevicesByKind('audioinput')
        outputDevices.value = await audio.enumerateDevicesByKind('audiooutput')
        logEvent('Devices', `${totalDevices.value} found`)
    } catch (err) {
        logger.error('[AudioDebugView] Failed to refresh devices:', err)
    }
}

async function onInputDeviceChange() {
    try { await audio.setInputDevice(selectedInputDevice.value) }
    catch { selectedInputDevice.value = currentInputDevice.value }
}

async function onOutputDeviceChange() {
    try { await audio.setOutputDevice(selectedOutputDevice.value) }
    catch { selectedOutputDevice.value = currentOutputDevice.value }
}

function onInputVolumeChange() { audio.setInputVolume(inputVolume.value) }
function onOutputVolumeChange() { audio.setOutputVolume(outputVolume.value) }
function toggleInputMute() { audio.toggleInputMute() }
function toggleOutputMute() { audio.toggleOutputMute() }

async function onConstraintsChange() {
    try {
        await audio.setAudioConstraints({
            echoCancellation: echoCancellation.value,
            noiseSuppression: noiseSuppression.value,
            autoGainControl: autoGainControl.value,
        })
        logEvent('Constraints', 'Updated')
    } catch (err) {
        logger.error('[AudioDebugView] Failed to update constraints:', err)
    }
}

async function playTestSound() {
    try { await audio.playTestSound(440, 0.5); logEvent('Test', '440Hz') }
    catch (err) { logger.error('[AudioDebugView] Test sound failed:', err) }
}

async function playTestChord() {
    try { await audio.playTestChord(); logEvent('Test', 'Chord') }
    catch (err) { logger.error('[AudioDebugView] Test chord failed:', err) }
}

async function toggleInputMonitoring() {
    if (isMonitoring.value) {
        monitoringDisposable?.dispose()
        monitoringDisposable = null
        isMonitoring.value = false
        logEvent('Monitor', 'Stopped')
    } else {
        try {
            monitoringDisposable = await audio.startInputMonitoring()
            isMonitoring.value = true
            logEvent('Monitor', 'Started')
        } catch (err) {
            logger.error('[AudioDebugView] Monitor failed:', err)
        }
    }
}

async function testDTMF() {
    try {
        for (const d of '147*2580369#') { await playDTMF(d as any); await new Promise(r => setTimeout(r, 120)) }
        logEvent('DTMF', 'Done')
    } catch (err) { logger.error('[AudioDebugView] DTMF failed:', err) }
}

async function testBusyTone() {
    try { logEvent('Busy', 'Start'); await playBusyTone(3); logEvent('Busy', 'Done') }
    catch (err) { logger.error('[AudioDebugView] Busy tone failed:', err) }
}

async function testAllWithMute() {
    const r: string[] = ['=== Mute Test ===']
    const was = outputMuted.value
    
    if (was) audio.setOutputMuted(false)
    await new Promise(x => setTimeout(x, 100))
    r.push('▶ UNMUTED: playing...')
    await audio.playTestSound(880, 0.3)
    await new Promise(x => setTimeout(x, 400))
    await playDTMF('5')
    await new Promise(x => setTimeout(x, 300))
    r.push('✓ Should hear sounds')
    
    audio.setOutputMuted(true)
    await new Promise(x => setTimeout(x, 100))
    r.push('■ MUTED: playing...')
    await audio.playTestSound(880, 0.3)
    await new Promise(x => setTimeout(x, 400))
    await playDTMF('5')
    await new Promise(x => setTimeout(x, 300))
    r.push('✓ Should NOT hear')
    
    audio.setOutputMuted(was)
    r.push('=== Done ===')
    muteTestResult.value = r.join('\n')
}

function updateSystemInfo() {
    const ctx = audio.getCurrentAudioContext()
    audioContextState.value = ctx.state
    sampleRate.value = ctx.sampleRate
    channelCount.value = ctx.destination.channelCount
    currentTime.value = ctx.currentTime
    baseLatency.value = ctx.baseLatency || 0
    virtualStreamActive.value = audio.isVirtualStreamInitialized()
    virtualOutputActive.value = audio.isVirtualOutputInitialized()
    
    // Get active worklets
    const worklets = audio.getActiveWorklets()
    activeWorklets.value = Array.from(worklets.entries()).map(([id, node]) => [id, (node as any).name || id])
    
    // Get remote audio graphs
    remoteAudioGraphs.value = audio.getRemoteAudioGraphs()
    
    // Get media elements count
    mediaElementsCount.value = audio.getMediaElements().size
}

async function createVirtualStream() {
    try {
        const s = await audio.getVirtualInputStream()
        streamInfo.value = `Virtual: ${s.getTracks().length} tracks, ${s.getAudioTracks()[0]?.getSettings().channelCount || 1}ch`
        logEvent('Stream', 'Virtual OK')
    } catch (e) { streamInfo.value = `Error: ${e}` }
}

async function createRawStream() {
    try {
        const s = await audio.createRawInputMediaStream()
        streamInfo.value = `Raw: ${s.getTracks().length} tracks, ${s.getAudioTracks()[0]?.getSettings().channelCount || 1}ch`
        logEvent('Stream', 'Raw OK')
    } catch (e) { streamInfo.value = `Error: ${e}` }
}

function logEvent(type: string, data: string) {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    eventLog.value.unshift({ time, type, data })
    if (eventLog.value.length > 50) eventLog.value.length = 50
}

function clearEventLog() { eventLog.value = [] }

function getLevelColor(level: number): string {
    if (level < 25) return '#22c55e'
    if (level < 50) return '#3b82f6'
    if (level < 75) return '#eab308'
    return '#ef4444'
}
</script>

<style scoped>
.test-btn {
    padding: 0.5rem;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 500;
    transition: background-color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
}

.test-btn-sm {
    padding: 0.375rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.65rem;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
}

.test-btn-sm:hover {
    opacity: 0.8;
}

input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: hsl(var(--muted));
}

input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: hsl(var(--primary));
    cursor: pointer;
}

input[type="checkbox"] {
    accent-color: hsl(var(--primary));
}

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
