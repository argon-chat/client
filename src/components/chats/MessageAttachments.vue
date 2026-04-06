<template>
  <div v-if="attachments.length" class="message-attachments">
    <!-- Image grid -->
    <AttachmentImageGrid v-if="imageAttachments.length" :images="imageAttachments" />

    <!-- File cards -->
    <AttachmentFileCard
      v-for="(file, i) in fileAttachments"
      :key="i"
      :file-id="file.fileId"
      :file-name="file.fileName"
      :file-size="file.fileSize"
      :content-type="file.contentType"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MessageEntityAttachment } from "@argon/glue";
import AttachmentImageGrid from "./AttachmentImageGrid.vue";
import AttachmentFileCard from "./AttachmentFileCard.vue";

const props = defineProps<{
  attachments: MessageEntityAttachment[];
}>();

const imageAttachments = computed(() =>
  props.attachments.filter((a) => a.contentType.startsWith("image/")),
);

const fileAttachments = computed(() =>
  props.attachments.filter((a) => !a.contentType.startsWith("image/")),
);
</script>

<style scoped>
.message-attachments {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
</style>
