<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
    class?: HTMLAttributes["class"]
}>()
</script>

<template>
    <kbd :class="cn(
        'bg-muted text-muted-foreground pointer-events-none inline-flex h-7 w-fit min-w-7 items-center justify-center gap-1 rounded-sm px-1 font-mono text-5xl font-medium select-none',
        '[&_svg:not([class*=\'size-\'])]:size-',
        '[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10',
        props.class,
    )">
        <slot />
    </kbd>
</template>