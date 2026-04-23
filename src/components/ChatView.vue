<template>
  <!--
    ╔═════════════════════════════════════════════════════╗
    ║  ChatView — virtualised message list + header      ║
    ║  Features: virtual scroll, date separators,        ║
    ║  unread line, scroll-to-reply, typing indicator    ║
    ╚═════════════════════════════════════════════════════╝
  -->
  <div
    class="relative h-full w-full flex flex-col min-h-0 bg-card"
    :style="{ '--chat-width': chatWidth + 'px' }"
  >
    <!-- ═══ Header ═══ -->
    <header class="relative z-10 bg-card px-6 shrink-0">
      <div class="flex items-center justify-between h-12 gap-3 border-b border-border/25">
        <div class="flex items-center gap-2 min-w-0">
          <component
            :is="channelType === 'announcement' ? AntennaIcon : HashIcon"
            class="w-[1.05rem] h-[1.05rem] shrink-0 text-muted-foreground/65"
          />
          <h2
            class="text-[0.9rem] font-semibold leading-none text-foreground whitespace-nowrap overflow-hidden text-ellipsis"
          >
            {{ channelName }}
          </h2>
        </div>

        <!-- Mute bell -->
        <Popover>
          <PopoverTrigger as-child>
            <button
              class="relative flex items-center justify-center w-8 h-8 bg-transparent border-none rounded-lg text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
              :title="t('notification_settings') || 'Notification settings'"
            >
              <BellIcon class="w-4 h-4" :class="{ 'opacity-40': channelMuted }" />
              <span
                v-if="channelMuted"
                class="absolute w-0.5 h-4 bg-muted-foreground/60 rotate-45 rounded-full"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-56 p-2" align="end">
            <div class="flex flex-col gap-1">
              <button
                v-for="opt in muteOptions"
                :key="opt.level"
                class="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent w-full text-left"
                @click="ntf.muteTarget(channelId, MuteTargetKind.Channel, opt.level, false, null)"
              >
                <BellIcon class="w-4 h-4" :class="opt.iconClass" />
                {{ opt.label }}
                <span v-if="currentMuteLevel === opt.level" class="ml-auto text-primary">✓</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <!-- Typing indicator -->
      <Transition name="typing-slide">
        <div
          v-if="typingUsers?.length"
          class="absolute top-full left-1/2 -translate-x-1/2 z-20"
        >
          <div
            class="flex items-center backdrop-blur-[10px] bg-card/[0.88] border border-border/20 border-t-0 rounded-b-[10px] px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap shadow-sm"
          >
            <span class="inline-flex gap-[1px] mr-1.5">
              <span class="typing-dot" />
              <span class="typing-dot delay-1" />
              <span class="typing-dot delay-2" />
            </span>
            <span>{{ typingText }}</span>
          </div>
        </div>
      </Transition>
    </header>

    <!-- ═══ Virtual scroll area ═══ -->
    <div
      ref="parentRef"
      :class="cn('flex-1 min-h-0 overflow-y-scroll relative px-9 pb-2 chat-scrollbar', externalClass)"
    >
      <div
        v-if="virtualizer?.getTotalSize"
        :style="{ height: virtualizer.getTotalSize() + 'px', width: '100%', position: 'relative' }"
      >
        <div
          v-for="item in virtualItems"
          :key="String(item.key)"
          class="absolute top-0 left-0 w-full will-change-transform"
          :class="highlightedIdx === item.index ? 'highlight-flash' : ''"
          :style="{ transform: `translateY(${item.start}px)` }"
          style="contain: layout style paint; content-visibility: auto; contain-intrinsic-size: auto 64px"
        >
          <div
            :ref="(el) => measureItem(el as HTMLElement, item.index)"
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
              :is-grouped="groupingMap[item.index]?.isGrouped ?? false"
              :is-first-in-group="groupingMap[item.index]?.isFirstInGroup ?? true"
              :is-last-in-group="groupingMap[item.index]?.isLastInGroup ?? true"
              :can-react="canReact"
              :toggle-reaction="toggleReaction"
              @dblclick="() => emit('select-reply', messages[item.index])"
              @reply="(msg) => emit('select-reply', msg)"
              @retry="retryMessage"
              @open-lightbox="onOpenLightbox"
              @scroll-to-message="scrollToMessage"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Loading older spinner ═══ -->
    <Transition name="fade-slide">
      <div
        v-if="isLoadingOlder"
        class="absolute top-0 inset-x-0 flex justify-center py-3 z-5 bg-gradient-to-b from-card to-transparent pointer-events-none"
      >
        <Loader2Icon class="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    </Transition>

    <!-- ═══ Empty state ═══ -->
    <div
      v-if="!isLoading && !messages.length"
      class="flex-1 flex flex-col items-center justify-center gap-3 min-h-0"
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
        @click="scrollToBottomAndReset"
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
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import {
  AntennaIcon, BellIcon, CircleArrowDown,
  HashIcon, Loader2Icon, MessageSquareIcon,
} from "lucide-vue-next";
import { cn } from "@argon/core";
import { type ArgonMessage, type MessageEntityAttachment, MuteLevelType, MuteTargetKind } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { Popover, PopoverTrigger, PopoverContent } from "@argon/ui/popover";

import MessageItem from "@/components/MessageItem.vue";
import ImageLightbox from "@/components/chats/ImageLightbox.vue";
import DateSeparator from "@/components/chats/DateSeparator.vue";
import UnreadSeparator from "@/components/chats/UnreadSeparator.vue";

import { useLocale } from "@/store/system/localeStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import { useChatMessages } from "@/composables/useChatMessages";
import { useChatScroll } from "@/composables/useChatScroll";
import { useMessageReactions } from "@/composables/useMessageReactions";

// ── Stores ──

const { t } = useLocale();
const ntf = useNotificationStore();

// ── Props / Emits ──

const props = defineProps<{
  channelId: Guid;
  spaceId?: Guid;
  channelName?: string;
  channelType?: "text" | "announcement";
  typingUsers?: { displayName: string }[];
  class?: string;
}>();

const externalClass = computed(() => props.class);

const emit = defineEmits<(e: "select-reply", message: ArgonMessage) => void>();

// ── Mute UI ──

const channelMuted = computed(() => {
  if (!props.channelId || !props.spaceId) return false;
  return ntf.effectiveMuteLevel(props.channelId, props.spaceId) !== MuteLevelType.None;
});

const currentMuteLevel = computed(() =>
  props.spaceId ? ntf.effectiveMuteLevel(props.channelId, props.spaceId) : MuteLevelType.None,
);

const muteOptions = computed(() => [
  { level: MuteLevelType.None, label: t("unmuted") || "All notifications", iconClass: "" },
  { level: MuteLevelType.OnlyMentions, label: t("only_mentions") || "Only @mentions", iconClass: "opacity-60" },
  { level: MuteLevelType.All, label: t("mute_all") || "Mute channel", iconClass: "opacity-30" },
]);

// ── Typing text ──

const typingText = computed(() => {
  const users = props.typingUsers ?? [];
  if (users.length === 1) return t("typing.one", { name: users[0].displayName });
  if (users.length <= 3) return t("typing.few", { names: users.map((u) => u.displayName).join(", ") });
  return t("typing.many");
});

// ── Lightbox state ──

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

// ── Grouping map (messages → visual metadata) ──

const GROUP_GAP_MS = 5 * 60 * 1000;

interface GroupMeta {
  isGrouped: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showDate: boolean;
  showUnread: boolean;
}

const groupingMap = computed<GroupMeta[]>(() => {
  const msgs = messages.value;
  const len = msgs.length;
  const out: GroupMeta[] = new Array(len);
  const lastReadId = ntf.readStates?.get(props.channelId)?.lastReadMessageId;
  let unreadPlaced = false;

  for (let i = 0; i < len; i++) {
    const msg = msgs[i];

    // Date separator: first message or different calendar day
    let showDate = i === 0;
    if (!showDate && i > 0) {
      const prev = msgs[i - 1]?.timeSent?.date;
      const curr = msg?.timeSent?.date;
      if (prev && curr) {
        showDate =
          prev.getFullYear() !== curr.getFullYear() ||
          prev.getMonth() !== curr.getMonth() ||
          prev.getDate() !== curr.getDate();
      }
    }

    // Unread line: immediately after last read message
    let showUnread = false;
    if (!unreadPlaced && lastReadId && i > 0 && msgs[i - 1]?.messageId === lastReadId && !msg._optimistic) {
      showUnread = true;
      unreadPlaced = true;
    }

    if (!msg?.sender) {
      out[i] = { isGrouped: false, isFirstInGroup: true, isLastInGroup: true, showDate, showUnread };
      continue;
    }

    const prev = i > 0 ? msgs[i - 1] : null;
    const next = i < len - 1 ? msgs[i + 1] : null;

    const samePrev =
      !!prev?.sender &&
      prev.sender === msg.sender &&
      !prev._optimistic &&
      !!msg.timeSent?.date &&
      !!prev.timeSent?.date &&
      Math.abs(msg.timeSent.date.getTime() - prev.timeSent.date.getTime()) < GROUP_GAP_MS &&
      !showDate &&
      !showUnread;

    const sameNext =
      !!next?.sender &&
      next.sender === msg.sender &&
      !msg._optimistic &&
      !!msg.timeSent?.date &&
      !!next.timeSent?.date &&
      Math.abs(next.timeSent.date.getTime() - msg.timeSent.date.getTime()) < GROUP_GAP_MS;

    out[i] = {
      isGrouped: samePrev,
      isFirstInGroup: !samePrev,
      isLastInGroup: !sameNext,
      showDate,
      showUnread,
    };
  }
  return out;
});

// ── Composables ──

const {
  messages, hasReachedEnd, isLoading, isLoadingOlder, isRestoringScroll,
  newMessagesCount, isScrolledUp,
  loadOlderMessages, loadInitialMessages, subscribeToNewMessages,
  getMessageById, addOptimisticMessage, resolveOptimisticMessage,
  markOptimisticFailed, retryMessage,
  cleanup: cleanupMessages,
} = useChatMessages(() => props.channelId, () => props.spaceId);

const {
  canReact, toggleReaction, batchLoadReactions,
  subscribe: subReactions, unsubscribe: unsubReactions,
} = useMessageReactions(messages, () => props.channelId, () => props.spaceId);

const {
  parentRef, chatWidth, virtualizer, virtualItems, measureItem,
  scrollToBottomImmediate, scrollToBottom, scrollToIndex,
  onScrollNearTop, onScroll: onScrollState,
} = useChatScroll(() => messages.value, () => isRestoringScroll.value);

// ── Scroll callbacks ──

onScrollNearTop(() => {
  if (!isLoadingOlder.value && !hasReachedEnd.value && !isRestoringScroll.value) {
    loadOlderMessages((count) => nextTick(() => scrollToIndex(count)));
  }
});

onScrollState(({ distanceFromBottom }) => {
  const was = isScrolledUp.value;
  isScrolledUp.value = distanceFromBottom > 100;
  if (was && !isScrolledUp.value) newMessagesCount.value = 0;

  // ACK when at bottom
  if (distanceFromBottom <= 100 && messages.value.length) {
    const last = messages.value[messages.value.length - 1];
    if (last && !last._optimistic) ntf.scheduleAck(props.channelId, last.messageId, props.spaceId);
  }
});

function scrollToBottomAndReset() {
  scrollToBottom();
  newMessagesCount.value = 0;
  isScrolledUp.value = false;
}

// ── Expose for parent ──

defineExpose({ addOptimisticMessage, resolveOptimisticMessage, markOptimisticFailed, scrollToBottomImmediate });

// ── Channel lifecycle ──

watch(
  () => props.channelId,
  async (newId, oldId) => {
    if (oldId) ntf.flushAcksImmediate();

    subscribeToNewMessages(newId, () => scrollToBottomImmediate());
    unsubReactions();
    subReactions();
    await loadInitialMessages(() => scrollToBottomImmediate());

    if (messages.value.length) {
      void batchLoadReactions(messages.value.filter((m) => !m._optimistic).map((m) => m.messageId));
    }

    nextTick(() => {
      if (messages.value.length && !isScrolledUp.value) {
        const last = messages.value[messages.value.length - 1];
        if (last && !last._optimistic) ntf.scheduleAck(props.channelId, last.messageId, props.spaceId);
      }
    });
  },
  { immediate: true },
);

onUnmounted(() => {
  if (hlTimer) clearTimeout(hlTimer);
  ntf.flushAcksImmediate();
  unsubReactions();
  cleanupMessages();
});
</script>

<style scoped>
/* ── Typing dots animation ── */
.typing-dot {
  display: inline-block;
  width: 3.5px;
  height: 3.5px;
  background: currentColor;
  border-radius: 50%;
  animation: dot-pulse 1.4s infinite;
}
.delay-1 { animation-delay: 0.25s; }
.delay-2 { animation-delay: 0.5s; }
@keyframes dot-pulse {
  0%, 80%, 100% { opacity: 0.15; }
  40% { opacity: 1; }
}

/* ── Typing slide transition ── */
.typing-slide-enter-active,
.typing-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.typing-slide-enter-from,
.typing-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

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
  border-radius: 8px;
}

/* ── Custom scrollbar ── */
.chat-scrollbar::-webkit-scrollbar { width: 6px; }
.chat-scrollbar::-webkit-scrollbar-track { background: transparent; }
.chat-scrollbar::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.06);
  border-radius: 3px;
}
.chat-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.14);
}
.chat-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / 0.25);
}
</style>
