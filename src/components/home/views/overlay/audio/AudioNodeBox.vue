<template>
    <div class="audio-node group relative" :style="{ width: `${node.width}px` }">
        <!-- VueFlow Handles for edge connections -->
        <Handle v-if="hasInputs" type="target" :position="Position.Left" class="!w-4 !h-4 !bg-transparent !border-0" />
        <Handle v-if="hasOutputs" type="source" :position="Position.Right"
            class="!w-4 !h-4 !bg-transparent !border-0" />

        <!-- Left handle visual (input) -->
        <div v-if="hasInputs" class="absolute -left-2 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
            <div class="w-4 h-4 rounded-sm border-2 rotate-45 transition-all" :class="node.active
                ? 'bg-cyan-500 border-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.8),inset_0_0_4px_rgba(255,255,255,0.4)]'
                : 'bg-gray-700 border-gray-500'" />
        </div>

        <!-- Right handle visual (output) -->
        <div v-if="hasOutputs" class="absolute -right-2 top-1/2 -translate-y-1/2 z-10 pointer-events-none">
            <div class="w-4 h-4 rounded-sm border-2 rotate-45 transition-all" :class="node.active
                ? 'bg-orange-500 border-orange-300 shadow-[0_0_12px_rgba(249,115,22,0.8),inset_0_0_4px_rgba(255,255,255,0.4)]'
                : 'bg-gray-700 border-gray-500'" />
        </div>

        <!-- Main card -->
        <div class="relative overflow-hidden transition-all duration-300 cursor-pointer border" :class="[
            node.active
                ? 'bg-gray-900/95 border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]'
                : 'bg-gray-900/80 border-gray-700/50',
            'hover:border-cyan-400/70 hover:shadow-[0_0_30px_rgba(6,182,212,0.4)]'
        ]"
            style="clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));">
            <!-- Corner cuts decoration -->
            <div class="absolute top-0 right-0 w-3 h-3 bg-cyan-500/20 border-l border-b border-cyan-500/40"
                style="clip-path: polygon(100% 0, 0 100%, 100% 100%);" />
            <div class="absolute bottom-0 left-0 w-3 h-3 bg-cyan-500/20 border-r border-t border-cyan-500/40"
                style="clip-path: polygon(0 0, 0 100%, 100% 100%);" />

            <!-- Glow effect when active -->
            <div v-if="node.active && node.level > 0"
                class="absolute inset-0 opacity-25 transition-opacity pointer-events-none"
                :style="{ background: `radial-gradient(ellipse at center, ${accentColor} 0%, transparent 70%)` }" />

            <!-- Header bar -->
            <div class="relative px-3 py-2 border-b flex items-center gap-2"
                :class="node.active ? 'border-cyan-500/30 bg-cyan-950/30' : 'border-gray-700/50 bg-gray-800/30'">
                <!-- Type badge -->
                <div class="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded" :style="{
                    background: accentColor + '25',
                    color: accentColor,
                    textShadow: `0 0 10px ${accentColor}`
                }">
                    {{ typeLabel }}
                </div>

                <div class="flex-1" />

                <!-- Status indicator -->
                <div class="flex items-center gap-1.5">
                    <div class="w-2 h-2 rounded-full transition-all" :class="node.active
                        ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,1),0_0_16px_rgba(74,222,128,0.6)]'
                        : 'bg-gray-600'" />
                    <span class="text-[10px] font-mono" :class="node.active ? 'text-green-400' : 'text-gray-500'">
                        {{ node.active ? 'ACTIVE' : 'IDLE' }}
                    </span>
                </div>
            </div>

            <!-- Content -->
            <div class="relative p-4 flex items-center gap-4">
                <!-- Icon container -->
                <div class="shrink-0 w-12 h-12 rounded-lg flex items-center justify-center border transition-all relative overflow-hidden"
                    :class="node.active
                        ? 'border-cyan-500/50 bg-gradient-to-br from-gray-800 to-gray-900'
                        : 'border-gray-700/50 bg-gray-800/50'">
                    <!-- Icon glow -->
                    <div v-if="node.active" class="absolute inset-0 opacity-40"
                        :style="{ background: `radial-gradient(circle, ${accentColor}40 0%, transparent 70%)` }" />
                    <component :is="iconComponent" :size="24" :stroke-width="1.5" class="relative z-10 transition-all"
                        :style="{
                            color: node.active ? accentColor : '#6b7280',
                            filter: node.active ? `drop-shadow(0 0 8px ${accentColor})` : 'none'
                        }" />
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold truncate leading-tight tracking-wide"
                        :class="node.active ? 'text-gray-100' : 'text-gray-400'"
                        :style="node.active ? { textShadow: '0 0 20px rgba(255,255,255,0.3)' } : {}">
                        {{ node.label }}
                    </div>
                    <div class="text-[11px] text-gray-500 font-mono mt-1">
                        ID: {{ node.id.substring(0, 16) }}{{ node.id.length > 16 ? '...' : '' }}
                    </div>

                    <!-- Channel info -->
                    <div v-if="node.channels" class="flex items-center gap-2 mt-2">
                        <div class="flex items-center gap-1">
                            <div v-for="ch in node.channels" :key="ch" class="w-1.5 h-3 rounded-sm transition-all"
                                :class="node.level > 0 ? 'bg-cyan-400 shadow-[0_0_4px_rgba(34,211,238,0.8)]' : 'bg-gray-700'" />
                        </div>
                        <span class="text-[10px] text-gray-500 font-mono">{{ node.channels }}CH</span>
                    </div>
                </div>
            </div>

            <!-- VU meter bar -->
            <div v-if="node.showLevel" class="relative h-2 bg-gray-950 border-t border-gray-800">
                <!-- Grid lines -->
                <div class="absolute inset-0 flex">
                    <div v-for="i in 20" :key="i" class="flex-1 border-r border-gray-800/50" />
                </div>
                <!-- Level bar -->
                <div class="absolute inset-y-0 left-0 transition-all duration-75 ease-out" :style="{
                    width: `${node.level}%`,
                    background: `linear-gradient(90deg, ${levelColor} 0%, ${levelColorBright} 50%, ${levelColor} 100%)`,
                    boxShadow: `0 0 10px ${levelColor}, inset 0 1px 0 rgba(255,255,255,0.3)`
                }" />
                <!-- Level text -->
                <div class="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-mono font-bold"
                    :style="{ color: levelColor }">
                    {{ Math.round(node.level) }}%
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import {
    Mic,
    Volume2,
    Speaker,
    Music,
    Activity,
    Waves,
    CircuitBoard,
    Radio,
    AudioLines,
    Gauge,
    Send,
    Cpu,
    Users,
    Film,
    Zap
} from 'lucide-vue-next'

export interface AudioNode {
    id: string
    label: string
    type: 'source' | 'processor' | 'destination' | 'analyzer' | 'worklet'
    x: number
    y: number
    width: number
    height: number
    active: boolean
    level: number
    showLevel: boolean
    inputs: string[]
    outputs: string[]
    channels?: number
    workletName?: string
}

const props = defineProps<{
    node: AudioNode
}>()

// Accent colors by type (cyberpunk palette)
const accentColors: Record<string, string> = {
    source: '#06b6d4',      // cyan
    processor: '#a855f7',   // purple
    destination: '#22c55e', // green
    analyzer: '#f59e0b',    // amber
    worklet: '#ec4899',     // pink
}

// Icon mapping
const nodeIcons: Record<string, Component> = {
    mic: Mic,
    microphone: Mic,
    input: Mic,
    inputGain: Gauge,
    gain: Gauge,
    volume: Volume2,
    masterGain: Volume2,
    master: Volume2,
    speakers: Speaker,
    speaker: Speaker,
    output: Speaker,
    destination: Speaker,
    audioSource: Music,
    source: Music,
    music: Music,
    analyser: Activity,
    analyzer: Activity,
    outputAnalyser: Activity,
    virtualDest: Send,
    virtual: Radio,
    worklet: Cpu,
    processor: CircuitBoard,
    stereoToMono: AudioLines,
    vuMeter: Waves,
    noSources: Zap,
    mediaElements: Film,
    default: CircuitBoard
}

const typeLabels: Record<string, string> = {
    source: 'SRC',
    processor: 'PROC',
    destination: 'OUT',
    analyzer: 'ANLZ',
    worklet: 'WKLT'
}

const hasInputs = computed(() => props.node.inputs.length > 0)
const hasOutputs = computed(() => props.node.outputs.length > 0)

const iconComponent = computed<Component>(() => {
    const node = props.node
    if (node.id.startsWith('remote-')) return Users
    if (node.id === 'mediaElements') return Film
    if (node.id === 'noSources') return Zap
    if (node.workletName) {
        if (node.workletName.includes('mono') || node.workletName.includes('stereo')) return AudioLines
        if (node.workletName.includes('vu') || node.workletName.includes('meter')) return Waves
        return Cpu
    }
    return nodeIcons[node.id] || nodeIcons[node.type] || nodeIcons.default
})

const accentColor = computed(() => {
    if (props.node.id.startsWith('remote-')) return '#06b6d4'
    if (props.node.id === 'noSources') return '#6b7280'
    return accentColors[props.node.type] || accentColors.processor
})

const typeLabel = computed(() => {
    if (props.node.id.startsWith('remote-')) return 'RMT'
    if (props.node.id === 'mediaElements') return 'MDA'
    if (props.node.id === 'noSources') return 'IDLE'
    return typeLabels[props.node.type] || props.node.type.toUpperCase().substring(0, 4)
})

const levelColor = computed(() => {
    const level = props.node.level
    if (level < 30) return '#22c55e'
    if (level < 70) return '#eab308'
    return '#ef4444'
})

const levelColorBright = computed(() => {
    const level = props.node.level
    if (level < 30) return '#4ade80'
    if (level < 70) return '#fde047'
    return '#f87171'
})
</script>

<style scoped>
@keyframes scan {
    0% {
        transform: translateY(-100%);
    }

    100% {
        transform: translateY(200%);
    }
}

.animate-scan {
    animation: scan 2s linear infinite;
}
</style>
