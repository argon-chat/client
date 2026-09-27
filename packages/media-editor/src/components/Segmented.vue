<template>
  <div class="flex gap-0.5 p-0.5 rounded-lg bg-muted" role="radiogroup">
    <button
      v-for="option in options"
      :key="option.value"
      role="radio"
      :aria-checked="modelValue === option.value"
      class="flex-1 py-1.5 px-2 rounded-md border-none text-xs font-medium cursor-pointer transition-colors duration-150"
      :class="modelValue === option.value ? 'bg-background text-foreground shadow-sm' : 'bg-transparent text-muted-foreground hover:text-foreground'"
      :data-value="option.value"
      @click="emit('update:modelValue', option.value)"
    >{{ option.label }}</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ options: { value: string; label: string }[]; modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();
</script>
