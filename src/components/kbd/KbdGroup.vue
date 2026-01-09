<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@argon/core"

const props = defineProps<{
    class?: HTMLAttributes["class"]
}>()
</script>

<template>
    <kbd data-slot="kbd-group" :class="cn('inline-flex items-center gap-0', props.class)">
        <slot />
    </kbd>
</template>