<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { usePoolStore } from "@/store/data/poolStore";
import { PhoneOffIcon } from "lucide-vue-next";
import { createDialTone } from "@/lib/audio/AudioManager";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{
  peerId: string;
}>();

const emit = defineEmits<{
  (e: "cancel"): void;
}>();

const pool = usePoolStore();
const { t } = useLocale();

const peerUser = pool.getUserReactive(computed(() => props.peerId));
const displayName = computed(() => peerUser.value?.displayName ?? "...");

// Elapsed timer
const elapsed = ref(0);
let timerInterval: ReturnType<typeof setInterval> | null = null;

const elapsedText = computed(() => {
  const s = elapsed.value;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return mins > 0
    ? `${mins}:${String(secs).padStart(2, "0")}`
    : `0:${String(secs).padStart(2, "0")}`;
});

// Dial tone
let dialTone: ReturnType<typeof createDialTone> | null = null;

onMounted(() => {
  dialTone = createDialTone();
  timerInterval = setInterval(() => elapsed.value++, 1000);
});

onUnmounted(() => {
  dialTone?.stop();
  dialTone = null;
  if (timerInterval) clearInterval(timerInterval);
});
</script>

<template>
  <div class="call-connecting">
    <div class="connecting-backdrop" />

    <div class="connecting-content">
      <!-- Pulsing rings -->
      <div class="avatar-wrapper">
        <div class="pulse-ring pulse-ring--1" />
        <div class="pulse-ring pulse-ring--2" />
        <div class="pulse-ring pulse-ring--3" />
        <div class="avatar-circle">
          <ArgonAvatar :user-id="peerId" :overrided-size="96" />
        </div>
      </div>

      <!-- Name & status -->
      <div class="connecting-info">
        <span class="connecting-name">{{ displayName }}</span>
        <span class="connecting-status">
          <span class="dot-pulse">
            <span />
            <span />
            <span />
          </span>
          {{ t('calling') || 'Calling' }}
        </span>
        <span class="connecting-elapsed">{{ elapsedText }}</span>
      </div>

      <!-- Cancel button -->
      <button class="cancel-btn" @click="$emit('cancel')">
        <PhoneOffIcon class="w-5 h-5" />
        <span>{{ t('cancel') || 'Cancel' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.call-connecting {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.connecting-backdrop {
  position: absolute;
  inset: 0;
  background: hsl(var(--card) / 0.92);
  backdrop-filter: blur(20px) saturate(1.2);
  animation: backdrop-in 0.4s ease-out both;
}

@keyframes backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.connecting-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  animation: content-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
}

@keyframes content-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* ── Avatar with pulse rings ── */
.avatar-wrapper {
  position: relative;
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid hsl(var(--primary) / 0.15);
  animation: pulse-expand 3s ease-out infinite;
}

.pulse-ring--1 { animation-delay: 0s; }
.pulse-ring--2 { animation-delay: 1s; }
.pulse-ring--3 { animation-delay: 2s; }

@keyframes pulse-expand {
  0% {
    transform: scale(0.6);
    opacity: 0.8;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

.avatar-circle {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  overflow: hidden;
  box-shadow:
    0 0 0 3px hsl(var(--card)),
    0 0 0 5px hsl(var(--primary) / 0.2),
    0 8px 32px hsl(var(--primary) / 0.15);
  animation: avatar-breathe 2.5s ease-in-out infinite;
}

@keyframes avatar-breathe {
  0%, 100% { box-shadow: 0 0 0 3px hsl(var(--card)), 0 0 0 5px hsl(var(--primary) / 0.2), 0 8px 32px hsl(var(--primary) / 0.15); }
  50% { box-shadow: 0 0 0 3px hsl(var(--card)), 0 0 0 7px hsl(var(--primary) / 0.12), 0 12px 40px hsl(var(--primary) / 0.2); }
}

/* ── Info text ── */
.connecting-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.connecting-name {
  font-size: 20px;
  font-weight: 700;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.connecting-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.connecting-elapsed {
  font-size: 13px;
  font-weight: 400;
  color: hsl(var(--muted-foreground) / 0.6);
  font-variant-numeric: tabular-nums;
}

/* ── Dot pulse animation ── */
.dot-pulse {
  display: flex;
  gap: 3px;
  align-items: center;
}

.dot-pulse span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.6);
  animation: dot-bounce 1.4s ease-in-out infinite;
}

.dot-pulse span:nth-child(2) { animation-delay: 0.16s; }
.dot-pulse span:nth-child(3) { animation-delay: 0.32s; }

@keyframes dot-bounce {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

/* ── Cancel button ── */
.cancel-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 12px;
  border: none;
  background: hsl(0 84% 60%);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 12px hsl(0 84% 60% / 0.3);
}

.cancel-btn:hover {
  background: hsl(0 84% 55%);
  transform: translateY(-1px);
  box-shadow: 0 4px 16px hsl(0 84% 60% / 0.4);
}

.cancel-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 8px hsl(0 84% 60% / 0.3);
}
</style>
