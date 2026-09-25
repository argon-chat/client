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
import DialogOverlay from "./DialogOverlay.vue"
import { DIALOG_CONTENT_BASE_CLASS, DIALOG_FRAME_CLASS, dialogContentClass, dialogGuardStyle } from "./constraints"

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
 *
 * `maxHeight` lowers the height cap (e.g. "80vh"); `max-h-*` classes are ignored, see constraints.ts.
 */
const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes["class"], showCloseButton?: boolean, titlebarSafe?: boolean, described?: boolean, maxHeight?: string }>(), {
  showCloseButton: true,
  titlebarSafe: false,
  described: false,
})
const emits = defineEmits<DialogContentEmits>()

// When titlebarSafe, keep the overlay + frame below the OS titlebar so the window
// controls stay visible and clickable. Driven by --app-titlebar-height (0 when there's
// no titlebar), so this is inert unless a host titlebar is actually present.
const delegatedProps = reactiveOmit(props, "class", "titlebarSafe", "described", "showCloseButton", "maxHeight")

// The key has to be present and undefined: Vue then renders no attribute at all, which is the
// only form reka reads as "there is deliberately no description".
const describedBy = computed(() => (props.described ? {} : { "aria-describedby": undefined }))

const contentClass = computed(() => dialogContentClass(DIALOG_CONTENT_BASE_CLASS, props.class))
const guardStyle = computed(() => dialogGuardStyle(props.maxHeight))
const titlebarOffset = computed(() => (props.titlebarSafe ? { top: "var(--app-titlebar-height, 0px)" } : undefined))

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay :style="titlebarOffset" />
    <div data-slot="dialog-frame" :class="DIALOG_FRAME_CLASS" :style="titlebarOffset">
      <DialogContent
        data-slot="dialog-content"
        v-bind="{ ...$attrs, ...forwarded, ...describedBy }"
        :class="contentClass"
        :style="guardStyle"
      >
        <slot />

        <DialogClose
          v-if="showCloseButton"
          data-slot="dialog-close"
          class="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <X />
          <span class="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </div>
  </DialogPortal>
</template>
