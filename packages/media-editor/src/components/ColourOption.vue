<template>
  <div class="flex items-center gap-1.5 shrink-0">
    <label
      class="relative size-7 rounded-md border border-border cursor-pointer overflow-hidden"
      :style="{ backgroundColor: modelValue }"
      :title="label"
    >
      <input
        type="color"
        class="absolute inset-0 opacity-0 cursor-pointer"
        :value="modelValue"
        :aria-label="label"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <button
      class="size-7 rounded-md border cursor-pointer flex items-center justify-center transition-colors"
      :class="picking ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground bg-transparent hover:text-foreground'"
      :aria-pressed="picking"
      :title="pickLabel"
      :aria-label="pickLabel"
      data-pick-colour
      @click="emit('pick')"
    >
      <Pipette :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Pipette } from 'lucide-vue-next';

defineProps<{ label: string; pickLabel: string; modelValue: string; picking: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'pick'): void }>();
</script>
