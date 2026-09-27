<template>
    <span :class="['underline', colour]" :style="{
        'text-decoration-color': props.entity.colour == 0 ? '' : `#${(props.entity.colour & 0xFFFFFF).toString(16).padStart(6, '0')}`
    }"><slot><EmojiText :text="props.text" /></slot></span>
</template>
<script setup lang="ts" generic="T extends MessageEntityUnderline">
import { MessageEntityUnderline } from "@argon/glue";
import EmojiText from "./EmojiText";
import { computed } from "vue";

const props = defineProps<{
  entity: T;
  text: string;
}>();

const colour = computed(() =>
  props.entity.colour === 0 ? "decoration-blue-600" : "",
);
</script>