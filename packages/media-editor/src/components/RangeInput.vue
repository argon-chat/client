<template>
  <div class="range-input px-4" :class="{ 'range-input--has-value': modelValue !== 0, '!px-0': compact }">
    <div v-if="!compact" class="flex items-center justify-between mb-3 text-sm font-medium">
      <span>{{ label }}</span>
      <span class="text-muted-foreground" :class="{ '!text-primary': modelValue !== 0 }">{{ displayValue }}</span>
    </div>
    <div
      class="relative h-1 rounded-sm cursor-pointer touch-none py-2.5"
      ref="trackEl"
      @pointerdown="startDrag"
    >
      <div class="absolute h-1 rounded-sm bg-muted-foreground/15 left-0 w-full top-2.5" />
      <div
        class="absolute h-1 rounded-sm bg-primary top-2.5"
        :style="progressStyle"
      />
      <div
        class="range-input__thumb pointer-events-none absolute size-5 top-1/2 rounded-full -translate-x-1/2 -translate-y-1/2 bg-primary active:size-6"
        :style="{ left: `calc((100% - 20px) * ${normalized} + 10px)` }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { clamp } from '../geometry';

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

const normalized = computed(() => {
  return (props.modelValue - props.min) / (props.max - props.min);
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

function startDrag(e: PointerEvent) {
  if (!trackEl.value) return;
  trackEl.value.setPointerCapture(e.pointerId);

  const update = (ev: PointerEvent) => {
    if (!trackEl.value) return;
    const rect = trackEl.value.getBoundingClientRect();
    const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
    const value = props.min + x * (props.max - props.min);
    emit('update:modelValue', Math.round(value * 100) / 100);
  };

  update(e);

  const onMove = (ev: PointerEvent) => update(ev);
  const onUp = () => {
    trackEl.value?.removeEventListener('pointermove', onMove);
    trackEl.value?.removeEventListener('pointerup', onUp);
  };

  trackEl.value.addEventListener('pointermove', onMove);
  trackEl.value.addEventListener('pointerup', onUp);
}
</script>

<style scoped>
.range-input__thumb {
  transition: width 0.1s, height 0.1s;
}
</style>
