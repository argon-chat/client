<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Primitive, type PrimitiveProps } from 'radix-vue'
import { type ButtonVariants, buttonVariants } from '.'
import { cn } from '@/lib/utils'
import { LockKeyholeIcon } from 'lucide-vue-next'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
  disabled?: boolean,
  clearCss?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  disabled: false,
})
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="props.clearCss ? props.class : cn(
      buttonVariants({ variant, size }),
      props.class,
      props.disabled ? 'opacity-50 cursor-not-allowed relative' : ''
    )"
    :disabled="props.disabled"
  >
    <slot />

    <template v-if="props.disabled">
      <div
        class="absolute right-[28px] top-0 bottom-0 w-[3px] bg-gradient-to-b from-red-300 to-red-600 rounded-full pointer-events-none"
      ></div>

      <div
        class="absolute right-[18px] top-1/2 transform -translate-y-1/2 w-6 h-6 bg-red-700 text-white rounded-full shadow-lg flex items-center justify-center"
      >
      <LockKeyholeIcon class="w-4 h-4" />

      </div>
    </template>
  </Primitive>
</template>