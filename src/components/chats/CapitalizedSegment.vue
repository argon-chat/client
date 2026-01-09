<template>
    <span class="capitalized">{{ capitalizedText }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { IMessageEntity } from "@argon/glue";

const props = defineProps<{
    entity: IMessageEntity;
    text: string;
}>();

const capitalizedText = computed(() => props.text.toUpperCase());
</script>

<style scoped>
.capitalized {
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.05em;
}
</style>
