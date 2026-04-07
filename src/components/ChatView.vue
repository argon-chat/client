<template>
  <div class="chat-container" :style="{ '--chat-width': chatWidth + 'px' }">
    <!-- Sticky header -->
    <div class="sticky-header">
      <div class="header-top-bar">
        <div class="header-left">
          <component :is="channelType === 'announcement' ? AntennaIcon : HashIcon" class="channel-icon" />
          <h2 class="channel-name">{{ channelName }}</h2>
        </div>
        <div class="header-actions">
          <div class="search-input-wrapper" :class="{ expanded: searchExpanded }">
            <SearchIcon class="search-icon-inline" @click="expandSearch" />
            <input 
              ref="searchInputRef"
              type="text" 
              :placeholder="t('search_messages') || 'Search...'" 
              class="search-input"
              @blur="collapseSearch"
              @keydown.escape="collapseSearch"
            />
          </div>
          <button class="header-btn" title="Notification settings">
            <BellIcon class="btn-icon" />
          </button>
        </div>
      </div>
      <Transition name="typing-slide">
        <div v-if="typingUsers && typingUsers.length > 0"
          class="typing-indicator">
          <div class="typing-bubble">
            <span class="inline-flex gap-[1px] mr-1.5">
              <span class="dot"></span>
              <span class="dot dot2"></span>
              <span class="dot dot3"></span>
            </span>
            <span>
              {{
                typingUsers.length === 1
                  ? t("typing.one", { name: typingUsers[0].displayName })
                  : typingUsers.length <= 3 ? t("typing.few", {
                      names: typingUsers.map(u => u.displayName).join(", ")
                    }) : t("typing.many")
              }}
            </span>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Messages scroll area -->
    <div ref="parentRef" :class="cn('chat-scroll messages', classes)">
      <div
        v-if="virtualizer?.getTotalSize"
        :style="{
          height: `${virtualizer?.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }"
      >
        <!-- Outer div: always updates translateY position. Inner div: v-memo prevents MessageItem re-render on pure scroll -->
        <div
          v-for="item in virtualItems"
          :key="String(item.key)"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start}px)`,
          }"
          class="chat-message"
        >
          <div
            :ref="(el) => measureItem(el as HTMLElement, item.index)"
            :data-index="item.index"
            v-memo="[item.key, messages[item.index]?._failed, messages[item.index]?._optimistic, groupingMap[item.index]?.isFirstInGroup, groupingMap[item.index]?.isLastInGroup]"
          >
            <MessageItem
              :message="messages[item.index]"
              :get-msg-by-id="getMessageById"
              :is-grouped="groupingMap[item.index]?.isGrouped ?? false"
              :is-first-in-group="groupingMap[item.index]?.isFirstInGroup ?? true"
              :is-last-in-group="groupingMap[item.index]?.isLastInGroup ?? true"
              @dblclick="() => emit('select-reply', messages[item.index])"
              @reply="(msg) => emit('select-reply', msg)"
              @retry="retryMessage"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Loading older indicator — absolute overlay, not in scroll flow -->
    <Transition name="scroll-btn">
      <div v-if="isLoadingOlder" class="loading-indicator-top">
        <Loader2Icon class="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    </Transition>

    <!-- Empty state - outside scroll area -->
    <div v-if="!isLoading && messages.length === 0" class="empty-chat-state">
      <div class="empty-chat-icon">
        <MessageSquareIcon class="w-7 h-7" />
      </div>
      <p class="empty-chat-text">{{ t('no_messages_yet') }}</p>
    </div>

    <!-- Scroll to bottom button -->
    <Transition name="scroll-btn">
      <button 
        v-if="isScrolledUp" 
        @click="onScrollToBottomClick" 
        class="scroll-to-bottom-btn"
      >
        <CircleArrowDown class="arrow-icon" />
        <div v-if="newMessagesCount > 0" class="new-messages-count">
          {{ newMessagesCount > 99 ? '99+' : newMessagesCount }}
        </div>
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted, nextTick } from "vue";
import {
  AntennaIcon,
  BellIcon,
  CircleArrowDown,
  HashIcon,
  Loader2Icon,
  MessageSquareIcon,
  SearchIcon,
} from "lucide-vue-next";

import MessageItem from "@/components/MessageItem.vue";
import { type ArgonMessage } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/system/localeStore";
import { cn } from "@argon/core";
import { useChatMessages } from "@/composables/useChatMessages";
import { useChatScroll } from "@/composables/useChatScroll";

const { t } = useLocale();

// Search expand/collapse
const searchExpanded = ref(false);
const searchInputRef = ref<HTMLInputElement | null>(null);

const expandSearch = () => {
  searchExpanded.value = true;
  nextTick(() => searchInputRef.value?.focus());
};

const collapseSearch = () => {
  searchExpanded.value = false;
};

const GROUP_TIME_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface GroupInfo {
  isGrouped: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
}

// Pre-computed grouping map — recalculates only when messages array changes
const groupingMap = computed(() => {
  const msgs = messages.value;
  const map: GroupInfo[] = new Array(msgs.length);

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!msg?.sender) {
      map[i] = { isGrouped: false, isFirstInGroup: true, isLastInGroup: true };
      continue;
    }

    const prev = i > 0 ? msgs[i - 1] : null;
    const next = i < msgs.length - 1 ? msgs[i + 1] : null;

    const sameSenderAsPrev = !!(prev
      && prev.sender
      && prev.sender === msg.sender
      && !prev._optimistic
      && msg.timeSent?.date && prev.timeSent?.date
      && Math.abs(msg.timeSent.date.getTime() - prev.timeSent.date.getTime()) < GROUP_TIME_THRESHOLD_MS);

    const sameSenderAsNext = !!(next
      && next.sender
      && next.sender === msg.sender
      && !msg._optimistic
      && msg.timeSent?.date && next.timeSent?.date
      && Math.abs(next.timeSent.date.getTime() - msg.timeSent.date.getTime()) < GROUP_TIME_THRESHOLD_MS);

    map[i] = {
      isGrouped: sameSenderAsPrev,
      isFirstInGroup: !sameSenderAsPrev,
      isLastInGroup: !sameSenderAsNext,
    };
  }

  return map;
});

const props = defineProps<{
  channelId: Guid;
  spaceId?: Guid;
  channelName?: string;
  channelType?: "text" | "announcement";
  typingUsers?: { displayName: string }[];
  class?: string;
}>();

const classes = computed(() => props.class);

const {
  messages,
  hasReachedEnd,
  isLoading,
  isLoadingOlder,
  isRestoringScroll,
  newMessagesCount,
  isScrolledUp,
  loadOlderMessages,
  loadInitialMessages,
  subscribeToNewMessages,
  getMessageById,
  addOptimisticMessage,
  resolveOptimisticMessage,
  removeOptimisticMessage,
  markOptimisticFailed,
  retryMessage,
  cleanup: cleanupMessages,
} = useChatMessages(
  () => props.channelId,
  () => props.spaceId,
);

const {
  parentRef,
  chatWidth,
  virtualizer,
  virtualItems,
  measureItem,
  scrollToBottomImmediate,
  scrollToBottom,
  scrollToIndex,
  onScrollNearTop,
  onScroll: onScrollState,
} = useChatScroll(
  () => messages.value,
  () => isRestoringScroll.value,
);

// Wire up scroll-near-top to load older messages
onScrollNearTop(() => {
  if (!isLoadingOlder.value && !hasReachedEnd.value && !isRestoringScroll.value) {
    loadOlderMessages((count) => {
      nextTick(() => scrollToIndex(count));
    });
  }
});

// Unified scroll state tracking via the composable's callback
onScrollState(({ distanceFromBottom }) => {
  const wasScrolledUp = isScrolledUp.value;
  isScrolledUp.value = distanceFromBottom > 100;

  if (wasScrolledUp && !isScrolledUp.value) {
    newMessagesCount.value = 0;
  }
});

const onScrollToBottomClick = () => {
  scrollToBottom();
  newMessagesCount.value = 0;
  isScrolledUp.value = false;
};

const emit = defineEmits<(e: "select-reply", message: ArgonMessage) => void>();

defineExpose({
  addOptimisticMessage,
  resolveOptimisticMessage,
  markOptimisticFailed,
  scrollToBottomImmediate,
});

// Watch for channel changes — subscribe first (step 8), then load
watch(
  () => props.channelId,
  async (newChannelId) => {
    // Subscribe BEFORE loading so events during load are captured
    subscribeToNewMessages(newChannelId, () => scrollToBottomImmediate());
    await loadInitialMessages(() => scrollToBottomImmediate());
  },
  { immediate: true },
);

onUnmounted(() => {
  cleanupMessages();
});
</script>

<style scoped>
.chat-container {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: hsl(var(--card));
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: scroll;
  position: relative;
  padding: 0 2.25rem 8px 2.25rem;
}

/* ─── Sticky header ─── */
.sticky-header {
  position: relative;
  z-index: 10;
  background: hsl(var(--card));
  padding: 0 1.5rem;
  flex-shrink: 0;
}

.header-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  gap: 0.75rem;
  border-bottom: 1px solid hsl(var(--border) / 0.25);
}

/* Left: icon + channel name */
.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.channel-icon {
  width: 1.05rem;
  height: 1.05rem;
  flex-shrink: 0;
  color: hsl(var(--muted-foreground) / 0.65);
}

.channel-name {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Right: actions */
.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* Unified icon button */
.header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.header-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.header-btn:active {
  background: hsl(var(--accent) / 0.7);
}

.btn-icon {
  width: 1rem;
  height: 1rem;
}

/* ─── Expandable search ─── */
.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  transition: width 0.25s ease, background-color 0.2s ease, border-color 0.2s ease;
  border: 1px solid transparent;
  cursor: pointer;
}

.search-input-wrapper.expanded {
  width: 200px;
  background: hsl(var(--background));
  border-color: hsl(var(--border) / 0.45);
  cursor: default;
}

.search-icon-inline {
  position: absolute;
  left: 0.5rem;
  width: 0.95rem;
  height: 0.95rem;
  color: hsl(var(--muted-foreground) / 0.6);
  flex-shrink: 0;
  transition: color 0.15s ease;
  cursor: pointer;
}

.search-input-wrapper:not(.expanded):hover .search-icon-inline {
  color: hsl(var(--foreground));
}

.search-input-wrapper:not(.expanded):hover {
  background: hsl(var(--accent));
}

.search-input {
  width: 100%;
  padding: 0.35rem 0.5rem 0.35rem 1.85rem;
  background: transparent;
  border: none;
  font-size: 0.8rem;
  color: hsl(var(--foreground));
  outline: none;
  opacity: 0;
  transition: opacity 0.15s ease 0.1s;
}

.search-input-wrapper.expanded .search-input {
  opacity: 1;
}

.search-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.5);
}

/* ─── Typing indicator ─── */
.typing-indicator {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
}

.typing-bubble {
  display: flex;
  align-items: center;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  background: hsl(var(--card) / 0.88);
  border: 1px solid hsl(var(--border) / 0.2);
  border-top: none;
  border-radius: 0 0 10px 10px;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  box-shadow: 0 2px 8px hsl(var(--foreground) / 0.04);
}

.dot {
  display: inline-block;
  width: 3.5px;
  height: 3.5px;
  background: currentColor;
  border-radius: 50%;
  animation: dot-flash 1.4s infinite;
}

.dot2 { animation-delay: 0.25s; }
.dot3 { animation-delay: 0.5s; }

@keyframes dot-flash {
  0%, 80%, 100% { opacity: 0.15; }
  40% { opacity: 1; }
}

.typing-slide-enter-active,
.typing-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.typing-slide-enter-from,
.typing-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

/* ─── Messages ─── */
.chat-message {
  word-wrap: break-word;
  contain: layout style;
}

/* Scrollbar */
.messages::-webkit-scrollbar {
  width: 6px;
}

.messages::-webkit-scrollbar-track {
  background: transparent;
}

.messages::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.06);
  border-radius: 3px;
  transition: background-color 0.2s;
}

.messages:hover::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.14);
}

.messages::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / 0.25);
}

/* ─── Empty state ─── */
.empty-chat-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 0;
}

.empty-chat-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: hsl(var(--muted) / 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground) / 0.45);
}

.empty-chat-text {
  font-size: 0.82rem;
  color: hsl(var(--muted-foreground) / 0.6);
}

/* ─── Scroll to bottom ─── */
.scroll-to-bottom-btn {
  position: absolute;
  bottom: 16px;
  right: 24px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: hsl(var(--card));
  color: hsl(var(--foreground) / 0.7);
  border: 1px solid hsl(var(--border) / 0.35);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease, color 0.15s ease;
  box-shadow: 0 2px 8px hsl(var(--foreground) / 0.07);
}

.scroll-to-bottom-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px hsl(var(--foreground) / 0.12);
  color: hsl(var(--foreground));
  background: hsl(var(--card));
}

.scroll-to-bottom-btn .arrow-icon {
  width: 20px;
  height: 20px;
}

.new-messages-count {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background-color: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ─── Loading overlay ─── */
.loading-indicator-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  padding: 12px;
  z-index: 5;
  background: linear-gradient(to bottom, hsl(var(--card)), transparent);
  pointer-events: none;
}

/* ─── Transitions ─── */
.scroll-btn-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.scroll-btn-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.scroll-btn-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.9);
}
.scroll-btn-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.95);
}
</style>
