<template>
  <div class="chat-container" :style="{ '--chat-width': chatWidth + 'px' }">
    <!-- Sticky header -->
    <div class="sticky-header">
      <div class="header-top-bar">
        <h2 class="channel-header">
          <component :is="channelType === 'announcement' ? AntennaIcon : HashIcon" class="channel-icon" />
          <span>{{ channelName }}</span>
        </h2>
        <div class="header-actions">
          <button class="notification-btn" title="Notification settings">
            <BellIcon class="w-4.5 h-4.5" />
          </button>
          <div class="search-input-wrapper">
            <SearchIcon class="search-icon" />
            <input 
              type="text" 
              placeholder="Search messages..." 
              class="search-input"
            />
          </div>
        </div>
      </div>
      <Transition name="typing-slide">
        <div v-if="typingUsers && typingUsers.length > 0"
          class="typing-indicator">
          <div class="typing-bubble">
            <span>
              {{
                typingUsers.length === 1
                  ? t("typing.one", { name: typingUsers[0].displayName })
                  : typingUsers.length <= 3 ? t("typing.few", {
                      names: typingUsers.map(u => u.displayName).join(", ")
                    }) : t("typing.many")
              }}
            </span>
            <span class="inline-flex gap-[1px] ml-1">
              <span class="dot"></span>
              <span class="dot dot2"></span>
              <span class="dot dot3"></span>
            </span>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Messages scroll area -->
    <div ref="parentRef" :class="cn('chat-scroll messages', classes)">
      <!-- Loading indicator at top -->
      <div v-if="isLoadingOlder" class="loading-indicator top">
        <Loader2Icon class="w-5 h-5 animate-spin text-muted-foreground" />
      </div>

      <div
        v-if="virtualizer?.getTotalSize"
        :style="{
          height: `${virtualizer?.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }"
      >
        <div
          v-for="item in virtualItems"
          :key="String(item.key)"
          :ref="(el) => measureItem(el as HTMLElement, item.index)"
          :data-index="item.index"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${item.start}px)`,
          }"
          class="chat-message"
        >
          <MessageItem
            :message="messages[item.index]"
            :get-msg-by-id="getMessageById"
            @dblclick="() => emit('select-reply', messages[item.index])"
            @reply="(msg) => emit('select-reply', msg)"
          />
        </div>
      </div>
    </div>

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
  shiftMeasuredIndices,
  scrollToBottomImmediate,
  scrollToBottom,
  scrollToIndex,
  handleScroll: rawHandleScroll,
  onScrollNearTop,
  resetMeasurements,
} = useChatScroll(
  () => messages.value,
  () => isRestoringScroll.value,
);

// Wire up scroll-near-top to load older messages
onScrollNearTop(() => {
  if (!isLoadingOlder.value && !hasReachedEnd.value && !isRestoringScroll.value) {
    loadOlderMessages((count) => {
      shiftMeasuredIndices(count);
      nextTick(() => scrollToIndex(count));
    });
  }
});

// Track scroll position for "scrolled up" state
const onScroll = () => {
  if (!parentRef.value || isRestoringScroll.value) return;
  const { scrollTop, scrollHeight, clientHeight } = parentRef.value;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  const wasScrolledUp = isScrolledUp.value;
  isScrolledUp.value = distanceFromBottom > 100;

  if (wasScrolledUp && !isScrolledUp.value) {
    newMessagesCount.value = 0;
  }

  rawHandleScroll();
};

// Replace the raw scroll with our enhanced one
if (parentRef.value) {
  parentRef.value.removeEventListener("scroll", rawHandleScroll as any);
  parentRef.value.addEventListener("scroll", onScroll, { passive: true });
}

const onScrollToBottomClick = () => {
  scrollToBottom();
  newMessagesCount.value = 0;
  isScrolledUp.value = false;
};

const emit = defineEmits<(e: "select-reply", message: ArgonMessage) => void>();

// Watch for channel changes — reload messages and subscribe
watch(
  () => props.channelId,
  async (newChannelId) => {
    resetMeasurements();
    await loadInitialMessages(() => scrollToBottomImmediate());
    subscribeToNewMessages(newChannelId, () => scrollToBottomImmediate());
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

/* Sticky header */
.sticky-header {
  position: relative;
  z-index: 10;
  background: hsl(var(--card));
  border-radius: 15px 15px 0 0;
  padding: 0 2.25rem;
  flex-shrink: 0;
}

.header-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0;
  border-bottom: 1px solid hsl(var(--border) / 0.35);
}

.channel-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1;
  color: hsl(var(--foreground));
}

.channel-icon {
  width: 1.1rem;
  height: 1.1rem;
  flex-shrink: 0;
  color: hsl(var(--muted-foreground));
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.625rem;
  width: 0.875rem;
  height: 0.875rem;
  color: hsl(var(--muted-foreground));
  pointer-events: none;
}

.search-input {
  padding: 0.375rem 0.625rem 0.375rem 2rem;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 8px;
  font-size: 0.8rem;
  color: hsl(var(--foreground));
  outline: none;
  transition: border-color 0.2s ease, width 0.2s ease;
  width: 160px;
}

.search-input:focus {
  border-color: hsl(var(--primary) / 0.6);
  width: 200px;
}

.search-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.7);
}

.notification-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.notification-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.typing-indicator {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
}

.typing-bubble {
  backdrop-filter: blur(8px);
  background: hsl(var(--card) / 0.92);
  border: 1px solid hsl(var(--border) / 0.3);
  border-radius: 0 0 8px 8px;
  padding: 0.375rem 0.875rem;
  font-size: 0.78rem;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}

.dot {
  display: inline-block;
  width: 3px;
  height: 3px;
  background: currentColor;
  border-radius: 50%;
  animation: dot-flash 1.5s infinite;
}

.dot2 { animation-delay: 0.3s; }
.dot3 { animation-delay: 0.6s; }

@keyframes dot-flash {
  0%, 100% { opacity: 0; }
  20% { opacity: 1; }
}

.typing-slide-enter-active,
.typing-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.typing-slide-enter-from,
.typing-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-6px);
}

.chat-message {
  word-wrap: break-word;
}

/* Scrollbar — always reserved space, subtle appearance */
.messages::-webkit-scrollbar {
  width: 6px;
}

.messages::-webkit-scrollbar-track {
  background: transparent;
}

.messages::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.08);
  border-radius: 3px;
  transition: background-color 0.2s;
}

.messages:hover::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.18);
}

.messages::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / 0.3);
}

/* Empty state */
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
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: hsl(var(--muted) / 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground) / 0.6);
}

.empty-chat-text {
  font-size: 0.82rem;
  color: hsl(var(--muted-foreground) / 0.7);
}

/* Scroll to bottom */
.scroll-to-bottom-btn {
  position: absolute;
  bottom: 16px;
  right: 24px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: hsl(var(--card));
  color: hsl(var(--foreground));
  border: 1px solid hsl(var(--border) / 0.5);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 2px 8px hsl(var(--foreground) / 0.08);
}

.scroll-to-bottom-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px hsl(var(--foreground) / 0.12);
}

.scroll-to-bottom-btn .arrow-icon {
  width: 20px;
  height: 20px;
}

.new-messages-count {
  position: absolute;
  top: -6px;
  right: -6px;
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

/* Loading indicator */
.loading-indicator {
  display: flex;
  justify-content: center;
  padding: 12px;
}

.loading-indicator.top {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  background: linear-gradient(to bottom, hsl(var(--card)), transparent);
}

/* Scroll button transition */
.scroll-btn-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.scroll-btn-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.scroll-btn-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.scroll-btn-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
