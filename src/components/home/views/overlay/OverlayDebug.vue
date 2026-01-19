<template>
    <div class="overlay-debug-view flex flex-col h-full bg-background">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-border">
            <h2 class="text-xl font-semibold text-foreground">Overlay Debug</h2>
            <div class="flex items-center gap-3">
                <span class="text-sm text-muted-foreground">
                    WebGPU: {{ gpuStatus }}
                </span>
                <button 
                    @click="toggleOverlay"
                    class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                    :class="isRunning ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'"
                >
                    {{ isRunning ? 'Stop' : 'Start' }}
                </button>
            </div>
        </div>

        <!-- Main content -->
        <div class="flex flex-1 overflow-hidden">
            <!-- Canvas container -->
            <div class="flex-1 relative bg-zinc-900/50 overflow-hidden" ref="canvasContainer">
                <canvas 
                    ref="overlayCanvas" 
                    class="absolute inset-0"
                    :style="{ width: '100%', height: '100%' }"
                />
                
                <!-- Overlay info when not running -->
                <div 
                    v-if="!isRunning" 
                    class="absolute inset-0 flex items-center justify-center bg-black/50"
                >
                    <div class="text-center text-muted-foreground">
                        <p class="text-lg mb-2">WebGPU Overlay Canvas</p>
                        <p class="text-sm">Click "Start" to begin rendering</p>
                    </div>
                </div>
            </div>

            <!-- Side panels (two columns) -->
            <div class="w-[640px] border-l border-border flex">
                <!-- Left panel: Members + Controls -->
                <div class="w-1/2 border-r border-border flex flex-col">
                    <VoiceMembersList 
                        :currentChannel="currentChannel"
                        :members="voiceMembers"
                    />
                    
                    <OverlayControls
                        v-model:canvasSizeMode="canvasSizeMode"
                        v-model:customWidth="customWidth"
                        v-model:customHeight="customHeight"
                        v-model:globalOpacity="globalOpacity"
                        v-model:showWidgetBackground="showWidgetBackground"
                        v-model:showMemberCards="showMemberCards"
                        v-model:screenPadding="screenPadding"
                        v-model:widgetPadding="widgetPadding"
                        v-model:memberSpacing="memberSpacing"
                        v-model:widgetAnchor="widgetAnchor"
                        :currentCanvasSize="currentCanvasSize"
                        :disabled="isRunning"
                        @update:canvasSizeMode="updateCanvasSize"
                        @update:globalOpacity="updateGlobalOpacity"
                        @update:showWidgetBackground="updateShowWidgetBackground"
                        @update:showMemberCards="updateShowMemberCards"
                        @update:screenPadding="updateScreenPadding"
                        @update:widgetPadding="updateWidgetPadding"
                        @update:memberSpacing="updateMemberSpacing"
                        @update:widgetAnchor="updateWidgetAnchor"
                        @addTestMember="addTestMember"
                        @toggleTestSpeaking="toggleTestSpeaking"
                        @clearTestMembers="clearTestMembers"
                    />
                </div>
                
                <!-- Right panel: Diagnostics + Capture + Native -->
                <div class="w-1/2 flex flex-col overflow-hidden">
                    <OverlayDiagnosticsView 
                        v-if="isRunning"
                        :diagnostics="diagnostics"
                    />
                    
                    <FrameCapture
                        :renderer="renderer"
                        :isRunning="isRunning"
                    />
                    
                    <NativeBridge
                        ref="nativeBridgeRef"
                        :renderer="renderer"
                        :isRunning="isRunning"
                    />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useUnifiedCall } from '@/store/unifiedCallStore'
import { useRealtimeStore } from '@/store/realtimeStore'
import { useUserColors } from '@/store/userColors'
import { useSystemStore } from '@/store/systemStore'
import { useMe } from '@/store/meStore'
import { OverlayRenderer, VoiceMembersWidget, type VoiceMember, type CanvasSizeMode, type OverlayDiagnostics, type IOverlayRenderer, type WidgetAnchor } from '@/lib/overlay'

// Components
import VoiceMembersList from './VoiceMembersList.vue'
import OverlayControls from './OverlayControls.vue'
import OverlayDiagnosticsView from './OverlayDiagnostics.vue'
import FrameCapture from './FrameCapture.vue'
import NativeBridge from './NativeBridge.vue'

// Stores
const voice = useUnifiedCall()
const realtimeStore = useRealtimeStore()
const userColors = useUserColors()
const sys = useSystemStore()
const me = useMe()

// Refs
const canvasContainer = ref<HTMLDivElement | null>(null)
const overlayCanvas = ref<HTMLCanvasElement | null>(null)
const nativeBridgeRef = ref<InstanceType<typeof NativeBridge> | null>(null)

// State
const isRunning = ref(false)
const gpuStatus = ref<'checking' | 'supported' | 'not-supported'>('checking')

// Diagnostics
const diagnostics = ref<OverlayDiagnostics | null>(null)
let diagnosticsInterval: ReturnType<typeof setInterval> | null = null

// Canvas size mode
const canvasSizeMode = ref<string>('container')
const customWidth = ref(1920)
const customHeight = ref(1080)
const actualCanvasSize = ref({ width: 0, height: 0 })

// Overlay display options
const globalOpacity = ref(1.0)
const showWidgetBackground = ref(true)
const showMemberCards = ref(true)
const screenPadding = ref(20)
const widgetPadding = ref(12)
const memberSpacing = ref(6)
const widgetAnchor = ref<WidgetAnchor>('top-left')

const currentCanvasSize = computed(() => {
    if (actualCanvasSize.value.width === 0) return '—'
    return `${actualCanvasSize.value.width}×${actualCanvasSize.value.height}`
})

function getSizeMode(): CanvasSizeMode {
    switch (canvasSizeMode.value) {
        case 'screen':
            return { type: 'screen' }
        case 'window':
            return { type: 'window' }
        case '1920x1080':
            return { type: 'fixed', width: 1920, height: 1080 }
        case '2560x1440':
            return { type: 'fixed', width: 2560, height: 1440 }
        case '3840x2160':
            return { type: 'fixed', width: 3840, height: 2160 }
        case 'custom':
            return { type: 'fixed', width: customWidth.value, height: customHeight.value }
        default:
            return { type: 'container' }
    }
}

function updateCanvasSize() {
    if (rendererInstance && isRunning.value) {
        rendererInstance.setSizeMode(getSizeMode())
        setTimeout(updateActualCanvasSize, 50)
    }
}

function updateGlobalOpacity(value: number) {
    globalOpacity.value = value
    if (rendererInstance) {
        rendererInstance.setGlobalOpacity(value)
    }
}

function updateShowWidgetBackground(value: boolean) {
    showWidgetBackground.value = value
    if (voiceMembersWidget) {
        voiceMembersWidget.setShowWidgetBackground(value)
    }
}

function updateShowMemberCards(value: boolean) {
    showMemberCards.value = value
    if (voiceMembersWidget) {
        voiceMembersWidget.setShowMemberCards(value)
    }
}

function updateScreenPadding(value: number) {
    screenPadding.value = value
    if (voiceMembersWidget) {
        voiceMembersWidget.setScreenPadding(value)
    }
}

function updateWidgetPadding(value: number) {
    widgetPadding.value = value
    if (voiceMembersWidget) {
        voiceMembersWidget.setPadding(value)
    }
}

function updateMemberSpacing(value: number) {
    memberSpacing.value = value
    if (voiceMembersWidget) {
        voiceMembersWidget.setMemberSpacing(value)
    }
}

function updateWidgetAnchor(value: WidgetAnchor) {
    widgetAnchor.value = value
    if (voiceMembersWidget) {
        voiceMembersWidget.setAnchor(value)
    }
}

// Renderer instance (exposed for child components)
const renderer = ref<IOverlayRenderer | null>(null)
let rendererInstance: OverlayRenderer | null = null
let voiceMembersWidget: VoiceMembersWidget | null = null

// Test members for debugging
const testMembers = ref<VoiceMember[]>([])
let testMemberCounter = 0

// Current voice channel
const currentChannel = computed(() => {
    const channelId = voice.connectedVoiceChannelId
    if (!channelId) return null
    
    const realtimeChannel = realtimeStore.realtimeChannels.get(channelId)
    return realtimeChannel?.Channel ?? null
})

// Voice members from realtime store + test members
const voiceMembers = computed<VoiceMember[]>(() => {
    const members: VoiceMember[] = []
    
    const channelId = voice.connectedVoiceChannelId
    if (channelId) {
        const realtimeChannel = realtimeStore.realtimeChannels.get(channelId)
        if (realtimeChannel) {
            for (const [userId, user] of realtimeChannel.Users) {
                const isSpeaking = voice.speaking.has(userId)
                const isMe = userId === me.me?.userId
                
                let isMuted = false
                let isDeafened = false
                
                if (isMe) {
                    isMuted = sys.microphoneMuted
                    isDeafened = sys.headphoneMuted
                } else {
                    const participant = voice.participants[userId]
                    isMuted = participant?.muted ?? false
                    isDeafened = participant?.mutedAll ?? false
                }
                
                members.push({
                    userId,
                    displayName: user.User?.displayName ?? 'Unknown',
                    avatarUrl: user.User?.avatarFileId ?? null,
                    avatarColor: userColors.getColorByUserId(userId),
                    isSpeaking,
                    isMuted,
                    isDeafened,
                })
            }
        }
    }
    
    members.push(...testMembers.value)
    
    return members
})

// Check WebGPU support
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
    if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter()
        gpuStatus.value = adapter ? 'supported' : 'not-supported'
    } else {
        gpuStatus.value = 'not-supported'
    }
    
    resizeObserver = new ResizeObserver(handleResize)
    if (canvasContainer.value) {
        resizeObserver.observe(canvasContainer.value)
    }
})

onUnmounted(() => {
    resizeObserver?.disconnect()
    stopOverlay()
})

// Update widget when members or speaking state changes
watch(voiceMembers, (members) => {
    if (voiceMembersWidget) {
        voiceMembersWidget.setMembers(members)
    }
}, { deep: true, immediate: true })

// Watch speaking changes
watch(
    () => Array.from(voice.speaking).sort().join(','),
    () => {
        if (voiceMembersWidget) {
            for (const member of voiceMembers.value) {
                const isSpeaking = voice.speaking.has(member.userId)
                voiceMembersWidget.setSpeaking(member.userId, isSpeaking)
            }
        }
    },
    { immediate: true }
)

watch(testMembers, () => {
    if (voiceMembersWidget) {
        voiceMembersWidget.setMembers(voiceMembers.value)
    }
}, { deep: true })

function handleResize() {
    if (!canvasContainer.value || !overlayCanvas.value || !rendererInstance) return
    
    const sizeMode = rendererInstance.getSizeMode()
    if (sizeMode.type !== 'container') return
    
    const rect = canvasContainer.value.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    
    overlayCanvas.value.width = rect.width * dpr
    overlayCanvas.value.height = rect.height * dpr
    
    actualCanvasSize.value = { width: overlayCanvas.value.width, height: overlayCanvas.value.height }
    rendererInstance.resize(rect.width * dpr, rect.height * dpr)
}

function updateActualCanvasSize() {
    if (overlayCanvas.value) {
        actualCanvasSize.value = { 
            width: overlayCanvas.value.width, 
            height: overlayCanvas.value.height 
        }
    }
}

async function startOverlay() {
    if (!overlayCanvas.value || !canvasContainer.value) return
    
    const sizeMode = getSizeMode()
    rendererInstance = new OverlayRenderer(overlayCanvas.value, sizeMode)
    renderer.value = rendererInstance
    
    if (sizeMode.type === 'container') {
        const rect = canvasContainer.value.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        overlayCanvas.value.width = rect.width * dpr
        overlayCanvas.value.height = rect.height * dpr
    }
    
    const initialized = await rendererInstance.initialize()
    
    if (!initialized) {
        console.error('[OverlayDebug] Failed to initialize renderer')
        return
    }
    
    updateActualCanvasSize()
    
    voiceMembersWidget = new VoiceMembersWidget('voice-members', { x: 20, y: 20 })
    
    const device = rendererInstance.getDevice()
    const format = rendererInstance.getFormat()
    const uniformLayout = rendererInstance.getUniformBindGroupLayout()
    
    if (device && uniformLayout) {
        voiceMembersWidget.initGPU(device, format, uniformLayout)
        voiceMembersWidget.setMembers(voiceMembers.value)
        rendererInstance.addWidget(voiceMembersWidget)
    }
    
    rendererInstance.start()
    isRunning.value = true
    
    startDiagnostics()
}

function stopOverlay() {
    stopDiagnostics()
    nativeBridgeRef.value?.stop()
    
    if (rendererInstance) {
        rendererInstance.stop()
        rendererInstance.dispose()
        rendererInstance = null
        renderer.value = null
    }
    voiceMembersWidget = null
    isRunning.value = false
    diagnostics.value = null
}

function startDiagnostics() {
    diagnosticsInterval = setInterval(() => {
        if (rendererInstance) {
            diagnostics.value = rendererInstance.getDiagnostics()
        }
    }, 150)
}

function stopDiagnostics() {
    if (diagnosticsInterval) {
        clearInterval(diagnosticsInterval)
        diagnosticsInterval = null
    }
}

function toggleOverlay() {
    if (isRunning.value) {
        stopOverlay()
    } else {
        startOverlay()
    }
}

// Debug helpers
// DiceBear avatars - supports CORS
const testAvatars = [
    'https://api.dicebear.com/7.x/avataaars/png?seed=Alice&size=150',
    'https://api.dicebear.com/7.x/avataaars/png?seed=Bob&size=150',
    'https://api.dicebear.com/7.x/avataaars/png?seed=Charlie&size=150',
    'https://api.dicebear.com/7.x/avataaars/png?seed=Diana&size=150',
    'https://api.dicebear.com/7.x/avataaars/png?seed=Eve&size=150',
    'https://api.dicebear.com/7.x/avataaars/png?seed=Frank&size=150',
    'https://api.dicebear.com/7.x/avataaars/png?seed=Grace&size=150',
    'https://api.dicebear.com/7.x/avataaars/png?seed=Henry&size=150',
]

function addTestMember() {
    testMemberCounter++
    const testNames = ['Kurwa', 'Bobr', 'Chakra', 'Blyat', 'Pisa', 'Coca', 'Grace', 'Hentai']
    const name = testNames[testMemberCounter % testNames.length] + ` #${testMemberCounter}`
    const userId = `test-${testMemberCounter}-${Date.now()}`
    
    // 70% шанс что будет аватарка
    const hasAvatar = Math.random() > 0.3
    const avatarUrl = hasAvatar ? testAvatars[testMemberCounter % testAvatars.length] : null
    
    testMembers.value.push({
        userId,
        displayName: name,
        avatarUrl,
        avatarColor: userColors.getColorByUserId(userId),
        isSpeaking: false,
        isMuted: Math.random() > 0.7,
        isDeafened: Math.random() > 0.9,
    })
}

function toggleTestSpeaking() {
    if (testMembers.value.length === 0) return
    const randomIndex = Math.floor(Math.random() * testMembers.value.length)
    testMembers.value[randomIndex].isSpeaking = !testMembers.value[randomIndex].isSpeaking
}

function clearTestMembers() {
    testMembers.value = []
    testMemberCounter = 0
}
</script>

<style scoped>
.overlay-debug-view {
    background: linear-gradient(135deg, hsl(var(--background)) 0%, hsl(240 10% 8%) 100%);
}
</style>
