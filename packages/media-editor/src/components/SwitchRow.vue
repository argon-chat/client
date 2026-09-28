<template>
  <div class="px-2 flex items-center justify-between gap-2 text-sm font-medium">
    <span>{{ label }}</span>
    <div class="flex items-center gap-2">
      <slot />
      <button
        role="switch"
        :aria-checked="modelValue"
        :aria-label="label"
        class="relative w-9 h-5 rounded-full border-none cursor-pointer transition-colors shrink-0"
        :class="modelValue ? 'bg-primary' : 'bg-muted-foreground/30'"
        @click="emit('update:modelValue', !modelValue)"
      >
        <span class="absolute top-0.5 left-0.5 size-4 rounded-full bg-background transition-transform" :class="{ 'translate-x-4': modelValue }" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();
</script>
