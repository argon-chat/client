<template>
  <canvas ref="canvasEl" class="overlay-canvas"></canvas>
</template>

<script setup lang="ts">
/**
 * Lean in-game overlay view. Rendered inside a dedicated offscreen Electron
 * BrowserWindow whose painted WebGPU output is handed (as a shared D3D11 texture)
 * to the native overlay plugin. Receives voice-channel state over the
 * `argonOverlay` preload bridge; owns no stores/socket.
 *
 * Static indicators → no continuous animation. To avoid burning GPU/native-present
 * bandwidth on unchanging content, the renderer only runs for a short settle window
 * after each change, then stops; DirectComposition holds the last presented frame.
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { OverlayRenderer, VoiceMembersWidget, type VoiceMember } from '@/lib/overlay'

const canvasEl = ref<HTMLCanvasElement | null>(null)

// Default overlay opacity (overridable via widget-config from the debug view).
const DEFAULT_OPACITY = 0.45

let renderer: OverlayRenderer | null = null
let widget: VoiceMembersWidget | null = null
let running = false
let settleTimer: ReturnType<typeof setTimeout> | null = null

// Time to keep rendering after a change so async avatar uploads land, then idle.
const SETTLE_MS = 2000

function sizeCanvas(): void {
  if (!canvasEl.value) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.floor(window.innerWidth * dpr))
  const h = Math.max(1, Math.floor(window.innerHeight * dpr))
  canvasEl.value.width = w
  canvasEl.value.height = h
  renderer?.resize(w, h)
}

/** Apply widget display params forwarded from the main window. */
function applyConfig(cfg: any): void {
  if (!cfg) return
  if (renderer && typeof cfg.globalOpacity === 'number') renderer.setGlobalOpacity(cfg.globalOpacity)
  if (widget) {
    if (typeof cfg.showWidgetBackground === 'boolean') widget.setShowWidgetBackground(cfg.showWidgetBackground)
    if (typeof cfg.showMemberCards === 'boolean') widget.setShowMemberCards(cfg.showMemberCards)
    if (typeof cfg.screenPadding === 'number') widget.setScreenPadding(cfg.screenPadding)
    if (typeof cfg.widgetPadding === 'number') widget.setPadding(cfg.widgetPadding)
    if (typeof cfg.memberSpacing === 'number') widget.setMemberSpacing(cfg.memberSpacing)
    if (cfg.widgetAnchor) widget.setAnchor(cfg.widgetAnchor)
  }
  kick()
}

/** Run the renderer briefly to flush the latest state, then stop (idle). */
function kick(): void {
  if (!renderer) return
  if (!running) {
    renderer.start()
    running = true
  }
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
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

  widget = new VoiceMembersWidget('voice-members', { x: 20, y: 20 })
  const device = renderer.getDevice()
  const format = renderer.getFormat()
  const layout = renderer.getUniformBindGroupLayout()
  if (device && layout) {
    widget.initGPU(device, format, layout)
    renderer.addWidget(widget)
  }

  renderer.setGlobalOpacity(DEFAULT_OPACITY)

  const bridge = (window as any).argonOverlay
  bridge?.onVoiceState?.((members: VoiceMember[]) => {
    if (!widget) return
    const list = Array.isArray(members) ? members : []
    widget.setMembers(list)
    kick()
  })
  bridge?.onWidgetConfig?.((cfg: any) => applyConfig(cfg))
  // Now that we're subscribed, pull the current snapshot (covers the case where
  // the main process pushed it before this window finished loading).
  bridge?.requestState?.()

  // Render an initial settle window (first frame + avatar uploads).
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
  widget = null
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
