<template>
  <div class="px-2">
    <div class="flex items-center justify-between mb-2 text-sm font-medium">
      <span>{{ label }}</span>
      <span class="text-muted-foreground tabular-nums" :class="{ '!text-primary': modelValue > min }">{{ Math.round(modelValue) }}{{ unit }}</span>
    </div>
    <RangeInput
      :model-value="(modelValue - min) / (max - min)"
      :min="0"
      :max="1"
      compact
      @update:model-value="emit('update:modelValue', Math.round(min + $event * (max - min)))"
    />
  </div>
</template>

<script setup lang="ts">
import RangeInput from './RangeInput.vue';

withDefaults(defineProps<{ label: string; modelValue: number; min?: number; max: number; unit?: string }>(), { min: 0, unit: '' });
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>();
</script>
