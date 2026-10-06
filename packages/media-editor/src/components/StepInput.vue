<template>
  <div class="px-4 py-2">
    <div class="flex items-center justify-between mb-2">
      <label :for="inputId" class="text-[13px] font-medium text-foreground">{{ label }}</label>
      <span class="text-xs text-muted-foreground tabular-nums">{{ currentStep?.label }}</span>
    </div>
    <div class="step-input relative h-5">
      <div class="step-input__track absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/25" />
      <div
        class="step-input__fill absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-primary"
        :style="{ width: `calc((100% - ${THUMB}px) * ${fraction})` }"
      />
      <div
        v-for="(_, i) in steps"
        :key="i"
        class="step-input__dot absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        :class="i <= stepIndex ? 'bg-primary' : 'bg-muted-foreground/40'"
        :style="{ left: `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${dotAt(i)})` }"
      />
      <input
        :id="inputId"
        type="range"
        :min="0"
        :max="Math.max(0, steps.length - 1)"
        step="1"
        :value="stepIndex"
        :aria-valuetext="currentStep?.label"
        class="step-input__range absolute inset-0 w-full h-full m-0 appearance-none bg-transparent cursor-pointer"
        @input="onInput"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import { clamp } from '../geometry';

export interface StepInputStep<T = any> {
  value: T;
  label: string;
}

const props = defineProps<{
  label: string;
  modelValue: number;
  steps: StepInputStep[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

/** The thumb's diameter: the track runs between its centres at either end, as the native input moves it. */
const THUMB = 20;

const inputId = useId();

const stepIndex = computed(() => {
  const idx = props.steps.findIndex(s => s.value === props.modelValue);
  return idx >= 0 ? idx : 0;
});

const currentStep = computed(() => props.steps[stepIndex.value]);

const dotAt = (i: number) => (props.steps.length > 1 ? i / (props.steps.length - 1) : 0);
const fraction = computed(() => dotAt(stepIndex.value));

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  const idx = clamp(Math.round(target.valueAsNumber), 0, props.steps.length - 1);
  emit('update:modelValue', props.steps[idx].value);
}
</script>

<style scoped>
.step-input__track {
  left: 10px;
  right: 10px;
}

.step-input__fill {
  left: 10px;
}

.step-input__range {
  outline: none;
}

.step-input__range::-webkit-slider-runnable-track {
  height: 20px;
  background: transparent;
}

.step-input__range::-moz-range-track {
  height: 20px;
  background: transparent;
}

.step-input__range::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.18), 0 1px 3px rgb(0 0 0 / 0.28);
  transition: transform 120ms ease-out, box-shadow 120ms ease-out;
}

.step-input__range::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 9999px;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.18), 0 1px 3px rgb(0 0 0 / 0.28);
  transition: transform 120ms ease-out, box-shadow 120ms ease-out;
}

.step-input__range:hover::-webkit-slider-thumb {
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.32);
}

.step-input__range:hover::-moz-range-thumb {
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.32);
}

.step-input__range:active::-webkit-slider-thumb {
  transform: scale(1.1);
}

.step-input__range:active::-moz-range-thumb {
  transform: scale(1.1);
}

.step-input__range:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
}

.step-input__range:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
}

@media (prefers-reduced-motion: reduce) {
  .step-input__range::-webkit-slider-thumb {
    transition: none;
  }

  .step-input__range::-moz-range-thumb {
    transition: none;
  }
}
</style>
