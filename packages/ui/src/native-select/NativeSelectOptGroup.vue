<!-- @fallthroughAttributes true -->
<!-- @strictTemplates true -->

<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
    <!-- @vue-skip -->
    <optgroup data-slot="native-select-optgroup" :class="cn('bg-popover text-popover-foreground', props.class)">
        <slot />
    </optgroup>
</template>