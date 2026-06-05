<template>
  <div
    class="relative flex flex-col min-h-0"
    :style="{ '--chat-width': chatWidth + 'px' }"
  >
    <!-- ═══ Virtual scroll area ═══ -->
    <div
      ref="parentRef"
      class="flex-1 min-h-0 overflow-y-scroll px-9 pb-2 chat-scrollbar"
      style="overflow-anchor: none"
    >
      <!-- Top spacer -->
      <div :style="{ height: topSpace + 'px' }" />

      <!-- Rendered items in normal flow -->
      <div
        v-for="item in renderedItems"
        :key="String(item.key)"
        class="w-full"
        :class="highlightedIdx === item.index ? 'highlight-flash' : ''"
      >
        <div
          v-if="messages[item.index]"
          :ref="(el) => measureElement(el as HTMLElement, item.key)"
          :data-msg-key="String(item.key)"
          :data-index="item.index"
          v-memo="[
            item.key,
            messages[item.index]?._failed,
            messages[item.index]?._optimistic,
            messages[item.index]?.text,
            messages[item.index]?.entities?.length,
            messages[item.index]?.reactions?.length,
            messages[item.index]?.controls?.length,
            groupingMap[item.index]?.isFirstInGroup,
            groupingMap[item.index]?.isLastInGroup,
            groupingMap[item.index]?.showDate,
            groupingMap[item.index]?.showUnread,
          ]"
        >
          <DateSeparator
            v-if="groupingMap[item.index]?.showDate"
            :date="messages[item.index].timeSent.date"
          />
          <UnreadSeparator v-if="groupingMap[item.index]?.showUnread" />

          <MessageItem
            :message="messages[item.index]"
            :get-msg-by-id="getMessageById"
            :two-sided="twoSided ?? false"
            :is-grouped="groupingMap[item.index]?.isGrouped ?? false"
            :is-first-in-group="groupingMap[item.index]?.isFirstInGroup ?? true"
            :is-last-in-group="groupingMap[item.index]?.isLastInGroup ?? true"
            :can-react="canReact"
            :toggle-reaction="toggleReaction"
            @dblclick="() => emit('select-reply', messages[item.index])"
            @reply="(msg) => emit('select-reply', msg)"
            @retry="(msg) => emit('retry', msg)"
            @open-lightbox="onOpenLightbox"
            @scroll-to-message="scrollToMessage"
          />
        </div>
      </div>

      <!-- Bottom spacer -->
      <div :style="{ height: bottomSpace + 'px' }" />
    </div>

    <!-- ═══ Loading older spinner ═══ -->
    <Transition name="fade-slide">
      <div
        v-if="isLoadingOlder"
        class="absolute top-0 inset-x-0 flex justify-center py-3 z-[5] bg-gradient-to-b from-card to-transparent pointer-events-none"
      >
        <Loader2Icon class="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    </Transition>

    <!-- ═══ Empty state ═══ -->
    <div
      v-if="!isLoading && !messages.length"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3"
    >
      <div class="w-14 h-14 rounded-2xl bg-muted/25 flex items-center justify-center text-muted-foreground/45">
        <MessageSquareIcon class="w-7 h-7" />
      </div>
      <p class="text-sm text-muted-foreground/60">{{ t('no_messages_yet') }}</p>
    </div>

    <!-- ═══ Lightbox (single shared instance) ═══ -->
    <ImageLightbox
      :images="lbImages"
      :initial-index="lbIndex"
      :is-open="lbOpen"
      :time-sent="lbTime"
      @close="lbOpen = false"
    />

    <!-- ═══ Scroll-to-bottom FAB ═══ -->
    <Transition name="fab-pop">
      <button
        v-if="isScrolledUp"
        class="absolute bottom-4 right-6 z-10 flex items-center justify-center w-9 h-9 rounded-full bg-card text-foreground/70 border border-border/35 cursor-pointer shadow-md transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:text-foreground"
        @click="onFabClick"
      >
        <CircleArrowDown class="w-5 h-5" />
        <span
          v-if="newMessagesCount > 0"
          class="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center"
        >
          {{ newMessagesCount > 99 ? '99+' : newMessagesCount }}
        </span>
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, type ShallowRef } from "vue";
import { CircleArrowDown, Loader2Icon, MessageSquareIcon } from "lucide-vue-next";
import type { ArgonMessage, MessageEntityAttachment } from "@argon/glue";

import MessageItem from "@/components/MessageItem.vue";
import ImageLightbox from "@/components/chats/ImageLightbox.vue";
import DateSeparator from "@/components/chats/DateSeparator.vue";
import UnreadSeparator from "@/components/chats/UnreadSeparator.vue";

import { useLocale } from "@/store/system/localeStore";
import { useChatScroll } from "@/composables/useChatScroll";
import type { ChatMessage } from "@/composables/useChatMessages";
import type { GroupMeta } from "@/composables/useMessageGrouping";

const { t } = useLocale();

// ── Props / Emits ──

const props = defineProps<{
  /** Stable getter for the messages shallowRef (keeps triggerRef reactivity). */
  source: () => ShallowRef<ChatMessage[]>;
  groupingMap: GroupMeta[];
  getMessageById: (id: bigint | null) => ArgonMessage;
  isLoading: boolean;
  isLoadingOlder: boolean;
  isScrolledUp: boolean;
  newMessagesCount: number;
  /** DMs render two-sided (own messages on the right); channels stay one-sided. */
  twoSided?: boolean;
  canReact?: boolean;
  toggleReaction?: (messageId: bigint, emoji: string) => void;
}>();

const emit = defineEmits<{
  (e: "select-reply", message: ArgonMessage): void;
  (e: "retry", message: ChatMessage): void;
  (e: "near-top"): void;
  (e: "scroll-state", distanceFromBottom: number): void;
  (e: "reset-unread"): void;
}>();

// ── Scroll engine (owns the real messages ref for triggerRef reactivity) ──

const messages = props.source();

const {
  parentRef, chatWidth, renderedItems, topSpace, bottomSpace, measureElement,
  scrollToBottomImmediate, scrollToBottom, scrollToIndex,
  onScrollNearTop, onScroll, resetScroller,
} = useChatScroll(messages);

onScrollNearTop(() => emit("near-top"));
onScroll(({ distanceFromBottom }) => emit("scroll-state", distanceFromBottom));

function onFabClick() {
  scrollToBottom();
  emit("reset-unread");
}

// ── Lightbox ──

const lbOpen = ref(false);
const lbImages = ref<MessageEntityAttachment[]>([]);
const lbIndex = ref(0);
const lbTime = ref<Date | null>(null);

function onOpenLightbox(images: MessageEntityAttachment[], index: number, timeSent: Date | null) {
  lbImages.value = images;
  lbIndex.value = index;
  lbTime.value = timeSent;
  lbOpen.value = true;
}

// ── Reply-scroll highlight ──

const highlightedIdx = ref<number | null>(null);
let hlTimer: ReturnType<typeof setTimeout> | null = null;

function scrollToMessage(messageId: bigint) {
  const idx = messages.value.findIndex((m) => m.messageId === messageId);
  if (idx < 0) return;
  scrollToIndex(idx);
  highlightedIdx.value = idx;
  if (hlTimer) clearTimeout(hlTimer);
  hlTimer = setTimeout(() => (highlightedIdx.value = null), 1500);
}

onUnmounted(() => {
  if (hlTimer) clearTimeout(hlTimer);
});

// ── Exposed to parent views ──

defineExpose({ scrollToBottomImmediate, scrollToIndex, scrollToMessage, resetScroller });
</script>

<style scoped>
/* ── Fade-slide (loading spinner) ── */
.fade-slide-enter-active { transition: opacity 0.2s ease; }
.fade-slide-leave-active { transition: opacity 0.15s ease; }
.fade-slide-enter-from,
.fade-slide-leave-to { opacity: 0; }

/* ── FAB pop transition ── */
.fab-pop-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.fab-pop-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.fab-pop-enter-from { opacity: 0; transform: translateY(8px) scale(0.9); }
.fab-pop-leave-to { opacity: 0; transform: translateY(4px) scale(0.95); }

/* ── Reply-scroll highlight flash ── */
@keyframes highlight-bg {
  0% { background: hsl(var(--primary) / 0.15); }
  100% { background: transparent; }
}
.highlight-flash {
  animation: highlight-bg 1.5s ease-out;
  border-radius: calc(var(--radius) - 4px);
}

/* ── Custom scrollbar (unified for channels + DMs) ── */
.chat-scrollbar::-webkit-scrollbar { width: 6px; }
.chat-scrollbar::-webkit-scrollbar-track { background: transparent; }
.chat-scrollbar::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.08);
  border-radius: 3px;
}
.chat-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.16);
}
.chat-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / 0.28);
}
</style>
