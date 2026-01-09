<template>
  <Dialog v-model:open="open">
    <DialogContent 
      class="!w-[720px] max-w-[95vw] overflow-hidden border-0 bg-transparent p-0 shadow-none"
      @escape-key-down="onEscape"
    >
      <!-- Accessibility: Hidden title and description for screen readers -->
      <VisuallyHidden>
        <DialogTitle>{{ computedTitle }}</DialogTitle>
        <DialogDescription>
          {{ item?.name }} - {{ item?.desc || t('inventory_item_desc_default') }}
        </DialogDescription>
      </VisuallyHidden>

      <div class="relative animate-in fade-in zoom-in-95 duration-300">
        <!-- Animated gradient border wrapper -->
        <div class="relative p-[3px] rounded-2xl bg-gradient-to-r animate-border-spin" :class="borderGradientClass">
          <div class="relative w-full overflow-hidden rounded-2xl backdrop-blur-xl shadow-2xl bg-card border border-border">
            
            <!-- WebGL Shader Effect -->
            <ItemGrantEffect 
              :rarity="item?.class || 'common'" 
              :active="open"
              class="absolute inset-0 z-5"
            />

            <!-- Animated gradient overlay with radial pulse -->
            <div class="absolute inset-0 bg-gradient-to-br from-background/60 via-background/80 to-background/90" />
            <div class="absolute inset-0 animate-radial-pulse" :style="{ background: `radial-gradient(circle at 50% 40%, ${rayColor}15 0%, transparent 60%)` }" />

            <!-- Main content -->
            <div class="relative z-20 flex flex-col items-center p-12 min-h-[500px]">
              
              <!-- Item display with effects -->
              <div class="mb-8 relative">
                <!-- Glow - subtle layer for item -->
                <div :class="['pointer-events-none absolute -inset-12 rounded-2xl blur-3xl opacity-60 animate-pulse-glow', glowClass]" />
                
                <!-- Item image -->
                <div class="relative flex h-[240px] w-[240px] items-center justify-center z-30">
                  <div class="animate-float">
                    <img 
                      :src="item?.icon" 
                      :alt="item?.name" 
                      class="pointer-events-none h-full w-full select-none object-contain drop-shadow-[0_20px_60px_rgba(0,0,0,.8)] animate-flicker" 
                      draggable="false" 
                    />
                  </div>
                  <div class="pointer-events-none absolute bottom-0 h-8 w-40 rounded-full bg-foreground/20 blur-xl" />
                </div>
              </div>

              <!-- Title -->
              <h3 class="text-3xl font-bold tracking-wide drop-shadow-[0_4px_12px_rgba(0,0,0,.7)] animate-slide-in-right text-center text-foreground">
                {{ computedTitle }}
              </h3>
              
              <!-- Item name with rarity gradient -->
              <p class="mt-4 text-2xl uppercase tracking-[0.2em] font-bold bg-[length:200%_auto] bg-clip-text text-transparent animate-gold-shine text-center"
                :class="getCardClass(item?.class ?? null)">
                {{ item?.name }}
              </p>
              
              <!-- Description -->
              <p class="mt-4 text-base leading-relaxed text-foreground/90 animate-slide-in-right animation-delay-100 text-center max-w-md">
                {{ item?.desc || t('inventory_item_desc_default') }}
              </p>

              <!-- Item metadata -->
              <div v-if="item" class="mt-6 flex flex-wrap gap-3 animate-slide-in-right animation-delay-200 justify-center">
                <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/30 backdrop-blur-sm border border-border">
                  <span class="text-xs font-medium text-muted-foreground">{{ t('inventory_rarity') }}</span>
                  <span 
                    class="text-xs font-bold uppercase tracking-wider"
                    :class="getCardClass(item?.class ?? null)">
                    {{ item?.class }}
                  </span>
                </div>
                <div v-if="item.usable" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-green-500/20 backdrop-blur-sm border border-green-500/40">
                  <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                  <span class="text-xs font-medium text-green-300">{{ t('inventory_usable') }}</span>
                </div>
                <div v-if="item.giftable" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-blue-500/20 backdrop-blur-sm border border-blue-500/40">
                  <span class="text-xs font-medium text-blue-300">{{ t('inventory_giftable') }}</span>
                </div>
              </div>

              <!-- Action buttons -->
              <div class="mt-8 flex flex-wrap gap-3 animate-slide-in-right animation-delay-300 justify-center">
                <Button 
                  v-if="primaryAction" 
                  size="lg" 
                  variant="default"
                  class="group relative overflow-hidden bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary shadow-lg hover:shadow-primary/50 transition-all duration-300"
                  @click="onPrimaryAction"
                  @keydown.enter.prevent="onPrimaryAction"
                >
                  <span class="relative z-10">{{ primaryAction }}</span>
                  <div class="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                </Button>
                <Button 
                  v-if="secondaryAction" 
                  size="lg" 
                  variant="outline"
                  class="hover:bg-white/10 transition-all duration-300"
                  @click="emit('secondary')"
                >
                  {{ secondaryAction }}
                </Button>
              </div>

              <!-- Keyboard hint -->
              <div v-if="primaryAction" class="mt-6 flex items-center gap-2 text-xs text-muted-foreground/70 animate-slide-in-right animation-delay-400 justify-center">
                <KbdGroup>
                  <Kbd>Enter</Kbd>
                </KbdGroup>
                <span>{{ t('inventory_hint_enter') }} {{ primaryAction?.toLowerCase() || 'confirm' }}</span>
                <span class="mx-2">•</span>
                <KbdGroup>
                  <Kbd>Esc</Kbd>
                </KbdGroup>
                <span>{{ t('inventory_hint_esc') }}</span>
              </div>

              <!-- Decorative lines -->
              <div class="pointer-events-none absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
              <div class="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@argon/ui/dialog'
import { VisuallyHidden } from '@argon/ui/visually-hidden'
import { Button } from '@argon/ui/button'
import Kbd from '@/components/kbd/Kbd.vue'
import KbdGroup from '@/components/kbd/KbdGroup.vue'
import ItemGrantEffect from './ItemGrantEffect.vue'
import { useLocale } from '@/store/localeStore'

export interface ItemDef { 
  id: string; 
  desc: string; 
  name: string; 
  class: string; 
  size: number; 
  icon: string;
  usable?: boolean;
  giftable?: boolean;
}

const props = withDefaults(defineProps<{
  title?: string
  secondaryAction?: string
  primaryAction?: string
  modelValue?: boolean
  item?: ItemDef | null
  videoSrc?: string
  poster?: string
  getCardClass: (clazz: string | null) => string
  showVideo?: boolean
}>(), {
  primaryAction: undefined,
  showVideo: true
})

const { t } = useLocale()
const computedTitle = computed(() => props.title || t('inventory_item_received'))

const emit = defineEmits<{ 
  (e: 'update:modelValue', v: boolean): void; 
  (e: 'primary'): void; 
  (e: 'secondary'): void 
}>()

const open = ref(!!props.modelValue)
watch(() => props.modelValue, v => (open.value = !!v))
watch(open, v => emit('update:modelValue', v))

// Keyboard shortcuts
function onPrimaryAction() {
  emit('primary')
  open.value = false
}

function onEscape() {
  open.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (!open.value) return
  
  if (e.key === 'Enter' && props.primaryAction) {
    e.preventDefault()
    onPrimaryAction()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

// Styling
const glowClass = computed(() => ({
  common: 'bg-gray-300/40',
  rare: 'bg-blue-400/50',
  epic: 'bg-purple-400/50',
  legendary: 'bg-amber-400/60',
  relic: 'bg-pink-400/60',
  ancient: 'bg-pink-300/50',
} as Record<string, string>)[props.item?.class ?? 'common'])

const borderGradientClass = computed(() => ({
  common: 'from-gray-500 via-gray-300 via-50% to-gray-500',
  rare: 'from-blue-500 via-cyan-400 via-50% to-blue-500',
  epic: 'from-purple-500 via-fuchsia-400 via-50% to-purple-500',
  legendary: 'from-amber-500 via-yellow-400 via-50% to-amber-500',
  relic: 'from-pink-500 via-purple-400 via-50% to-pink-500',
  ancient: 'from-pink-400 via-purple-300 via-50% to-pink-400',
} as Record<string, string>)[props.item?.class ?? 'common'])

const rayColor = computed(() => ({
  common: '#9ca3af',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
  relic: '#ec4899',
  ancient: '#f9a8d4',
} as Record<string, string>)[props.item?.class ?? 'common'])
</script>
<style lang="css" scoped>
/* Animated shine effect for gradients */
@keyframes gold-shine {
  0% { background-position: 0% center; }
  100% { background-position: 200% center; }
}

.animate-gold-shine {
  animation: gold-shine 3s linear infinite;
  background-size: 200% auto;
}

/* Flicker effect for item image */
@keyframes flicker {
  0%, 100% {
    opacity: 1;
    filter: drop-shadow(0 0 12px rgba(255, 255, 200, 0.6));
  }
  45% {
    opacity: 0.92;
    filter: drop-shadow(0 0 18px rgba(255, 255, 200, 1));
  }
  60% {
    opacity: 0.96;
    filter: drop-shadow(0 0 14px rgba(255, 180, 100, 0.8));
  }
  80% {
    opacity: 1;
    filter: drop-shadow(0 0 16px rgba(255, 200, 150, 0.9));
  }
}

.animate-flicker {
  animation: flicker 3s infinite ease-in-out;
}

/* Floating animation */
@keyframes float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-12px) scale(1.02); }
}

.animate-float {
  animation: float 5s ease-in-out infinite;
}

/* Pulse glow effect */
@keyframes pulse-glow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.1); }
}

.animate-pulse-glow {
  animation: pulse-glow 3s ease-in-out infinite;
}

/* Slow pulse for background */
@keyframes pulse-slow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 0.8; }
}

.animate-pulse-slow {
  animation: pulse-slow 4s ease-in-out infinite;
}

/* Slide in animations */
@keyframes slide-in-right {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.animate-slide-in-right {
  animation: slide-in-right 0.5s ease-out forwards;
}

.animation-delay-100 {
  animation-delay: 0.1s;
  opacity: 0;
}

.animation-delay-200 {
  animation-delay: 0.2s;
  opacity: 0;
}

.animation-delay-300 {
  animation-delay: 0.3s;
  opacity: 0;
}

.animation-delay-400 {
  animation-delay: 0.4s;
  opacity: 0;
}

/* Dialog entrance animation */
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes zoom-in-95 {
  from { transform: scale(0.95); }
  to { transform: scale(1); }
}

.animate-in {
  animation: fade-in 0.3s ease-out, zoom-in-95 0.3s ease-out;
}

/* Shimmer effect for button */
.group:hover .shimmer {
  animation: shimmer 0.7s ease-in-out;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Animated gradient border spin */
@keyframes border-spin {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

.animate-border-spin {
  background-size: 200% 200%;
  animation: border-spin 3s ease-in-out infinite;
}

/* Radial pulse animation for dramatic effect */
@keyframes radial-pulse {
  0%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.2);
  }
}

.animate-radial-pulse {
  animation: radial-pulse 3s ease-in-out infinite;
}

/* Faster pulse for extra glow layers */
@keyframes pulse-glow-fast {
  0%, 100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
}

.animate-pulse-glow-fast {
  animation: pulse-glow-fast 1.5s ease-in-out infinite;
}
</style>