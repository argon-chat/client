<template>
    <span :class="['underline', colour]">{{ props.text }}</span>
</template>
<script setup lang="ts" generic="T extends IMessageEntityUnderline">
import { computed } from 'vue';

const props = defineProps<{
    entity: T,
    text: string
}>();


const colour = computed(() => 
    props.entity.Colour == 0 ? 
    'decoration-blue-600' : 
    `decoration-[#${(props.entity.Colour & 0xFFFFFF).toString(16).padStart(6, '0')}]`)

</script>