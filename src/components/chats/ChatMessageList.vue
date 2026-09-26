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
            messages[item.index]?._rev,
            messages[item.index]?.text,
            messages[item.index]?.entities?.length,
            messages[item.index]?.reactions?.length,
            messages[item.index]?.controls?.length,
            canPublishAny,
            groupingMap[item.index]?.isFirstInGroup,
            groupingMap[item.index]?.isLastInGroup,
            groupingMap[item.index]?.showDate,
            groupingMap[item.index]?.showUnread,
            canPin,
            announcementKey,
            canReact,
            canReply,
            canEdit,
            canDeleteAny,
            channelType,
            readCountsKey,
          ]"
        >
          <DateSeparator
            v-if="groupingMap[item.index]?.showDate"
            :date="messages[item.index].timeSent.toDate()"
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
            :can-reply="canReply"
            :can-edit="canEdit"
            :can-delete-own="canDeleteOwn"
            :can-delete-any="canDeleteAny"
            :can-pin="canPin"
            :announcement="announcement"
            :read-counts="readCounts"
            :channel-type="channelType"
            :can-publish-any="canPublishAny"
            :toggle-reaction="toggleReaction"
            @dblclick="() => canReply && emit('select-reply', messages[item.index])"
            @reply="(msg) => emit('select-reply', msg)"
            @edit="(msg) => emit('select-edit', msg)"
            @delete="(msg, skip) => emit('delete-message', msg, skip)"
            @publish="(msg) => emit('publish', msg)"
            @retry="(msg) => emit('retry', msg)"
            @open-lightbox="onOpenLightbox"
            @scroll-to-message="onJumpRequest"
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
      <EmptyStateArt name="no-messages" :size="148" />
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

    <!-- ═══ Away in older history (opened by a jump): the way back to the present ═══ -->
    <Transition name="fab-pop">
      <div
        v-if="detached"
        class="absolute bottom-3 inset-x-0 z-10 flex justify-center pointer-events-none"
        data-testid="older-history-bar"
      >
        <div class="pointer-events-auto flex items-center gap-3 pl-4 pr-1.5 py-1.5 rounded-full bg-card border border-border/40 shadow-md text-sm">
          <span class="text-muted-foreground">{{ t('viewing_older_messages') }}</span>
          <span
            v-if="newMessagesCount > 0"
            class="min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center"
          >
            {{ newMessagesCount > 99 ? '99+' : newMessagesCount }}
          </span>
          <button
            class="flex items-center gap-1 h-7 px-3 rounded-full bg-primary text-primary-foreground text-xs font-semibold cursor-pointer transition-opacity hover:opacity-90"
            data-testid="jump-to-present"
            @click="emit('jump-to-present')"
          >
            <CircleArrowDown class="w-3.5 h-3.5" />
            {{ t('jump_to_present') }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- ═══ Scroll-to-bottom FAB ═══ -->
    <Transition name="fab-pop">
      <button
        v-if="isScrolledUp && !detached"
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
import { computed, ref, watch, onUnmounted, type ShallowRef } from "vue";
import { CircleArrowDown, Loader2Icon } from "lucide-vue-next";
import type { ArgonMessage, MessageEntityAttachment } from "@argon/glue";

import MessageItem from "@/components/MessageItem.vue";
import ImageLightbox from "@/components/chats/ImageLightbox.vue";
import DateSeparator from "@/components/chats/DateSeparator.vue";
import UnreadSeparator from "@/components/chats/UnreadSeparator.vue";
import EmptyStateArt from "@/components/shared/EmptyStateArt.vue";

import { useLocale } from "@/store/system/localeStore";
import { useChatScroll } from "@/composables/useChatScroll";
import type { ChatMessage } from "@/composables/useChatMessages";
import type { GroupMeta } from "@/composables/useMessageGrouping";
import { announcementMemoKey, type AnnouncementCardContext } from "@/composables/useAnnouncementChannel";

const { t } = useLocale();

// ── Props / Emits ──

const props = withDefaults(defineProps<{
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
  canReply?: boolean;
  canEdit?: boolean;
  canDeleteOwn?: boolean;
  canDeleteAny?: boolean;
  /** ManageMessages here: messages may be pinned and unpinned. */
  canPin?: boolean;
  toggleReaction?: (messageId: bigint, emoji: string) => void;
  /** Announcement channels: messages render as cards. */
  announcement?: AnnouncementCardContext | null;
  channelType?: "text" | "announcement";
  canPublishAny?: boolean;
  /** Announcement channels: the eye and reader count beside the posts the user may see it for. */
  readCounts?: { spaceId: string; channelId: string } | null;
  /** The list shows a stretch of older history opened by a jump, not the present. */
  detached?: boolean;
}>(), { canReply: true, canEdit: false, canDeleteOwn: false, canDeleteAny: false, canPin: false, announcement: null, canPublishAny: false, readCounts: null });

const emit = defineEmits<{
  (e: "select-reply", message: ArgonMessage): void;
  (e: "select-edit", message: ArgonMessage): void;
  (e: "delete-message", message: ArgonMessage, skipConfirm: boolean): void;
  (e: "publish", message: ArgonMessage): void;
  (e: "retry", message: ChatMessage): void;
  (e: "near-top"): void;
  (e: "scroll-state", distanceFromBottom: number): void;
  (e: "reset-unread"): void;
  /** A message that is not loaded was asked for (a reply's original): the parent opens it. */
  (e: "jump-to-message", messageId: bigint): void;
  (e: "jump-to-present"): void;
}>();

// ── Row memo keys ──
// Rows are memoised on primitives. The card context is a new object on every write of the channel
// row, and every message in the channel writes it (lastMessageId): as a memo key it redrew every row
// on every message.

const announcementKey = computed(() => announcementMemoKey(props.announcement));
const readCountsKey = computed(() => (props.readCounts ? `${props.readCounts.spaceId}:${props.readCounts.channelId}` : ""));

// ── Scroll engine (owns the real messages ref for triggerRef reactivity) ──

const messages = props.source();

const {
  parentRef, chatWidth, renderedItems, topSpace, bottomSpace, measureElement,
  scrollToBottomImmediate, scrollToBottom, scrollToIndex,
  onScrollNearTop, onScroll, resetScroller, setFollowBottom,
} = useChatScroll(messages);

// History paged in below the reader must not drag the view down with it.
watch(() => props.detached, (detached) => setFollowBottom(!detached), { immediate: true });

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
  scrollToIndex(idx, "center");
  highlightedIdx.value = idx;
  if (hlTimer) clearTimeout(hlTimer);
  hlTimer = setTimeout(() => (highlightedIdx.value = null), 1500);
}

function onJumpRequest(messageId: bigint) {
  if (messages.value.some((m) => m.messageId === messageId)) scrollToMessage(messageId);
  else emit("jump-to-message", messageId);
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
