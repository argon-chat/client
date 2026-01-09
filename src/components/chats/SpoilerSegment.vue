<template>
    <span 
        class="spoiler" 
        :class="{ 'spoiler--revealed': isRevealed }"
        @click="toggleReveal"
    >{{ props.text }}</span>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { IMessageEntity } from "@argon/glue";

const props = defineProps<{
    entity: IMessageEntity;
    text: string;
}>();

const isRevealed = ref(false);

function toggleReveal() {
    isRevealed.value = !isRevealed.value;
}
</script>

<style scoped>
.spoiler {
    display: inline;
    cursor: pointer;
    border-radius: 4px;
    padding: 0 2px;
    transition: all 0.2s ease;
    background: hsl(var(--foreground) / 0.8);
    color: transparent;
    user-select: none;
}

.spoiler:hover {
    background: hsl(var(--foreground) / 0.6);
}

.spoiler--revealed {
    background: hsl(var(--muted));
    color: inherit;
    user-select: auto;
}

.spoiler--revealed:hover {
    background: hsl(var(--muted) / 0.8);
}
</style>
