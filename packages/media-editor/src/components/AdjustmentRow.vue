<template>
  <div class="group px-4 py-1.5 rounded-lg transition-colors hover:bg-accent/30">
    <div class="flex items-center gap-2.5 mb-1.5">
      <component :is="icon" :size="15" class="shrink-0 transition-colors" :class="value !== 0 ? 'text-primary' : 'text-muted-foreground/60'" />
      <span class="text-[12.5px] font-medium text-foreground/90 flex-1 select-none">{{ label }}</span>
      <button
        v-if="value !== 0"
        class="opacity-0 group-hover:opacity-100 text-[10px] text-muted-foreground hover:text-foreground bg-muted/80 px-1.5 py-0.5 rounded cursor-pointer border-none transition-opacity"
        @click="$emit('reset')"
      >×</button>
      <span
        class="text-[11px] tabular-nums min-w-[28px] text-right font-medium transition-colors"
        :class="value !== 0 ? 'text-primary' : 'text-muted-foreground/40'"
      >{{ displayValue }}</span>
    </div>
    <RangeInput
      :model-value="value"
      :min="bipolar ? -1 : 0"
      :max="1"
      :to100="!bipolar"
      compact
      @update:model-value="$emit('update', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import RangeInput from './RangeInput.vue';

const props = defineProps<{
  label: string;
  icon: Component;
  value: number;
  bipolar?: boolean;
}>();

defineEmits<{
  update: [value: number];
  reset: [];
}>();

const displayValue = computed(() => {
  if (props.value === 0) return '';
  const v = Math.round(props.value * 100);
  if (props.bipolar) return (v > 0 ? '+' : '') + v;
  return v;
});
</script>
