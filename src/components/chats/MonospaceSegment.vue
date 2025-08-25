<template>
    <span class="font-mono">{{ props.text }}</span>
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
import { IMessageEntity } from '@/lib/glue/argonChat';

const props = defineProps<{
  entity: T;
  text: string;
}>();
</script>