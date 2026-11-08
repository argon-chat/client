<template>
  <div class="range-input px-4" :class="{ 'range-input--has-value': modelValue !== 0, '!px-0': compact }">
    <div v-if="!compact" class="flex items-center justify-between mb-3 text-sm font-medium">
      <span>{{ label }}</span>
      <span class="text-muted-foreground" :class="{ '!text-primary': modelValue !== 0 }">{{ displayValue }}</span>
    </div>
    <div
      class="range-input__track relative h-1 rounded-sm cursor-pointer touch-none select-none py-2.5"
      ref="trackEl"
      @pointerdown="startDrag"
    >
      <div class="absolute h-1 rounded-sm bg-muted-foreground/15 left-0 w-full top-2.5" />
      <div
        class="absolute h-1 rounded-sm bg-primary top-2.5"
        :style="progressStyle"
      />
      <div
        class="range-input__thumb pointer-events-none absolute size-5 top-1/2 rounded-full -translate-x-1/2 -translate-y-1/2 bg-primary"
        :style="{ left: `calc((100% - 20px) * ${normalized} + 10px)` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue';
import { clamp } from '../geometry';
import { MEDIA_EDITOR_INJECTION_KEY } from '../composables/useMediaEditorContext';

const props = withDefaults(defineProps<{
  modelValue: number;
  label?: string;
  min?: number;
  max?: number;
  to100?: boolean;
  compact?: boolean;
}>(), {
  label: '',
  min: -1,
  max: 1,
  to100: false,
  compact: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void;
}>();

const trackEl = ref<HTMLDivElement | null>(null);
// A drag is one history entry, and Esc puts the value back.
const editor = inject(MEDIA_EDITOR_INJECTION_KEY, null);

const normalized = computed(() => {
  return props.max > props.min ? clamp((props.modelValue - props.min) / (props.max - props.min), 0, 1) : 0;
});

const displayValue = computed(() => {
  if (props.to100) return Math.round(props.modelValue * 100);
  return Math.round(props.modelValue * 100);
});

const progressStyle = computed(() => {
  const n = normalized.value;
  if (props.min >= 0) {
    // 0 to max (e.g., vignette, grain)
    return { left: '0%', width: `${n * 100}%` };
  }
  // Centered (-1 to 1)
  const center = 0.5;
  if (n >= center) {
    return {
      left: `${center * 100}%`,
      width: `${(n - center) * 100}%`
    };
  }
  return {
    left: `${n * 100}%`,
    width: `${(center - n) * 100}%`
  };
});

let finishDrag: ((cancel?: boolean) => void) | null = null;
onBeforeUnmount(() => finishDrag?.(true));

function startDrag(e: PointerEvent) {
  const el = trackEl.value;
  if (!el || e.button !== 0 || e.isPrimary === false) return;
  e.preventDefault();
  finishDrag?.();
  const pointerId = e.pointerId;
  // Read geometry once for the gesture; a value update must not force layout
  // on every pointermove (particularly expensive in the native renderer).
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return;
  let stopped = false;
  const update = (ev: PointerEvent) => {
    const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    const value = props.min + x * (props.max - props.min);
    emit('update:modelValue', Math.round(value * 100) / 100);
  };
  const detach = () => {
    if (stopped) return;
    stopped = true;
    finishDrag = null;
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('lostpointercapture', onLostCapture);
    window.removeEventListener('blur', onBlur);
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  };
  const gesture = editor?.store.beginGesture({ onCancel: detach });
  const finish = (cancel = false) => {
    if (stopped) return;
    detach();
    if (cancel) gesture?.cancel();
    else gesture?.end();
  };
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    // Recover a release the OS sent elsewhere, without applying the cursor's
    // re-entry position as another value change.
    if ((ev.buttons & 1) === 0) return finish();
    update(ev);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    update(ev);
    finish();
  };
  const onCancel = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(true); };
  const onLostCapture = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish(); };
  const onBlur = () => finish(true);
  finishDrag = finish;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('lostpointercapture', onLostCapture);
  window.addEventListener('blur', onBlur);
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // A synthetic event has no active platform pointer.
  }
  update(e);
}

</script>
