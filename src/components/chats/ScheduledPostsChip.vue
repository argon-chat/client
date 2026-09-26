<template>
  <div v-if="posts.length" class="shrink-0 px-5 pt-2" data-testid="scheduled-chip-bar">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          data-testid="scheduled-chip"
        >
          <Clock3Icon class="w-3.5 h-3.5 text-muted-foreground" />
          <span>{{ t("scheduled_chip", { count: pendingCount }) }}</span>
          <span v-if="failedCount" class="inline-flex items-center gap-0.5 text-destructive" data-testid="scheduled-chip-failed">
            <AlertTriangleIcon class="w-3 h-3" />{{ failedCount }}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent class="w-[360px] p-0" align="start" side="top">
        <ScheduledPostsPanel
          :posts="posts"
          :me-id="me.me?.userId"
          :can-moderate="canModerate"
          @reschedule="(post, at) => reschedule(post.postId, at)"
          @cancel="(post) => cancel(post.postId)"
        />
      </PopoverContent>
    </Popover>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { AlertTriangleIcon, Clock3Icon } from "lucide-vue-next";
import { Popover, PopoverContent, PopoverTrigger } from "@argon/ui/popover";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import { useScheduledPosts } from "@/composables/useScheduledPosts";
import ScheduledPostsPanel from "./ScheduledPostsPanel.vue";

/** "Scheduled (N)" above the composer, while the channel has posts the user may see or act on. */
const props = defineProps<{ spaceId: string; channelId: string }>();

const { t } = useLocale();
const me = useMe();
const open = ref(false);

const { posts, pendingCount, failedCount, canModerate, reschedule, cancel, refresh } = useScheduledPosts(() => ({
  spaceId: props.spaceId,
  channelId: props.channelId,
}));

watch(open, (isOpen) => {
  if (isOpen) void refresh();
});
</script>
