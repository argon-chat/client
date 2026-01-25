<script setup lang="ts">
import { computed } from 'vue'
import { getSmoothStepPath, type EdgeProps } from '@vue-flow/core'

interface BeamData {
    active?: boolean
    level?: number
    label?: string
    gradientStartColor?: string
    gradientStopColor?: string
    duration?: number
    pathColor?: string
    pathOpacity?: number
    beamCount?: number
}

const props = defineProps<EdgeProps<BeamData>>()

const id = `beam-${props.id}`

// Get smoothstep path
const pathData = computed(() => {
    const [path, labelX, labelY] = getSmoothStepPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        sourcePosition: props.sourcePosition,
        targetX: props.targetX,
        targetY: props.targetY,
        targetPosition: props.targetPosition,
        borderRadius: 8,
    })
    return { path, labelX, labelY }
})

// Check direction for animation
const isVertical = computed(() => {
    return Math.abs(props.targetY - props.sourceY) > Math.abs(props.targetX - props.sourceX)
})

const isRightToLeft = computed(() => props.targetX < props.sourceX)
const isBottomToTop = computed(() => props.targetY < props.sourceY)

// Animation values
const x1 = computed(() => isRightToLeft.value ? '90%; -10%;' : '10%; 110%;')
const x2 = computed(() => isRightToLeft.value ? '100%; 0%;' : '0%; 100%;')
const y1 = computed(() => isBottomToTop.value ? '90%; -10%;' : '10%; 110%;')
const y2 = computed(() => isBottomToTop.value ? '100%; 0%;' : '0%; 100%;')

// Props with defaults
const isActive = computed(() => props.data?.active && (props.data?.level ?? 0) > 3)
const duration = computed(() => props.data?.duration ?? 2)
const gradientStartColor = computed(() => props.data?.gradientStartColor ?? '#3b82f6')
const gradientStopColor = computed(() => props.data?.gradientStopColor ?? '#60a5fa')
const pathColor = computed(() => props.data?.pathColor ?? '#6b7280')
const pathOpacity = computed(() => props.data?.pathOpacity ?? 0.3)
const strokeWidth = computed(() => isActive.value ? 2 : 1.5)
const beamCount = computed(() => props.data?.beamCount ?? 3)

// Generate beam delays
const beams = computed(() => {
    const count = beamCount.value
    const dur = duration.value
    return Array.from({ length: count }, (_, i) => ({
        id: `${id}-${i}`,
        delay: (dur / count) * i
    }))
})
</script>

<template>
    <g>
        <!-- Base path (background) -->
        <path
            :d="pathData.path"
            :stroke="pathColor"
            :stroke-width="strokeWidth"
            :stroke-opacity="pathOpacity"
            stroke-linecap="round"
            fill="none"
        />
        
        <!-- Multiple animated gradient paths (only when active) -->
        <template v-if="isActive">
            <path
                v-for="beam in beams"
                :key="beam.id"
                :d="pathData.path"
                :stroke="`url(#${beam.id})`"
                :stroke-width="strokeWidth"
                stroke-opacity="1"
                stroke-linecap="round"
                fill="none"
            />
        </template>
        
        <!-- Gradient definitions for each beam -->
        <defs v-if="isActive">
            <linearGradient
                v-for="beam in beams"
                :key="beam.id"
                :id="beam.id"
                gradientUnits="userSpaceOnUse"
                x1="0%"
                x2="0%"
                y1="0%"
                y2="0%"
            >
                <stop :stop-color="gradientStartColor" stop-opacity="0" />
                <stop :stop-color="gradientStartColor" />
                <stop offset="32.5%" :stop-color="gradientStopColor" />
                <stop offset="100%" :stop-color="gradientStopColor" stop-opacity="0" />
                
                <!-- Horizontal animation -->
                <animate
                    v-if="!isVertical"
                    attributeName="x1"
                    :values="x1"
                    :dur="`${duration}s`"
                    :begin="`${beam.delay}s`"
                    keyTimes="0; 1"
                    keySplines="0.16 1 0.3 1"
                    calcMode="spline"
                    repeatCount="indefinite"
                />
                <animate
                    v-if="!isVertical"
                    attributeName="x2"
                    :values="x2"
                    :dur="`${duration}s`"
                    :begin="`${beam.delay}s`"
                    keyTimes="0; 1"
                    keySplines="0.16 1 0.3 1"
                    calcMode="spline"
                    repeatCount="indefinite"
                />
                
                <!-- Vertical animation -->
                <animate
                    v-if="isVertical"
                    attributeName="y1"
                    :values="y1"
                    :dur="`${duration}s`"
                    :begin="`${beam.delay}s`"
                    keyTimes="0; 1"
                    keySplines="0.16 1 0.3 1"
                    calcMode="spline"
                    repeatCount="indefinite"
                />
                <animate
                    v-if="isVertical"
                    attributeName="y2"
                    :values="y2"
                    :dur="`${duration}s`"
                    :begin="`${beam.delay}s`"
                    keyTimes="0; 1"
                    keySplines="0.16 1 0.3 1"
                    calcMode="spline"
                    repeatCount="indefinite"
                />
            </linearGradient>
        </defs>
    </g>
</template>
