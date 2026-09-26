<template>
  <li class="flex flex-col gap-1 rounded-md px-2 py-2 hover:bg-muted/40" :data-testid="`scheduled-post-${post.postId}`">
    <div class="flex items-center gap-2 min-w-0">
      <AlertTriangleIcon v-if="failed" class="w-3.5 h-3.5 shrink-0 text-destructive" />
      <span class="text-xs font-medium tabular-nums shrink-0" :class="failed ? 'text-destructive' : 'text-foreground'">{{ when }}</span>
      <span v-if="!own" class="truncate text-[11px] text-muted-foreground" data-testid="scheduled-author">{{ authorName }}</span>
      <span class="ml-auto flex items-center gap-0.5 shrink-0">
        <button
          v-if="own"
          type="button"
          class="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          :title="t('scheduled_reschedule')"
          :aria-label="t('scheduled_reschedule')"
          data-testid="scheduled-reschedule"
          @click="picking = !picking"
        >
          <CalendarClockIcon class="w-3.5 h-3.5" />
        </button>
        <button
          v-if="own || canModerate"
          type="button"
          class="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
          :title="t('scheduled_cancel')"
          :aria-label="t('scheduled_cancel')"
          data-testid="scheduled-cancel"
          @click="emit('cancel', post)"
        >
          <XIcon class="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
    <p class="text-xs text-muted-foreground line-clamp-2 break-words" data-testid="scheduled-preview">{{ preview || t("attachment") }}</p>
    <p v-if="failed" class="text-[11px] text-destructive" data-testid="scheduled-failure">{{ t(failureKey(post.failure)) }}</p>
    <ScheduleTimePicker
      v-if="picking"
      class="mt-1"
      :initial="post.publishAt.toDate()"
      :title="t('scheduled_reschedule')"
      :confirm-label="t('scheduled_reschedule_confirm')"
      @pick="onPick"
    />
  </li>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AlertTriangleIcon, CalendarClockIcon, XIcon } from "lucide-vue-next";
import { ScheduledPostStatus, type ScheduledPost } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";
import { usePoolStore } from "@/store/data/poolStore";
import { failureKey, postPreview } from "@/composables/useScheduledPosts";
import ScheduleTimePicker from "./ScheduleTimePicker.vue";

const props = defineProps<{
  post: ScheduledPost;
  own: boolean;
  canModerate: boolean;
}>();

const emit = defineEmits<{
  (e: "reschedule", post: ScheduledPost, at: Date): void;
  (e: "cancel", post: ScheduledPost): void;
}>();

const { t } = useLocale();
const pool = usePoolStore();

const picking = ref(false);
const failed = computed(() => props.post.status === ScheduledPostStatus.FAILED);
const preview = computed(() => postPreview(props.post));

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const when = computed(() => whenFormat.format(props.post.publishAt.toDate()));

const author = pool.getUserReactive(toRef(() => (props.own ? undefined : props.post.authorId)));
const authorName = computed(() => author.value?.displayName ?? t("unknown_display_name"));

function onPick(at: Date) {
  picking.value = false;
  emit("reschedule", props.post, at);
}
</script>
