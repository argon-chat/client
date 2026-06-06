<template>
  <div class="p-3 border-t border-border space-y-2 overflow-y-auto">
    <h3 class="text-xs font-medium text-foreground">Native Overlay (libovl)</h3>

    <div v-if="!available" class="text-[10px] text-muted-foreground">
      Native overlay bridge unavailable (not running in Electron host).
    </div>

    <template v-else>
      <!-- Status -->
      <div class="text-[10px] text-muted-foreground space-y-0.5">
        <div>
          Status:
          <span :class="status.active ? 'text-green-400' : 'text-zinc-400'">
            {{ status.active ? 'ACTIVE' : 'idle' }}
          </span>
          <span v-if="status.forced" class="text-amber-400"> (forced)</span>
        </div>
        <div>In voice: {{ status.inVoice ? 'yes' : 'no' }} · Game: {{ status.gameActive ? 'yes' : 'no' }}</div>
        <div>Members pushed: {{ status.memberCount }}</div>
        <div>
          OSR paints:
          <span :class="status.paints > 0 ? 'text-green-400' : 'text-amber-400'">{{ status.paints ?? 0 }}</span>
          · shared texture:
          <span :class="status.paintTexture ? 'text-green-400' : 'text-red-400'">{{ status.paintTexture ? 'yes' : 'no' }}</span>
        </div>
        <div v-if="status.native" class="pt-1 border-t border-zinc-700/50">
          <div>
            Window: <span :class="status.native.windowCreated ? 'text-green-400' : 'text-red-400'">{{ status.native.windowCreated ? 'created' : 'no' }}</span>
            · Swapchain: <span :class="status.native.swapchainCreated ? 'text-green-400' : 'text-red-400'">{{ status.native.swapchainCreated ? 'yes' : 'no' }}</span>
          </div>
          <div>
            Frames presented:
            <span :class="status.native.presents > 0 ? 'text-green-400' : 'text-amber-400'">{{ status.native.presents }}</span>
            <span v-if="status.native.w"> · {{ status.native.w }}×{{ status.native.h }}</span>
          </div>
          <div>
            Hit-tests (click-through):
            <span :class="status.native.hitTests > 0 ? 'text-green-400' : 'text-zinc-400'">{{ status.native.hitTests ?? 0 }}</span>
          </div>
          <div v-if="status.native.lastHr && status.native.lastHr < 0" class="text-red-400">
            Present HRESULT: 0x{{ (status.native.lastHr >>> 0).toString(16) }}
          </div>
        </div>
        <div v-else class="text-amber-400">Native stats unavailable (overlay plugin not loaded?)</div>
      </div>

      <!-- Activation diagnostics: why is / isn't the overlay up for a real game? -->
      <div class="text-[10px] space-y-0.5 pt-1 border-t border-zinc-700/50">
        <div>
          Flag <span class="text-zinc-400">af.overlay.games.enabled</span>:
          <span :class="overlayFlag ? 'text-green-400' : 'text-red-400'">{{ overlayFlag ? 'ON' : 'OFF' }}</span>
          <span v-if="!overlayFlag" class="text-amber-400"> — auto-overlay disabled</span>
        </div>
        <div>Why: <span class="text-foreground">{{ status.reason ?? '—' }}</span></div>
        <div v-if="status.currentGame">
          Current game: <span class="text-foreground">{{ status.currentGame.name }}</span> (pid {{ status.currentGame.pid }})
        </div>
        <div v-else>Current game: <span class="text-zinc-400">none</span></div>
        <div v-if="status.trackedGames?.length">
          Tracked: {{ status.trackedGames.map((g: any) => `${g.name}#${g.pid}`).join(', ') }}
        </div>
        <div v-if="status.windowInfo">
          Window: hwnd {{ status.windowInfo.hwnd }} · mon {{ status.windowInfo.monitorIndex }} · {{ status.windowInfo.w }}×{{ status.windowInfo.h }}
        </div>
      </div>

      <!-- Activation log -->
      <div class="space-y-1">
        <label class="text-[10px] text-muted-foreground">Activation log</label>
        <div class="max-h-40 overflow-y-auto rounded-md bg-zinc-900/60 border border-zinc-700/50 p-1.5 font-mono text-[9px] leading-relaxed">
          <div v-if="!status.log?.length" class="text-zinc-500">— no events yet —</div>
          <div v-for="(e, i) in reversedLog" :key="i" class="text-zinc-300">
            <span class="text-zinc-500">{{ fmtTime(e.ts) }}</span> {{ e.msg }}
          </div>
        </div>
      </div>

      <!-- Target monitor -->
      <div class="space-y-1">
        <label class="text-[10px] text-muted-foreground">Target monitor</label>
        <select
          v-model.number="selectedMonitor"
          class="w-full px-2 py-1 rounded-md text-[10px] bg-zinc-800 border border-zinc-600 text-foreground"
        >
          <option v-for="d in displays" :key="d.index" :value="d.index">
            #{{ d.index }} — {{ d.label }} ({{ d.width }}×{{ d.height }}{{ d.primary ? ', primary' : '' }})
          </option>
        </select>
      </div>

      <!-- Force show / hide -->
      <div class="flex gap-1.5">
        <button
          @click="forceShow"
          class="flex-1 px-2 py-1 rounded-md text-[10px] bg-green-500/20 text-green-400 hover:bg-green-500/30"
        >
          Force Show
        </button>
        <button
          @click="forceHide"
          class="flex-1 px-2 py-1 rounded-md text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30"
        >
          Hide
        </button>
      </div>

      <!-- Config -->
      <label class="flex items-center gap-2 text-[10px] text-foreground cursor-pointer">
        <input
          type="checkbox"
          v-model="followForeground"
          @change="applyConfig"
          class="w-3 h-3 rounded border-zinc-600 bg-zinc-800 text-primary"
        />
        <span>Hide when game not focused (followForeground)</span>
      </label>

      <p class="text-[10px] text-muted-foreground leading-snug">
        Force Show composites the real native overlay on the selected monitor without a game.
        The members from the panel on the left are pushed into the actual overlay.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { VoiceMember } from '@/lib/overlay'
import { useFeatureFlags } from '@/store/features/featureFlagsStore'

const props = defineProps<{ members: VoiceMember[] }>()

const featureFlags = useFeatureFlags()
const overlayFlag = computed(() => featureFlags.overlayGamesEnabled)

const reversedLog = computed<{ ts: number; msg: string }[]>(() =>
  [...((status.value.log as { ts: number; msg: string }[]) ?? [])].reverse(),
)

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.toLocaleTimeString('en-GB', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

interface DisplayInfo {
  index: number
  label: string
  width: number
  height: number
  scaleFactor: number
  primary: boolean
}

const bridge = (window as any).argonOverlay
const available = !!bridge?.debug

const displays = ref<DisplayInfo[]>([])
const selectedMonitor = ref(0)
const followForeground = ref(false)
const status = ref<any>({ active: false, forced: false, inVoice: false, gameActive: false, memberCount: 0, native: null })

let statusTimer: ReturnType<typeof setInterval> | null = null

async function refreshStatus() {
  if (!available) return
  try {
    status.value = await bridge.debug.status()
  } catch { /* ignore */ }
}

function forceShow() {
  if (!available) return
  bridge.debug.show(selectedMonitor.value)
  // Push current members immediately so they appear in the overlay.
  bridge.debug.setMembers(JSON.parse(JSON.stringify(props.members)))
  refreshStatus()
}

function forceHide() {
  if (!available) return
  bridge.debug.hide()
  refreshStatus()
}

function applyConfig() {
  if (!available) return
  bridge.debug.setConfig({ followForeground: followForeground.value })
}

// While forced-active, keep the native overlay's members in sync with the panel.
watch(
  () => props.members,
  (members) => {
    if (available && status.value.forced) {
      bridge.debug.setMembers(JSON.parse(JSON.stringify(members)))
    }
  },
  { deep: true },
)

onMounted(async () => {
  if (!available) return
  try { displays.value = await bridge.debug.listDisplays() } catch { /* ignore */ }
  await refreshStatus()
  statusTimer = setInterval(refreshStatus, 1000)
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
})
</script>
