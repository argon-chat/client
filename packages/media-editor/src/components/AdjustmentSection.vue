<template>
  <div class="border-t border-border/50 mt-1 pt-1">
    <button
      class="w-full flex items-center gap-2 px-4 py-2 bg-transparent border-none cursor-pointer text-left"
      @click="open = !open"
    >
      <ChevronRight :size="14" class="text-muted-foreground transition-transform duration-150" :class="{ 'rotate-90': open }" />
      <span class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{{ title }}</span>
    </button>
    <Transition name="section-expand">
      <div v-show="open" class="overflow-hidden">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ChevronRight } from 'lucide-vue-next';

const props = withDefaults(defineProps<{
  title: string;
  initiallyOpen?: boolean;
}>(), { initiallyOpen: false });

const open = ref(props.initiallyOpen);
</script>

<style scoped>
.section-expand-enter-active,
.section-expand-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s ease;
  max-height: 500px;
}
.section-expand-enter-from,
.section-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
