<template>
  <canvas ref="canvasEl" class="overlay-canvas"></canvas>
</template>

<script setup lang="ts">
/**
 * Lean in-game overlay view. Rendered inside a dedicated offscreen Electron
 * BrowserWindow whose painted WebGPU output is handed (as a shared D3D11 texture)
 * to the native overlay plugin. Receives voice-channel state + HUD config over the
 * `argonOverlay` preload bridge; owns no stores/socket.
 *
 * Render model: mostly-static content → the renderer only runs for a short settle
 * window after each change, then idles (DirectComposition holds the last frame).
 * If any widget reports `needsContinuousRender()` (e.g. a speaking pulse), the
 * settle window keeps re-arming so the animation stays live, then stops once idle.
 */
import { onMounted, onUnmounted, ref } from 'vue'
import {
  OverlayRenderer,
  VoiceMembersWidget,
  ChatPeekWidget,
  NotificationsWidget,
  normalizeHudConfig,
  type VoiceMember,
  type OverlayHudConfig,
  type OverlayChatMessage,
  type OverlayNotification,
} from '@/lib/overlay'

const canvasEl = ref<HTMLCanvasElement | null>(null)

let renderer: OverlayRenderer | null = null
let voice: VoiceMembersWidget | null = null
let chat: ChatPeekWidget | null = null
let notifications: NotificationsWidget | null = null
let running = false
let settleTimer: ReturnType<typeof setTimeout> | null = null

// Time to keep rendering after a change so async avatar uploads land, then idle.
const SETTLE_MS = 2000

let hud: OverlayHudConfig = normalizeHudConfig(null)

function sizeCanvas(): void {
  if (!canvasEl.value) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.floor(window.innerWidth * dpr))
  const h = Math.max(1, Math.floor(window.innerHeight * dpr))
  canvasEl.value.width = w
  canvasEl.value.height = h
  renderer?.resize(w, h)
}

/** Apply the full HUD config forwarded from the main window. */
function applyConfig(raw: unknown): void {
  hud = normalizeHudConfig(raw)
  if (renderer) renderer.setGlobalOpacity(hud.globalOpacity)
  if (voice) {
    voice.applyLayout(hud.widgets.voice)
    voice.setScreenPadding(hud.screenPadding)
    voice.setVoiceConfig(hud.voice)
  }
  if (chat) {
    chat.applyLayout(hud.widgets.chat)
    chat.setScreenPadding(hud.screenPadding)
    chat.setConfig(hud.chat)
  }
  if (notifications) {
    notifications.applyLayout(hud.widgets.notifications)
    notifications.setScreenPadding(hud.screenPadding)
    notifications.setConfig(hud.notifications)
  }
  kick()
}

/** True while any mounted widget wants the renderer to keep producing frames. */
function anyWidgetAnimating(): boolean {
  return (
    !!voice?.needsContinuousRender() ||
    !!chat?.needsContinuousRender() ||
    !!notifications?.needsContinuousRender()
  )
}

/** Run the renderer; keep re-arming the settle window while widgets animate, then idle. */
function kick(): void {
  if (!renderer) return
  if (!running) {
    renderer.start()
    running = true
  }
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    if (anyWidgetAnimating()) {
      kick()
      return
    }
    renderer?.stop()
    running = false
    settleTimer = null
  }, SETTLE_MS)
}

async function init(): Promise<void> {
  if (!canvasEl.value) return

  const dpr = window.devicePixelRatio || 1
  canvasEl.value.width = Math.max(1, Math.floor(window.innerWidth * dpr))
  canvasEl.value.height = Math.max(1, Math.floor(window.innerHeight * dpr))

  renderer = new OverlayRenderer(canvasEl.value, { type: 'container' })
  const ok = await renderer.initialize()
  if (!ok) {
    console.error('[overlay-window] WebGPU renderer failed to initialize')
    return
  }

  const device = renderer.getDevice()
  const format = renderer.getFormat()
  const layout = renderer.getUniformBindGroupLayout()

  voice = new VoiceMembersWidget('voice-members', { x: 20, y: 20 })
  chat = new ChatPeekWidget('chat-peek')
  notifications = new NotificationsWidget('notifications')
  if (device && layout) {
    // Add order = back-to-front. Voice + chat behind, toasts on top.
    voice.initGPU(device, format, layout)
    chat.initGPU(device, format, layout)
    notifications.initGPU(device, format, layout)
    renderer.addWidget(voice)
    renderer.addWidget(chat)
    renderer.addWidget(notifications)
  }

  // Apply defaults until the main process pushes the real config.
  applyConfig(hud)

  const bridge = (window as any).argonOverlay
  bridge?.onVoiceState?.((members: VoiceMember[]) => {
    if (!voice) return
    voice.setMembers(Array.isArray(members) ? members : [])
    kick()
  })
  bridge?.onChatPeek?.((messages: OverlayChatMessage[]) => {
    if (!chat) return
    chat.setMessages(Array.isArray(messages) ? messages : [])
    kick()
  })
  bridge?.onNotification?.((n: OverlayNotification) => {
    if (!notifications || !n) return
    notifications.push(n)
    kick()
  })
  bridge?.onWidgetConfig?.((cfg: unknown) => applyConfig(cfg))
  // Now that we're subscribed, pull the current snapshot (covers the case where
  // the main process pushed it before this window finished loading).
  bridge?.requestState?.()

  kick()
}

function onResize(): void {
  sizeCanvas()
  kick()
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  void init()
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  if (settleTimer) clearTimeout(settleTimer)
  renderer?.stop()
  renderer?.dispose()
  renderer = null
  voice = null
  chat = null
  notifications = null
})
</script>

<style scoped>
.overlay-canvas {
  display: block;
  width: 100vw;
  height: 100vh;
  background: transparent;
}
</style>
