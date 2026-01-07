<template>
    <div v-if="isOpen" class="ping-popup" @click.stop>
        <div class="ping-graph">
            <svg viewBox="0 0 300 70" preserveAspectRatio="none">
                <!-- Vertical grid lines for each minute -->
                <g v-for="(mark, idx) in timeMarks" :key="'mark-' + idx">
                    <line 
                        :x1="mark.x" 
                        :y1="0" 
                        :x2="mark.x" 
                        :y2="60" 
                        stroke="currentColor" 
                        stroke-opacity="0.1" 
                        stroke-width="0.5"
                        vector-effect="non-scaling-stroke"
                    />
                    <text 
                        :x="mark.x" 
                        y="68" 
                        font-size="6" 
                        fill="currentColor" 
                        fill-opacity="0.6" 
                        text-anchor="middle"
                    >
                        {{ mark.label }}
                    </text>
                </g>
                
                <polyline
                    v-if="pingGraphPoints"
                    :points="pingGraphPoints"
                    fill="none"
                    :stroke="pingGraphColor"
                    stroke-width="2"
                    vector-effect="non-scaling-stroke"
                />
                <polygon
                    v-if="pingGraphArea"
                    :points="pingGraphArea"
                    :fill="pingGraphColor"
                    fill-opacity="0.2"
                />
            </svg>
        </div>
        <div class="ping-stats">
            <div class="ping-stat-item">
                <span class="ping-stat-label">Current:</span>
                <span class="ping-stat-value" :class="pingStatClass">{{ currentPing >= 0 ? currentPing + ' ms' : 'N/A' }}</span>
            </div>
            <div class="ping-stat-item">
                <span class="ping-stat-label">Average:</span>
                <span class="ping-stat-value">{{ averagePing >= 0 ? averagePing + ' ms' : 'N/A' }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
    isOpen: boolean;
    currentPing: number;
    averagePing: number;
    pingHistory: Array<{ timestamp: number; value: number }>;
    qualityConnection: "NONE" | "GREEN" | "ORANGE" | "RED";
}

const props = defineProps<Props>();

// Ping graph computations
const pingGraphPoints = computed(() => {
    const history = props.pingHistory;
    if (!history || history.length === 0) return "";
    
    const now = Date.now();
    const tenMinutesAgo = now - (10 * 60 * 1000);
    const maxPing = Math.max(...history.map(h => h.value), 100);
    const minPing = 0;
    
    // Map points to fixed timeline (0-300 SVG width = 10 minutes)
    const points = history.map((item) => {
        const timeOffset = item.timestamp - tenMinutesAgo;
        const x = (timeOffset / (10 * 60 * 1000)) * 300;
        const normalizedPing = ((item.value - minPing) / (maxPing - minPing));
        const y = 60 - (normalizedPing * 60);
        return `${x},${y}`;
    }).filter(point => {
        const x = parseFloat(point.split(',')[0]);
        return x >= 0 && x <= 300;
    });
    
    return points.join(" ");
});

const pingGraphArea = computed(() => {
    const points = pingGraphPoints.value;
    if (!points) return "";
    return points + " 300,60 0,60";
});

const pingGraphColor = computed(() => {
    switch (props.qualityConnection) {
        case "GREEN": return "rgb(34, 197, 94)";
        case "ORANGE": return "rgb(249, 115, 22)";
        case "RED": return "rgb(239, 68, 68)";
        default: return "rgb(156, 163, 175)";
    }
});

const pingStatClass = computed(() => {
    return {
        'text-green-500': props.qualityConnection === 'GREEN',
        'text-orange-500': props.qualityConnection === 'ORANGE',
        'text-red-500': props.qualityConnection === 'RED',
    };
});

const timeMarks = computed(() => {
    const marks: Array<{ x: number; label: string }> = [];
    const now = Date.now();
    
    // Create marks every minute from 10 minutes ago to now
    for (let i = 0; i <= 10; i++) {
        const timeAgo = now - ((10 - i) * 60 * 1000);
        const x = (i / 10) * 300; // Fixed position on timeline
        
        const date = new Date(timeAgo);
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        
        marks.push({ x, label: `${hh}:${mm}` });
    }
    
    return marks;
});
</script>

<style scoped>
.ping-popup {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 8px;
    width: 320px;
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 50;
}

.ping-graph {
    width: 100%;
    height: 80px;
    margin-bottom: 8px;
}

.ping-graph svg {
    width: 100%;
    height: 100%;
}

.ping-stats {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.ping-stat-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
}

.ping-stat-label {
    color: hsl(var(--muted-foreground));
}

.ping-stat-value {
    font-weight: 600;
    color: hsl(var(--foreground));
}
</style>
