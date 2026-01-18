<template>
    <div class="p-3 border-t border-border space-y-2">
        <h3 class="text-xs font-medium text-foreground">Controls</h3>
        
        <!-- Canvas Size Mode -->
        <div class="space-y-1">
            <label class="text-[10px] text-muted-foreground">Canvas Size</label>
            <select 
                :value="canvasSizeMode"
                @change="$emit('update:canvasSizeMode', ($event.target as HTMLSelectElement).value)"
                :disabled="disabled"
                class="w-full px-2 py-1 rounded-md text-[10px] bg-zinc-800 border border-zinc-600 text-foreground disabled:opacity-50"
            >
                <option value="container">Container (debug)</option>
                <option value="screen">Screen ({{ screenSize }})</option>
                <option value="window">Window ({{ windowSize }})</option>
                <option value="1920x1080">1920×1080 (Full HD)</option>
                <option value="2560x1440">2560×1440 (2K)</option>
                <option value="3840x2160">3840×2160 (4K)</option>
                <option value="custom">Custom...</option>
            </select>
            
            <div v-if="canvasSizeMode === 'custom'" class="flex gap-1 mt-1">
                <input 
                    :value="customWidth"
                    @input="$emit('update:customWidth', Number(($event.target as HTMLInputElement).value))"
                    type="number" 
                    placeholder="W"
                    class="flex-1 px-1.5 py-0.5 rounded-md text-[10px] bg-zinc-800 border border-zinc-600 text-foreground"
                />
                <span class="text-muted-foreground text-[10px]">×</span>
                <input 
                    :value="customHeight"
                    @input="$emit('update:customHeight', Number(($event.target as HTMLInputElement).value))"
                    type="number" 
                    placeholder="H"
                    class="flex-1 px-1.5 py-0.5 rounded-md text-[10px] bg-zinc-800 border border-zinc-600 text-foreground"
                />
            </div>
            
            <p class="text-[10px] text-muted-foreground">
                Current: {{ currentCanvasSize }}
            </p>
        </div>
        
        <!-- Widget Anchor -->
        <div class="space-y-1">
            <label class="text-[10px] text-muted-foreground">Widget Anchor</label>
            <div class="grid grid-cols-3 gap-1">
                <button 
                    v-for="anchor in anchors" 
                    :key="anchor.value"
                    @click="$emit('update:widgetAnchor', anchor.value)"
                    class="px-1.5 py-1 rounded text-[9px] transition-colors"
                    :class="widgetAnchor === anchor.value 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-zinc-800 text-muted-foreground hover:bg-zinc-700'"
                >
                    {{ anchor.label }}
                </button>
            </div>
        </div>
        
        <!-- Global Opacity -->
        <div class="space-y-1">
            <div class="flex items-center justify-between">
                <label class="text-[10px] text-muted-foreground">Global Opacity</label>
                <span class="text-[10px] text-foreground font-mono">{{ Math.round(globalOpacity * 100) }}%</span>
            </div>
            <input 
                type="range"
                min="0"
                max="100"
                :value="globalOpacity * 100"
                @input="$emit('update:globalOpacity', Number(($event.target as HTMLInputElement).value) / 100)"
                class="w-full h-1.5 rounded-full appearance-none bg-zinc-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
        </div>
        
        <!-- Screen Padding -->
        <div class="space-y-1">
            <div class="flex items-center justify-between">
                <label class="text-[10px] text-muted-foreground">Screen Padding</label>
                <span class="text-[10px] text-foreground font-mono">{{ screenPadding }}px</span>
            </div>
            <input 
                type="range"
                min="0"
                max="200"
                :value="screenPadding"
                @input="$emit('update:screenPadding', Number(($event.target as HTMLInputElement).value))"
                class="w-full h-1.5 rounded-full appearance-none bg-zinc-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
        </div>
        
        <!-- Widget Padding -->
        <div class="space-y-1">
            <div class="flex items-center justify-between">
                <label class="text-[10px] text-muted-foreground">Widget Padding</label>
                <span class="text-[10px] text-foreground font-mono">{{ widgetPadding }}px</span>
            </div>
            <input 
                type="range"
                min="0"
                max="50"
                :value="widgetPadding"
                @input="$emit('update:widgetPadding', Number(($event.target as HTMLInputElement).value))"
                class="w-full h-1.5 rounded-full appearance-none bg-zinc-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
        </div>
        
        <!-- Member Spacing -->
        <div class="space-y-1">
            <div class="flex items-center justify-between">
                <label class="text-[10px] text-muted-foreground">Member Spacing</label>
                <span class="text-[10px] text-foreground font-mono">{{ memberSpacing }}px</span>
            </div>
            <input 
                type="range"
                min="0"
                max="20"
                :value="memberSpacing"
                @input="$emit('update:memberSpacing', Number(($event.target as HTMLInputElement).value))"
                class="w-full h-1.5 rounded-full appearance-none bg-zinc-700 cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
            />
        </div>
        
        <!-- Widget Display Options -->
        <div class="space-y-1.5">
            <label class="text-[10px] text-muted-foreground">Display Options</label>
            
            <label class="flex items-center gap-2 text-[10px] text-foreground cursor-pointer">
                <input 
                    type="checkbox"
                    :checked="showWidgetBackground"
                    @change="$emit('update:showWidgetBackground', ($event.target as HTMLInputElement).checked)"
                    class="w-3 h-3 rounded border-zinc-600 bg-zinc-800 text-primary focus:ring-primary focus:ring-offset-0"
                />
                <span>Widget Background</span>
            </label>
            
            <label class="flex items-center gap-2 text-[10px] text-foreground cursor-pointer">
                <input 
                    type="checkbox"
                    :checked="showMemberCards"
                    @change="$emit('update:showMemberCards', ($event.target as HTMLInputElement).checked)"
                    class="w-3 h-3 rounded border-zinc-600 bg-zinc-800 text-primary focus:ring-primary focus:ring-offset-0"
                />
                <span>Member Cards</span>
            </label>
        </div>
        
        <div class="flex gap-1.5">
            <button 
                @click="$emit('addTestMember')"
                class="flex-1 px-2 py-1 rounded-md text-[10px] bg-zinc-700 hover:bg-zinc-600 text-foreground"
            >
                Add Test
            </button>
            <button 
                @click="$emit('toggleTestSpeaking')"
                class="flex-1 px-2 py-1 rounded-md text-[10px] bg-zinc-700 hover:bg-zinc-600 text-foreground"
            >
                Toggle Speak
            </button>
        </div>
        
        <button 
            @click="$emit('clearTestMembers')"
            class="w-full px-2 py-1 rounded-md text-[10px] bg-zinc-700 hover:bg-zinc-600 text-foreground"
        >
            Clear Test Members
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WidgetAnchor } from '@/lib/overlay'

const props = defineProps<{
    canvasSizeMode: string
    customWidth: number
    customHeight: number
    currentCanvasSize: string
    disabled: boolean
    globalOpacity: number
    showWidgetBackground: boolean
    showMemberCards: boolean
    screenPadding: number
    widgetPadding: number
    memberSpacing: number
    widgetAnchor: WidgetAnchor
}>()

defineEmits<{
    'update:canvasSizeMode': [value: string]
    'update:customWidth': [value: number]
    'update:customHeight': [value: number]
    'update:globalOpacity': [value: number]
    'update:showWidgetBackground': [value: boolean]
    'update:showMemberCards': [value: boolean]
    'update:screenPadding': [value: number]
    'update:widgetPadding': [value: number]
    'update:memberSpacing': [value: number]
    'update:widgetAnchor': [value: WidgetAnchor]
    addTestMember: []
    toggleTestSpeaking: []
    clearTestMembers: []
}>()

const screenSize = computed(() => `${screen.width}×${screen.height}`)
const windowSize = computed(() => `${window.innerWidth}×${window.innerHeight}`)

const anchors = [
    { value: 'top-left' as const, label: '↖ TL' },
    { value: 'top-center' as const, label: '↑ TC' },
    { value: 'top-right' as const, label: '↗ TR' },
    { value: 'bottom-left' as const, label: '↙ BL' },
    { value: 'bottom-center' as const, label: '↓ BC' },
    { value: 'bottom-right' as const, label: '↘ BR' },
]
</script>
