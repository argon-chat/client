<template>
  <div class="chat-container">
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
          :data-index="item.index"
          :ref="(el) => measureItem(el as HTMLElement | null, item.index)"
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
            :message="convertToArgonMessage(messages[item.index])"
            :get-msg-by-id="(id) => convertToArgonMessage(getMessageById(id))"
            @reply="emit('select-reply', messages[item.index])"
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
          {{ newMessagesCount }}
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
import { CircleArrowDown, Loader2Icon, MessageSquareIcon } from "lucide-vue-next";

import MessageItem from "@/components/MessageItem.vue";

import { DirectMessage, EntityType, IMessageEntity, MessageEntityMention, ArgonMessage, DirectMessageSent } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";

import { useApi } from "@/store/apiStore";
import { usePoolStore } from "@/store/poolStore";
import { useMe } from "@/store/meStore";
import { useTone } from "@/store/toneStore";
import { useLocale } from "@/store/localeStore";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

import type { Subscription } from "rxjs";
import { useBus } from "@/store/busStore";

const MESSAGES_PER_LOAD = 50;
const SCROLL_THRESHOLD = 150;
const MESSAGE_HEIGHT_ESTIMATE = 72;

const api = useApi();
const pool = usePoolStore();
const me = useMe();
const tone = useTone();
const bus = useBus();
const { t } = useLocale();

const props = defineProps<{
  peerId: Guid;
  peerName?: string;
  class?: string;
}>();

// Convert DirectMessage to ArgonMessage format for MessageItem compatibility
const convertToArgonMessage = (dm: DirectMessage): ArgonMessage => {
  if (!dm || !dm.messageId) return {} as ArgonMessage;
  
  return {
    messageId: dm.messageId,
    replyId: dm.replyTo,
    channelId: props.peerId, // Use peerId as channel identifier for DMs
    spaceId: "", // Empty for DMs
    timeSent: dm.createdAt,
    sender: dm.senderId,
    text: dm.text,
    entities: dm.entities,
    version: 1,
  } as ArgonMessage;
};

const classes = computed(() => props.class);
const parentRef = ref<HTMLElement>();
const messages = shallowRef<DirectMessage[]>([]);
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
  if (isLoadingOlder.value || hasReachedEnd.value || isRestoringScroll.value) return;
  
  isLoadingOlder.value = true;
  isRestoringScroll.value = true;
  
  try {
    const fromId = oldestMessageId.value;
    if (!fromId) {
      hasReachedEnd.value = true;
      return;
    }

    const olderMessages = await api.userChatInteractions.QueryDirectMessages(
      props.peerId,
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
    logger.error('Failed to load older DM messages:', error);
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
  isLoading.value = true;
  messages.value = [];
  measuredItems.clear();
  hasReachedEnd.value = false;
  newMessagesCount.value = 0;
  isScrolledUp.value = false;

  try {
    const initialMessages = await api.userChatInteractions.QueryDirectMessages(
      props.peerId,
      null,
      MESSAGES_PER_LOAD
    );

    logger.log('Initial DM messages loaded:', initialMessages);

    if (initialMessages && initialMessages.length > 0) {
      messages.value = [...initialMessages].sort((a, b) => 
        Number(a.messageId - b.messageId)
      );

      if (initialMessages.length < MESSAGES_PER_LOAD) {
        hasReachedEnd.value = true;
      }

      await nextTick();
      setTimeout(() => {
        scrollToBottomImmediate();
      }, 100);
    } else {
      await nextTick();
    }
  } catch (error) {
    logger.error('Failed to load initial DM messages:', error);
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

const getMessageById = (messageId: bigint | null): DirectMessage => {
  return messages.value.find((x) => x.messageId === (messageId ?? 0n)) ?? ({} as DirectMessage);
};

const emit = defineEmits<(e: "select-reply", message: DirectMessage) => void>();

const filterMention = (e: IMessageEntity): e is MessageEntityMention => {
  return e.type === EntityType.Mention;
};

const updateChatWidth = () => {
  if (parentRef.value) {
    chatWidth.value = parentRef.value.offsetWidth;
  }
};

// Watch for peer changes
watch(
  () => props.peerId,
  async (newPeerId) => {
    subs.value?.unsubscribe();

    await loadInitialMessages();

    // Subscribe to new DM messages
    subs.value = bus.onServerEvent<DirectMessageSent>("DirectMessageSent", async (e: DirectMessageSent) => {
      if (e.senderId === newPeerId || e.receiverId === newPeerId) {
        const dmMessage = e.message;
        
        messages.value = [...messages.value, dmMessage];

        // Play notification if mentioned
        if (dmMessage.entities.filter(filterMention).find((x) => x.userId === me.me?.userId)) {
          tone.playNotificationSound();
        }

        // Auto-scroll or increment counter
        if (dmMessage.senderId === me.me?.userId) {
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
  padding: 8px;
  background: hsl(var(--card));
  border-radius: 0.5rem;
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
