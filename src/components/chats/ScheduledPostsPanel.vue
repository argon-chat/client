<template>
  <div class="flex max-h-[420px] flex-col" data-testid="scheduled-panel">
    <div class="border-b border-border px-3 py-2 text-sm font-semibold">{{ t("scheduled_title") }}</div>
    <ul v-if="posts.length" class="flex-1 overflow-y-auto p-1">
      <ScheduledPostRow
        v-for="post in posts"
        :key="post.postId"
        :post="post"
        :own="post.authorId === meId"
        :can-moderate="canModerate"
        @reschedule="(p, at) => emit('reschedule', p, at)"
        @cancel="(p) => emit('cancel', p)"
      />
    </ul>
    <p v-else class="p-4 text-center text-xs text-muted-foreground">{{ t("scheduled_empty") }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ScheduledPost } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";
import ScheduledPostRow from "./ScheduledPostRow.vue";

defineProps<{
  posts: ScheduledPost[];
  meId: string | undefined;
  canModerate: boolean;
}>();

const emit = defineEmits<{
  (e: "reschedule", post: ScheduledPost, at: Date): void;
  (e: "cancel", post: ScheduledPost): void;
}>();

const { t } = useLocale();
</script>
