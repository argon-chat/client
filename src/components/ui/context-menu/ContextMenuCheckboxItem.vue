<script setup lang="ts">
import { cn } from "@/lib/utils";
import { Check } from "lucide-vue-next";
import {
  ContextMenuCheckboxItem,
  type ContextMenuCheckboxItemEmits,
  type ContextMenuCheckboxItemProps,
  ContextMenuItemIndicator,
  useForwardPropsEmits,
} from "radix-vue";
import { computed, type HTMLAttributes } from "vue";

const props = defineProps<
  ContextMenuCheckboxItemProps & { class?: HTMLAttributes["class"] }
>();
const emits = defineEmits<ContextMenuCheckboxItemEmits>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <ContextMenuCheckboxItem
    v-bind="forwarded"
    :class="cn(
      'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      props.class,
    )"
  >
    <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuItemIndicator>
        <Check class="h-4 w-4" />
      </ContextMenuItemIndicator>
    </span>
    <slot />
  </ContextMenuCheckboxItem>
</template>
