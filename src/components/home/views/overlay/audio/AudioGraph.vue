<template>
    <div class="audio-graph w-full h-full relative" style="min-height: 200px;">
        <VueFlow
            :nodes="flowNodes"
            :edges="flowEdges"
            :default-viewport="{ x: 0, y: 0, zoom: 1 }"
            :nodes-draggable="true"
            :nodes-connectable="false"
            :elements-selectable="false"
            :pan-on-drag="true"
            :zoom-on-scroll="true"
            :zoom-on-pinch="true"
            :zoom-on-double-click="false"
            :prevent-scrolling="true"
            :fit-view-on-init="true"
            :min-zoom="0.5"
            :max-zoom="2"
            class="vue-flow-audio"
        >
            <template #node-audioNode="nodeProps">
                <AudioNodeBox 
                    :node="nodeProps.data.original" 
                    @click="$emit('nodeClick', nodeProps.data.original)"
                />
            </template>
            
            <template #edge-animatedBeam="edgeProps">
                <AnimatedBeamEdge v-bind="edgeProps" />
            </template>
            
            <Background :gap="20" :size="1" pattern-color="#374151" />
            
            <Panel position="bottom-left" class="!m-2">
                <div class="flex gap-4 text-[10px] text-muted-foreground bg-card/90 backdrop-blur-sm px-2 py-1 rounded border border-border">
                    <span class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-sm bg-green-500"></span>
                        Active
                    </span>
                    <span class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-sm bg-emerald-500"></span>
                        In
                    </span>
                    <span class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-sm bg-amber-500"></span>
                        Out
                    </span>
                    <span class="flex items-center gap-1.5">
                        <span class="w-3 h-0.5 rounded bg-blue-500"></span>
                        Signal
                    </span>
                </div>
            </Panel>
            
            <Panel position="bottom-right" class="!m-2">
                <div class="text-[10px] text-muted-foreground bg-card/90 backdrop-blur-sm px-2 py-1 rounded border border-border font-mono">
                    {{ channelCount }}ch @ {{ sampleRate }}Hz
                </div>
            </Panel>
        </VueFlow>
    </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { VueFlow, Panel, Position, type Node, type Edge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import AnimatedBeamEdge from './AnimatedBeamEdge.vue'
import AudioNodeBox from './AudioNodeBox.vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

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

export interface AudioConnection {
    id: string
    from: string
    to: string
    fromPort: number
    toPort: number
    active: boolean
    level: number
    label?: string
}

const props = withDefaults(defineProps<{
    nodes: AudioNode[]
    connections: AudioConnection[]
    inputLevel?: number
    outputLevel?: number
    channelCount?: number
    sampleRate?: number
}>(), {
    inputLevel: 0,
    outputLevel: 0,
    channelCount: 2,
    sampleRate: 48000
})

defineEmits<{
    nodeClick: [node: AudioNode]
}>()

// Convert nodes to VueFlow format
const flowNodes = computed<Node[]>(() => {
    return props.nodes.map(node => ({
        id: node.id,
        type: 'audioNode',
        position: { x: node.x - node.width / 2, y: node.y - node.height / 2 },
        data: {
            original: node,
            label: node.label
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        selectable: false,
        connectable: false,
    }))
})

// Convert connections to VueFlow edges with AnimatedBeam
const flowEdges = computed<Edge[]>(() => {
    return props.connections.map(conn => ({
        id: conn.id,
        source: conn.from,
        target: conn.to,
        type: 'animatedBeam',
        data: {
            active: conn.active,
            level: conn.level,
            label: conn.label,
            gradientStartColor: '#3b82f6',
            gradientStopColor: '#60a5fa',
            pathColor: '#6b7280',
            pathOpacity: conn.active ? 0.4 : 0.2,
            duration: 1.5,
            beamCount: 5,
        },
        selectable: true,
        focusable: false,
        deletable: false,
        updatable: false,
    }))
})
</script>

<style>
.audio-graph {
    background: linear-gradient(180deg, rgba(17, 24, 39, 0.8) 0%, rgba(17, 24, 39, 0.95) 100%);
}

.vue-flow-audio {
    --vf-node-bg: transparent;
    --vf-node-text: #e5e7eb;
    --vf-connection-path: #6b7280;
    --vf-handle: #374151;
}

.vue-flow-audio .vue-flow__node {
    padding: 0;
    border-radius: 6px;
    background: transparent;
    border: none;
}

.vue-flow-audio .vue-flow__node.selected,
.vue-flow-audio .vue-flow__node:focus,
.vue-flow-audio .vue-flow__node:focus-visible {
    box-shadow: none;
    outline: none;
}

.vue-flow-audio .vue-flow__handle {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    border: 1px solid #1f2937;
}

.vue-flow-audio .vue-flow__handle-left {
    background: #10b981;
}

.vue-flow-audio .vue-flow__handle-right {
    background: #f59e0b;
}

.vue-flow-audio .vue-flow__background {
    background: transparent;
}

.vue-flow-audio .vue-flow__controls {
    display: none;
}

.vue-flow-audio .vue-flow__minimap {
    display: none;
}
</style>
