<template>
  <div
    v-if="visible"
    ref="el"
    class="read-count"
    :title="count ? t('read_by_of', { count: count.readers, members: count.members }) : undefined"
    data-testid="read-count"
    @mouseenter="load"
  >
    <EyeIcon class="w-3 h-3 shrink-0" />
    <span v-if="count">{{ t("read_by", { count: count.readers }) }}</span>
    <span v-else>{{ t("read_by_loading") }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * "Read by N" under an announcement, for its author and for moderators. Asks only once the line is
 * on screen or hovered, together with the other posts on screen; the answer is cached briefly (see
 * useReadCount). A post the server gives no count for (too few members to count without singling
 * anyone out, among others) shows no line at all.
 */
import { computed, ref, watch } from "vue";
import { useIntersectionObserver } from "@vueuse/core";
import { EyeIcon } from "lucide-vue-next";
import type { ChatMessage } from "@/composables/useChatMessages";
import { canSeeReadCount, fetchReadCount, peekReadCount, type ReadCount } from "@/composables/useReadCount";
import { useMe } from "@/store/auth/meStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useLocale } from "@/store/system/localeStore";

const props = defineProps<{
  message: ChatMessage;
  context: { spaceId: string; channelId: string };
}>();

const { t } = useLocale();
const me = useMe();
const pex = usePexStore();

const allowed = computed(() =>
  canSeeReadCount(props.message, me.me?.userId, pex.hasIn(props.context.channelId, "ManageMessages", props.context.spaceId)),
);

const el = ref<HTMLElement | null>(null);
const cached = () => peekReadCount(props.context.channelId, props.message.messageId);
const count = ref<ReadCount | null>(cached() ?? null);
/** The server answered with no count for this post. */
const none = ref(cached() === null);
const visible = computed(() => allowed.value && !none.value);

async function load() {
  if (!visible.value) return;
  const id = props.message.messageId;
  const value = await fetchReadCount(props.context.spaceId, props.context.channelId, id);
  if (id !== props.message.messageId) return;
  count.value = value;
  none.value = value === null;
}

useIntersectionObserver(el, ([entry]) => {
  if (entry?.isIntersecting) void load();
});

// A row reused by the virtual list for another message starts over.
watch(
  () => props.message.messageId,
  () => {
    count.value = cached() ?? null;
    none.value = cached() === null;
  },
);
</script>

<style scoped>
.read-count {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  height: 16px;
  margin-top: 2px;
  /* Under the bubble, past the avatar column and the row gap. */
  padding-left: calc(2.25rem + var(--chat-row-gap, 0.5rem));
  font-size: 11px;
  line-height: 1;
  color: hsl(var(--muted-foreground) / 0.7);
  user-select: none;
}
</style>
