<template>
    <span class="stacked-fractions">{{ props.text }}</span>
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
import { IMessageEntity } from '@argon/glue';

const props = defineProps<{
  entity: T;
  text: string;
}>();
</script>