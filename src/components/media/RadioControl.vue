<template>
  <div v-if="visible" class="radio-control" data-testid="radio-control">
    <span class="radio-status" :data-state="state">
      <span class="radio-dot" aria-hidden="true" />
      {{ statusText }}
    </span>
    <button
      type="button"
      class="radio-hold"
      :class="{ 'radio-hold--on': radio.transmitting }"
      :disabled="!radio.available"
      :aria-pressed="radio.transmitting"
      data-testid="radio-hold"
      @pointerdown="onDown"
      @pointerup="release"
      @pointercancel="release"
      @pointerleave="release"
      @blur="release"
      @contextmenu.prevent
    >
      <RadioTowerIcon class="w-4 h-4 shrink-0" />
      <span>{{ radio.transmitting ? t("radio_on_air") : t("radio_hold_to_talk") }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * The radio's status and on-screen key, for a member of a broadcast channel who may transmit.
 *
 * The key is a hold: down transmits, and anything that ends the hold — the pointer going up,
 * being cancelled or leaving, the button losing focus, the window blurring or the tab hiding —
 * releases it. The pointer is captured on the button so a drag off it still ends on it. Every
 * platform gets the button (a desktop user may click it too); mobile layouts get nothing, they
 * listen only (decision 16).
 */
import { computed, onUnmounted, ref, watch } from "vue";
import { liveQuery, type Subscription } from "dexie";
import { RadioTowerIcon } from "lucide-vue-next";
import { logger } from "@argon/core";
import type { ArgonChannel } from "@argon/glue";
import { db } from "@/store/db/dexie";
import { isMobileLayout } from "@/lib/platform";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useLocale } from "@/store/system/localeStore";
import { useCallPermissions } from "@/composables/useCallPermissions";

const voice = useUnifiedCall();
const pool = usePoolStore();
const { t } = useLocale();
const { canBroadcast } = useCallPermissions();

const radio = computed(() => voice.radio);
const mobile = isMobileLayout();

// The channel I am in, followed live: the mode can go on or off while I sit there.
const channel = ref<ArgonChannel | null>(null);
let sub: Subscription | null = null;
watch(
  () => voice.connectedVoiceChannelId,
  (id) => {
    sub?.unsubscribe();
    sub = null;
    channel.value = null;
    if (!id) return;
    sub = liveQuery(() => db.channels.get(id)).subscribe({
      next: (row) => (channel.value = row ?? null),
      error: (e) => logger.error("[RadioControl] channel query failed", e),
    });
  },
  { immediate: true },
);

const visible = computed(
  () => !mobile && voice.mode === "channel" && channel.value?.broadcast != null && canBroadcast.value,
);

type State = "on_air" | "busy" | "connecting" | "ready" | "unavailable";

const state = computed<State>(() => {
  const r = radio.value;
  if (r.transmitting) return "on_air";
  if (r.busyBy) return "busy";
  if (r.connecting) return "connecting";
  if (r.available) return "ready";
  return r.unavailableReason ? "unavailable" : "connecting";
});

const busyName = computed(() => {
  const userId = radio.value.busyBy;
  const channelId = voice.connectedVoiceChannelId;
  if (!userId || !channelId) return "";
  return pool.realtimeChannelUsers.get(channelId)?.Users.get(userId)?.User.displayName ?? "…";
});

const statusText = computed(() => {
  switch (state.value) {
    case "on_air": return t("radio_on_air");
    case "busy": return t("radio_busy", { name: busyName.value });
    case "ready": return t("radio_ready");
    case "unavailable": return t(`radio_unavailable_${radio.value.unavailableReason}`);
    default: return t("radio_connecting");
  }
});

// ── The key ──

let held = false;

function onDown(e: PointerEvent) {
  if (e.button !== 0 || !radio.value.available || held) return;
  e.preventDefault();
  try {
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  } catch {
    // No active pointer of that id (a synthetic event, a pointer already gone): the hold still
    // ends on pointerup/leave/blur without the capture.
  }
  held = true;
  voice.radioKeyDown();
}

function release() {
  if (!held) return;
  held = false;
  voice.radioKeyUp();
}

const onHidden = () => {
  if (document.visibilityState === "hidden") release();
};
window.addEventListener("blur", release);
document.addEventListener("visibilitychange", onHidden);

// The radio went away under a held key (mode off, right revoked): let go.
watch(() => radio.value.available, (available) => {
  if (!available) release();
});

onUnmounted(() => {
  release();
  sub?.unsubscribe();
  window.removeEventListener("blur", release);
  document.removeEventListener("visibilitychange", onHidden);
});
</script>

<style scoped>
.radio-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}

.radio-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: calc(var(--radius) - 4px);
  background: hsl(var(--card) / 0.85);
  border: 1px solid hsl(var(--border) / 0.3);
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.radio-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}

.radio-status[data-state="ready"] .radio-dot { background: hsl(142 71% 45%); opacity: 1; }
.radio-status[data-state="on_air"] { color: hsl(0 84% 60%); }
.radio-status[data-state="on_air"] .radio-dot { background: hsl(0 84% 60%); opacity: 1; }
.radio-status[data-state="busy"] { color: hsl(38 92% 50%); }
.radio-status[data-state="unavailable"] { color: hsl(var(--muted-foreground)); }

.radio-hold {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: calc(var(--radius) - 2px);
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.radio-hold:hover:not(:disabled) {
  background: hsl(var(--foreground) / 0.08);
}

.radio-hold:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.radio-hold--on {
  background: hsl(0 84% 60% / 0.18);
  border-color: hsl(0 84% 60% / 0.7);
  color: hsl(0 84% 60%);
}

@media (prefers-reduced-motion: reduce) {
  .radio-hold {
    transition: none;
  }
}
</style>
