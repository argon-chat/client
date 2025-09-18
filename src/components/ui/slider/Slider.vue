<script setup lang="ts">
import type { SliderRootEmits, SliderRootProps } from "radix-vue";
import type { HTMLAttributes } from "vue";
import { cn } from "@/lib/utils";
import {
  SliderRange,
  SliderRoot,
  SliderThumb,
  SliderTrack,
  useForwardPropsEmits,
} from "radix-vue";
import { computed } from "vue";

const props = defineProps<
  SliderRootProps & {
    class?: HTMLAttributes["class"];
    trackClass?: string;
    rangeClass?: string;
    thumbClass?: string;
  }
>();
const emits = defineEmits<SliderRootEmits | {
    dblclick: void;
}>();

const delegatedProps = computed(() => {
  const { class: _, trackClass: __, rangeClass: ___, thumbClass: ____, ...delegated } =
    props;
  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <SliderRoot
    :class="cn(
      'relative flex w-full touch-none select-none items-center data-[orientation=vertical]:flex-col data-[orientation=vertical]:w-2 data-[orientation=vertical]:h-full',
      props.class,
    )"
    v-bind="forwarded"
    @dblclick="$emit('dblclick')"
  >
    <SliderTrack
      :class="cn(
        'relative h-2 w-full data-[orientation=vertical]:w-2 grow overflow-hidden rounded-full bg-secondary',
        props.trackClass
      )"
    >
      <SliderRange
        :class="cn(
          'absolute h-full data-[orientation=vertical]:w-full bg-primary',
          props.rangeClass
        )"
      />
    </SliderTrack>
    <SliderThumb
      v-for="(_, key) in modelValue"
      :key="key"
      :class="cn(
        'block h-5 w-5 rounded-full border-2 border-primary bg-background disabled:pointer-events-none disabled:opacity-50',
        props.thumbClass
      )"
    />
  </SliderRoot>
</template>
