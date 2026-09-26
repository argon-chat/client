<template>
  <span class="block w-9 h-9" :title="crosspost.sourceSpaceName" data-testid="crosspost-avatar">
    <ArgonAvatar
      :file-id="crosspost.sourceSpaceAvatarFileId"
      :fallback="crosspost.sourceSpaceName"
      :space-id="crosspost.sourceSpaceId"
      :overrided-size="36"
      class="w-9 h-9 rounded-xl"
    />
  </span>
</template>

<script setup lang="ts">
/** A crosspost speaks for the space it came from: its avatar stands where the author's would. */
import type { CrosspostInfo } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";

defineProps<{ crosspost: CrosspostInfo }>();
</script>
