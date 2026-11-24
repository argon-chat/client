<template>
    <div :class="cn(
        'island fixed top-5 -translate-x-1/2 left-1/2 z-[999] cursor-pointer overflow-hidden rounded-xl font-medium',
        props.class,
    )" @click="open = !open">
        <header class="flex h-11 items-center gap-2 px-4">
            <slot name="icon">
                <Loader2 :size="20" class="animate-spin" style="color: wheat;" />
            </slot>
            <h1 class="grow text-center font-bold" style="color: wheat;">{{ props.title }}</h1>
        </header>
        <div v-if="open && slots.default" class="mb-2 flex max-h-60 flex-col gap-1 overflow-y-auto px-4 text-sm text-secondary">
            <slot />
        </div>
    </div>
</template>

<script lang="ts" setup>
import { cn } from "@argon/core";
import { Loader2 } from "lucide-vue-next";
import { ref, useSlots } from "vue";

const props = withDefaults(defineProps<{ class?: string; title?: string }>(), {
  class: "",
  title: "Progress",
});
const open = ref(false);
const slots = useSlots();
</script>
<style scoped>
.island {
    width: 260px;
    background: #121213;
    border: 1.5px solid hsl(270 100% 63%);
}
</style>
