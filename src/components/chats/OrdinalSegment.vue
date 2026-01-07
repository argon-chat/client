<template>
    <sup class="ordinal">{{ props.text }}</sup>
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
import { IMessageEntity } from '@/lib/glue/argonChat';

const props = defineProps<{
  entity: T;
  text: string;
}>();
</script>

<style scoped>
.ordinal {
    font-size: 0.75em;
    vertical-align: 0.3em;
    line-height: 0;
}
</style>