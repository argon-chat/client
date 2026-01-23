<!-- @fallthroughAttributes true -->
<!-- @strictTemplates true -->

<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@argon/core';

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
    <!-- @vue-skip -->
    <option data-slot="native-select-option" :class="cn('bg-popover text-popover-foreground', props.class)">
        <slot />
    </option>
</template>