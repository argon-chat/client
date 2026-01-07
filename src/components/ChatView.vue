<template>
  <div class="chat-container" :style="{ '--chat-width': chatWidth + 'px' }">
    <div ref="parentRef" :class="cn('chat-scroll messages', classes)">
      <!-- Sticky header -->
      <div class="sticky-header">
        <div class="header-content">
          <h2 class="text-lg font-bold flex items-center">
            <component :is="channelType === 'announcement' ? AntennaIcon : HashIcon" class="mr-2 w-5 h-5" /> {{ channelName }}
          </h2>
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

      <!-- Empty state -->
      <div v-if="!isLoading && messages.length === 0" class="flex flex-col items-center justify-center h-full text-muted-foreground">
        <MessageSquareIcon class="w-12 h-12 mb-4 opacity-50" />
        <p>{{ t('no_messages_yet') }}</p>
      </div>
    </div>

    <!-- Scroll to bottom button - outside scroll container -->
    <Transition name="fade">
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
import {
  ref,
  onMounted,
  onUnmounted,
  nextTick,
  watch,
  computed,
  shallowRef,
} from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { AntennaIcon, CircleArrowDown, HashIcon, Loader2Icon, MessageSquareIcon } from "lucide-vue-next";

import MessageItem from "@/components/MessageItem.vue";

import { ArgonMessage, EntityType, IMessageEntity, MessageEntityMention } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";

import { useApi } from "@/store/apiStore";
import { usePoolStore } from "@/store/poolStore";
import { useMe } from "@/store/meStore";
import { useTone } from "@/store/toneStore";
import { useLocale } from "@/store/localeStore";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

import type { Subscription } from "rxjs";

const MESSAGES_PER_LOAD = 50;
const SCROLL_THRESHOLD = 150;
const MESSAGE_HEIGHT_ESTIMATE = 72;

const api = useApi();
const pool = usePoolStore();
const me = useMe();
const tone = useTone();
const { t } = useLocale();

const props = defineProps<{
  channelId: Guid;
  spaceId?: Guid;
  channelName?: string;
  channelType?: 'text' | 'announcement';
  typingUsers?: { displayName: string }[];
  class?: string;
}>();

const classes = computed(() => props.class);
const parentRef = ref<HTMLElement>();
const messages = shallowRef<ArgonMessage[]>([]);
const hasReachedEnd = ref(false);
const subs = ref<Subscription | null>(null);
const isScrolledUp = ref(false);
const newMessagesCount = ref(0);
const chatWidth = ref(0);
const isLoading = ref(false);
const isLoadingOlder = ref(false);
const isRestoringScroll = ref(false);
const measuredItems = new Set<number>();

// Get the oldest message ID for pagination
const oldestMessageId = computed(() => {
  if (messages.value.length === 0) return null;
  return messages.value[0].messageId;
});

const virtualizerOptions = computed(() => ({
  count: messages.value.length,
  getScrollElement: () => parentRef.value ?? null,
  estimateSize: () => MESSAGE_HEIGHT_ESTIMATE,
  overscan: 50,
  getItemKey: (index: number) => messages.value[index]?.messageId?.toString() ?? index,
}));

const virtualizer = useVirtualizer(virtualizerOptions);
const virtualItems = computed(() => virtualizer.value.getVirtualItems());

// Measure item only once to avoid jitter
const measureItem = (el: HTMLElement | null, index: number) => {
  if (!el || measuredItems.has(index)) return;
  measuredItems.add(index);
  virtualizer.value.measureElement(el);
};

// Debounced scroll trigger
let scrollLoadTimeout: ReturnType<typeof setTimeout> | null = null;

// Load older messages (scrolling up) 
const loadOlderMessages = async () => {
  if (isLoadingOlder.value || hasReachedEnd.value || !props.spaceId || isRestoringScroll.value) return;
  
  isLoadingOlder.value = true;
  isRestoringScroll.value = true;
  
  try {
    const fromId = oldestMessageId.value;
    
    const olderMessages = await api.channelInteraction.QueryMessages(
      props.spaceId,
      props.channelId,
      fromId,
      MESSAGES_PER_LOAD
    );

    if (!olderMessages || olderMessages.length === 0) {
      hasReachedEnd.value = true;
      return;
    }
    
    // Sort and prepend older messages
    const sortedOlder = [...olderMessages].sort((a, b) => 
      Number(a.messageId - b.messageId)
    );
    
    const addedCount = sortedOlder.length;
    
    // Shift measured indices since we're prepending
    const shiftedMeasured = new Set<number>();
    measuredItems.forEach(idx => shiftedMeasured.add(idx + addedCount));
    measuredItems.clear();
    shiftedMeasured.forEach(idx => measuredItems.add(idx));
    
    messages.value = [...sortedOlder, ...messages.value];

    // Wait for DOM update then scroll to maintain position
    await nextTick();
    
    // Scroll to the message that was at top (now at index = addedCount)
    virtualizer.value.scrollToIndex(addedCount, { align: 'start', behavior: 'auto' });

    if (olderMessages.length < MESSAGES_PER_LOAD) {
      hasReachedEnd.value = true;
    }
  } catch (error) {
    logger.error('Failed to load older messages:', error);
  } finally {
    isLoadingOlder.value = false;
    // Delay to prevent immediate re-trigger
    setTimeout(() => {
      isRestoringScroll.value = false;
    }, 200);
  }
};

// Initial message load
const loadInitialMessages = async () => {
  if (!props.spaceId) return;
  
  isLoading.value = true;
  messages.value = [];
  measuredItems.clear();
  hasReachedEnd.value = false;
  newMessagesCount.value = 0;
  isScrolledUp.value = false;

  try {
    const initialMessages = await api.channelInteraction.QueryMessages(
      props.spaceId,
      props.channelId,
      null,
      MESSAGES_PER_LOAD
    );

    if (initialMessages && initialMessages.length > 0) {
      messages.value = [...initialMessages].sort((a, b) => 
        Number(a.messageId - b.messageId)
      );

      if (initialMessages.length < MESSAGES_PER_LOAD) {
        hasReachedEnd.value = true;
      }
    }

    await nextTick();
    
    // Give virtualizer time to initialize and measure
    setTimeout(() => {
      scrollToBottomImmediate();
    }, 100);
  } catch (error) {
    logger.error('Failed to load initial messages:', error);
  } finally {
    isLoading.value = false;
  }
};

// Handle scroll events with debounce
const handleScroll = () => {
  if (!parentRef.value || isRestoringScroll.value) return;

  const { scrollTop, scrollHeight, clientHeight } = parentRef.value;
  
  // Check if scrolled up from bottom
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  const wasScrolledUp = isScrolledUp.value;
  isScrolledUp.value = distanceFromBottom > 100;
  
  // Reset new messages count when scrolled to bottom
  if (wasScrolledUp && !isScrolledUp.value) {
    newMessagesCount.value = 0;
  }

  // Debounce load trigger to prevent rapid firing
  if (scrollLoadTimeout) clearTimeout(scrollLoadTimeout);
  
  scrollLoadTimeout = setTimeout(() => {
    if (scrollTop < SCROLL_THRESHOLD && !isLoadingOlder.value && !hasReachedEnd.value && !isRestoringScroll.value) {
      loadOlderMessages();
    }
  }, 100);
};

const scrollToBottomImmediate = () => {
  if (messages.value.length === 0) return;
  
  const lastIndex = messages.value.length - 1;
  
  // Multiple attempts to ensure scroll lands at bottom after measurements
  virtualizer.value.scrollToIndex(lastIndex, { align: 'end', behavior: 'auto' });
  
  requestAnimationFrame(() => {
    virtualizer.value.scrollToIndex(lastIndex, { align: 'end', behavior: 'auto' });
    
    // Final fallback after elements are measured
    setTimeout(() => {
      if (parentRef.value) {
        parentRef.value.scrollTop = parentRef.value.scrollHeight;
      }
      newMessagesCount.value = 0;
      isScrolledUp.value = false;
    }, 50);
  });
};

const scrollToBottom = () => {
  if (messages.value.length === 0) return;
  
  const lastIndex = messages.value.length - 1;
  
  // Use auto behavior - smooth is not supported with dynamic sizes
  virtualizer.value.scrollToIndex(lastIndex, { align: 'end', behavior: 'auto' });
  
  // Fallback: directly scroll the container to bottom
  requestAnimationFrame(() => {
    if (parentRef.value) {
      parentRef.value.scrollTop = parentRef.value.scrollHeight;
    }
  });
  
  newMessagesCount.value = 0;
  isScrolledUp.value = false;
};

const onScrollToBottomClick = () => scrollToBottom();

const getMessageById = (messageId: bigint | null): ArgonMessage => {
  return messages.value.find((x) => x.messageId === (messageId ?? 0n)) ?? ({} as ArgonMessage);
};

const emit = defineEmits<(e: "select-reply", message: ArgonMessage) => void>();

const filterMention = (e: IMessageEntity): e is MessageEntityMention => {
  return e.type === EntityType.Mention;
};

const updateChatWidth = () => {
  if (parentRef.value) {
    chatWidth.value = parentRef.value.offsetWidth;
  }
};

// Watch for channel changes
watch(
  () => props.channelId,
  async (newChannelId) => {
    subs.value?.unsubscribe();

    await loadInitialMessages();

    subs.value = pool.onNewMessageReceived.subscribe((e) => {
      if (newChannelId === e.channelId) {
        messages.value = [...messages.value, e];

        // Play notification if mentioned
        if (e.entities.filter(filterMention).find((x) => x.userId === me.me?.userId)) {
          tone.playNotificationSound();
        }

        // Auto-scroll or increment counter
        if (e.sender === me.me?.userId) {
          nextTick(() => scrollToBottomImmediate());
        } else if (isScrolledUp.value) {
          newMessagesCount.value++;
        } else {
          nextTick(() => scrollToBottomImmediate());
        }
      }
    });
  },
  { immediate: true }
);

onMounted(() => {
  nextTick(() => {
    if (parentRef.value) {
      parentRef.value.addEventListener("scroll", handleScroll, { passive: true });
      chatWidth.value = parentRef.value.offsetWidth;
    }
  });
  window.addEventListener("resize", updateChatWidth);
});

onUnmounted(() => {
  subs.value?.unsubscribe();
  if (scrollLoadTimeout) clearTimeout(scrollLoadTimeout);
  if (parentRef.value) {
    parentRef.value.removeEventListener("scroll", handleScroll);
  }
  window.removeEventListener("resize", updateChatWidth);
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
}

.chat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  position: relative;
  padding: 0 8px 8px 8px;
  background: hsl(var(--card));
  border-radius: 0.5rem;
}

/* Sticky header */
.sticky-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: hsl(var(--card) / 0.85);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: 0.5rem 0.5rem 0 0;
  margin: 0 -8px 0 -8px;
  padding: 0 8px;
}

.header-content {
  padding: 1rem;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
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
  background: hsl(var(--foreground) / 0.1);
  border-radius: 0 0 0.5rem 0.5rem;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

.dot {
  display: inline-block;
  width: 4px;
  height: 4px;
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
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.typing-slide-enter-from,
.typing-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

.chat-message {
  word-wrap: break-word;
}

.messages::-webkit-scrollbar {
  width: 6px;
}

.messages::-webkit-scrollbar-thumb {
  background-color: hsl(var(--foreground) / 0.2);
  border-radius: 3px;
}

.messages::-webkit-scrollbar-thumb:hover {
  background-color: hsl(var(--foreground) / 0.3);
}

/* Scroll to bottom button - fixed within container */
.scroll-to-bottom-btn {
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.scroll-to-bottom-btn:hover {
  transform: scale(1.1);
  background-color: hsl(var(--primary) / 0.9);
}

.scroll-to-bottom-btn .arrow-icon {
  width: 24px;
  height: 24px;
}

.new-messages-count {
  position: absolute;
  top: -8px;
  right: -8px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background-color: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
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
  background: linear-gradient(to bottom, hsl(var(--background)), transparent);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
