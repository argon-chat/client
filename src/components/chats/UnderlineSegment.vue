<template>
    <span :class="['underline', colour]" :style="{
        'text-decoration-color': props.entity.colour == 0 ? '' : `#${(props.entity.colour & 0xFFFFFF).toString(16).padStart(6, '0')}`
    }">{{ props.text }}</span>
</template>
<script setup lang="ts" generic="T extends MessageEntityUnderline">
import { MessageEntityUnderline } from "@argon/glue";
import { computed } from "vue";

const props = defineProps<{
  entity: T;
  text: string;
}>();

const colour = computed(() =>
  props.entity.colour === 0 ? "decoration-blue-600" : "",
);
</script>