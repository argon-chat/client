<script setup lang="ts">
import { cn } from "@/lib/utils";
import { ToastViewport, type ToastViewportProps } from "radix-vue";
import { computed, type HTMLAttributes } from "vue";

const props = defineProps<
  ToastViewportProps & { class?: HTMLAttributes["class"] }
>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <ToastViewport v-bind="delegatedProps" :class="cn('fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]', props.class)" />
</template>
