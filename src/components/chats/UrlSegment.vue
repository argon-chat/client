<template>
    <a
      class="text-blue-600 cursor-pointer font-semibold hover:text-blue-500 hover:underline [overflow-wrap:anywhere]"
      :href="href"
      :title="href"
      @click.prevent.stop="onClickUrl"
    >{{ props.text }}</a>
</template>
<script setup lang="ts" generic="T extends MessageEntityUrl">
import { computed } from "vue";
import { MessageEntityUrl } from "@argon/glue";
import { openExternalUrl } from "@/lib/linkPreview/openExternal";

const props = defineProps<{
  entity: T;
  text: string;
}>();

// The text is the link as the sender wrote it; the entity carries the parsed parts. A scheme the
// sender typed is kept (http stays http); a bare domain is https.
const href = computed(() => {
  const written = props.text?.trim() ?? "";
  if (/^https?:\/\//i.test(written)) return written;
  return `https://${props.entity.domain}${props.entity.path || "/"}`;
});

const onClickUrl = () => openExternalUrl(href.value);
</script>
