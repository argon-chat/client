<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { X } from "lucide-vue-next"
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "@argon/core"
import DialogOverlay from "./DialogOverlay.vue"

defineOptions({
  inheritAttrs: false,
})

/**
 * `described` says this dialog renders a `DialogDescription`.
 *
 * Reka points `aria-describedby` at a description id whether or not anything carries that id, and
 * then warns — on every open — that the description is missing. Most dialogs have no description to
 * give: a prompt with two buttons is its own explanation. For those the attribute is dropped, which
 * is what "no description" is supposed to look like to a screen reader, and the warning goes with
 * it. Dialogs that do render one set this, and keep the link.
 */
const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes["class"], described?: boolean }>(), {
  described: false,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, "class", "described")

const describedBy = computed(() => (props.described ? {} : { "aria-describedby": undefined }))

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="grid place-items-center overflow-y-auto py-8">
      <DialogContent
        :class="
          cn(
            'relative z-50 grid w-full max-w-lg gap-4 border border-border bg-background p-6 shadow-lg duration-200 sm:rounded-lg md:w-full data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:pointer-events-none',
            props.class,
          )
        "
        v-bind="{ ...$attrs, ...forwarded, ...describedBy }"
        @pointer-down-outside="(event) => {
          const originalEvent = event.detail.originalEvent;
          const target = originalEvent.target as HTMLElement;
          if (originalEvent.offsetX > target.clientWidth || originalEvent.offsetY > target.clientHeight) {
            event.preventDefault();
          }
        }"
      >
        <slot />

        <DialogClose
          class="absolute top-4 right-4 p-0.5 transition-colors rounded-md hover:bg-secondary"
        >
          <X class="w-4 h-4" />
          <span class="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>