<template>
    <span class="font-bold"><slot><EmojiText :text="props.text" /></slot></span>
</template>
<script setup lang="ts" generic="T extends IMessageEntity">
import { IMessageEntity } from '@argon/glue';
import EmojiText from './EmojiText';

const props = defineProps<{
  entity: T;
  text: string;
}>();
</script>