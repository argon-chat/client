<template>
  <div class="px-4 py-2">
    <div class="flex items-center justify-between mb-2">
      <span class="text-[13px] font-medium text-foreground">{{ label }}</span>
      <span class="text-xs text-muted-foreground tabular-nums">{{ currentStep?.label }}</span>
    </div>
    <div class="relative">
      <input
        type="range"
        :min="0"
        :max="steps.length - 1"
        step="1"
        :value="stepIndex"
        class="w-full h-1 appearance-none bg-transparent cursor-pointer relative z-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-pointer"
        @input="onInput"
      />
      <div class="absolute top-1/2 -translate-y-1/2 left-0 right-0 flex items-center justify-between pointer-events-none px-[2px]">
        <div
          v-for="(_, i) in steps"
          :key="i"
          class="size-2 rounded-full transition-colors"
          :class="i <= stepIndex ? 'bg-primary' : 'bg-muted-foreground/30'"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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

const stepIndex = computed(() => {
  const idx = props.steps.findIndex(s => s.value === props.modelValue);
  return idx >= 0 ? idx : 0;
});

const currentStep = computed(() => props.steps[stepIndex.value]);

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  const idx = clamp(Math.round(target.valueAsNumber), 0, props.steps.length - 1);
  emit('update:modelValue', props.steps[idx].value);
}
</script>
