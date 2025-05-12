<template>
    <span class="ordinal ">{{ props.text }}</span>
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
const props = defineProps<{
    entity: T,
    text: string
}>();
</script>