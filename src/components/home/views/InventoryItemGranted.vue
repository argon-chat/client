<template>
  <Dialog v-model:open="open">
    <DialogContent class="w-[760px] max-w-[95vw] overflow-hidden border-0 bg-transparent p-0 shadow-none">
      <div class="relative">
        <div class="pointer-events-none absolute inset-0">
          <div
            class="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_20%,rgba(0,0,0,0)_0%,rgba(0,0,0,.65)_70%,rgba(0,0,0,.9)_100%)]" />
          <div
            class="absolute inset-0 bg-[linear-gradient(transparent_95%,rgba(255,255,255,.06)_96%),linear-gradient(90deg,transparent_95%,rgba(255,255,255,.06)_96%)] bg-[size:32px_32px] opacity-20" />
        </div>

        <div class="relative mx-auto w-full overflow-hidden rounded-2xl ring-1 ring-white/10 backdrop-blur-md">
          <video v-if="videoSrc" @error="onVideoError" class="absolute inset-0 h-full w-full object-cover opacity-90 [mix-blend-mode:screen]"
            :poster="poster || undefined" :playsinline="true" muted loop autoplay preload="metadata">
            <source :src="videoSrc" type="video/webm" />
          </video>

          <div :class="['absolute inset-0']" />
          <div class="pointer-events-none absolute inset-0 overflow-hidden">
            <div class="beam" />
            <div class="beam beam--2" />
            <div class="beam beam--3" />

            <div :class="['aura', auraToneClass]" />
            <div class="aura aura--soft" />

            <div class="sparkles">
              <span v-for="n in 18" :key="n" class="sparkle" />
            </div>

            <div
              class="absolute inset-0 bg-[radial-gradient(120%_140%_at_20%_30%,transparent_0,transparent_55%,rgba(0,0,0,.25)_85%)]" />
          </div>

          <div class="relative grid grid-cols-[280px,1fr] md:grid-cols-[300px,1fr]">
            <div class="relative h-[235px]">
              <div
                class="absolute inset-0 rounded-2xl border border-white/10 shadow-[inset_0_0_40px_rgba(0,0,0,.35)]" />
              <div ref="tilt" class="relative h-full w-full [perspective:1100px]" @mousemove="onMouse"
                @mouseleave="resetTilt">
                <div class="absolute left-1/2 top-1/2 h-[180px] w-[220px] -translate-x-1/2 -translate-y-1/2">
                  <div :class="['pointer-events-none absolute -inset-2 rounded-xl blur-2xl', glowClass]" />
                  <div class="relative flex h-full w-full items-center justify-center">
                    <div class="animate-float">
                      <img :src="item?.icon" :alt="item?.name" class="pointer-events-none h-[132px] w-[132px] select-none object-contain
             drop-shadow-[0_14px_40px_rgba(0,0,0,.6)] animate-flicker" draggable="false" />
                    </div>
                    <div class="pointer-events-none absolute bottom-[26px] h-5 w-24 rounded-full bg-black/50 blur-md" />
                  </div>

                </div>
              </div>
            </div>

            <div class="relative p-6 pr-7 text-white">
              <h3 class="text-[22px] font-semibold tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,.5)]">
                Вы получили предмет!
              </h3>
              <p class="mt-2 text-[15px] uppercase tracking-[0.15em] opacity-90
         bg-gradient-to-r from-yellow-300 via-amber-500 to-yellow-200 font-bold
         bg-[length:200%_auto] bg-clip-text text-transparent animate-gold-shine">
                {{ item?.name }}
              </p>
              <p class="mt-3 text-sm leading-6 text-white/80">
                {{ item?.desc }}
              </p>

              <div class="mt-6 flex gap-3">
                <!-- <Button size="sm" variant="secondary" @click="emit('share')">Поделиться</Button> -->
                <Button size="lg" variant="outline" @click="emit('close'); open = false">Claim</Button>
              </div>

              <div
                class="pointer-events-none absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
              <div
                class="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface ItemDef { id: string; desc: string; name: string; class: string; size: number; icon: string }

const props = defineProps<{
  modelValue?: boolean
  item?: ItemDef | null
  videoSrc?: string
  poster?: string
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'close'): void; (e: 'share'): void }>()

const open = ref(!!props.modelValue)
watch(() => props.modelValue, v => (open.value = !!v))
watch(open, v => emit('update:modelValue', v))

const tilt = ref<HTMLDivElement | null>(null)
const rotX = ref(0)
const rotY = ref(0)
function onMouse(e: MouseEvent) {
  if (!tilt.value) return
  const r = tilt.value.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width
  const py = (e.clientY - r.top) / r.height
  const max = 10
  rotY.value = (px - 0.5) * max * 2
  rotX.value = -(py - 0.5) * max * 2
}
function resetTilt() { rotX.value = 0; rotY.value = 0 }

const bannerBaseClass = computed(() => ({
  common: 'bg-[linear-gradient(135deg,#1a1d22_0%,#1b2230_60%,#101318_100%)]',
  rare: 'bg-[linear-gradient(135deg,#0a1e2f_0%,#0e2a48_55%,#0b1220_100%)]',
  epic: 'bg-[linear-gradient(135deg,#2a103a_0%,#3c1a58_55%,#160b25_100%)]',
  legendary: 'bg-[linear-gradient(135deg,#3a2508_0%,#6b3b10_55%,#1a0f04_100%)]',
  ancient: 'bg-[linear-gradient(135deg,#2a0f24_0%,#4e1d42_55%,#140813_100%)]',
} as Record<string, string>)[props.item?.class ?? 'common'])

const auraToneClass = computed(() => ({
  common: 'from-[rgba(150,170,190,.18)]',
  rare: 'from-[rgba(80,170,255,.22)]',
  epic: 'from-[rgba(200,120,255,.24)]',
  legendary: 'from-[rgba(255,200,90,.24)]',
  ancient: 'from-[rgba(255,120,220,.26)]',
} as Record<string, string>)[props.item?.class ?? 'common'])

const glowClass = computed(() => ({
  common: 'bg-white/10',
  rare: 'bg-cyan-300/25',
  epic: 'bg-fuchsia-300/25',
  legendary: 'bg-amber-300/25',
  ancient: 'bg-pink-300/25',
} as Record<string, string>)[props.item?.class ?? 'common'])

const videoSrc = computed(() => props.videoSrc || '')
const poster = computed(() => props.poster || '')

function onVideoError(e: Event) {
  const v = e.target as HTMLVideoElement
  const code = v.error?.code
  console.error('!!!!!!!!!!!! Video error', { code, error: v.error })
}
</script>
<style lang="css" scoped>
.animate-gold-shine {
  animation: gold-shine 4s linear infinite;
}

@keyframes gold-shine {
  0% {
    background-position: 200% center;
  }

  100% {
    background-position: -200% center;
  }
}

@keyframes gold-glint {
  0% {
    left: -75%;
  }

  100% {
    left: 125%;
  }
}


@keyframes flicker {

  0%,
  100% {
    opacity: 1;
    filter: drop-shadow(0 0 8px rgba(255, 255, 200, 0.5));
  }

  45% {
    opacity: 0.9;
    filter: drop-shadow(0 0 14px rgba(255, 255, 200, 0.9));
  }

  60% {
    opacity: 0.95;
    filter: drop-shadow(0 0 10px rgba(255, 180, 100, 0.7));
  }

  80% {
    opacity: 1;
    filter: drop-shadow(0 0 12px rgba(255, 200, 150, 0.8));
  }
}

.animate-flicker {
  animation: flicker 2.5s infinite ease-in-out;
}

@keyframes float {

  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-8px);
  }
}

.animate-float {
  animation: float 4s ease-in-out infinite;
}
</style>