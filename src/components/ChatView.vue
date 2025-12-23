<template>
  <div ref="parentRef" :class="cn('chat-scroll messages', classes)" :style="{ '--chat-width': chatWidth + 'px' }">
<!--                                 Я ЭТУ ХУЙНЮ НЕ ОСИЛИЛ                               -->
<!--    <button v-if="isScrolledUp" @click="scrollToBottom" class="scroll-to-bottom-btn">-->
<!--      <CircleArrowDown class="arrow-icon" />-->
<!--      <div v-if="newMessagesCount > 0" class="new-messages-count">-->
<!--        {{ newMessagesCount > 99 ? '99+' : newMessagesCount }}-->
<!--      </div>-->
<!--    </button>-->

    <div
      v-if="virtualizer?.getTotalSize"
      :style="{
        height: `${virtualizer?.getTotalSize()}px`,
        width: '100%',
        position: 'relative',
      }"
    >
      <div
        v-for="item in virtualizer?.getVirtualItems() || []"
        :key="messages[item.index]?.messageId?.toString() || item.index"
        :style="{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: `${item.size}px`,
          transform: `translateY(${item.start}px)`,
        }"
        class="chat-message"
      >
        <MessageItem
          :message="messages[item.index]"
          :get-msg-by-id="getMessageById"
          @dblclick="() => emit('select-reply', messages[item.index])"
        />
      </div>
    </div>

    <Separator v-if="hasEnded" orientation="horizontal"> </Separator>
    <div v-if="hasEnded" style="text-align: center;"> END </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  shallowRef,
  onMounted,
  onUnmounted,
  nextTick,
  watch,
  computed,
  watchEffect,
} from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";

import { Separator } from "@/components/ui/separator";
import MessageItem from "@/components/MessageItem.vue";

import { ArgonMessage, EntityType, IMessageEntity, MessageEntityMention } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";

import { useApi } from "@/store/apiStore";
import { usePoolStore } from "@/store/poolStore";
import { useMe } from "@/store/meStore.ts";
import { useTone } from "@/store/toneStore";
import { cn } from "@/lib/utils";

import type { Subscription } from "rxjs";
import { v7 } from "uuid";

const TOTAL_MESSAGES = 1_000_000;
const MESSAGES_PER_LOAD = 100;
const WINDOW_SIZE = 300;
const LOAD_CHUNK = 100;

const api = useApi();
const pool = usePoolStore();
const me = useMe();
const tone = useTone();

const props = defineProps<{
  channelId: Guid;
  class?: string;
}>();

const classes = computed(() => props.class);
const parentRef = ref<HTMLElement>();
const messages = ref([] as ArgonMessage[]);
const hasEnded = ref(false);
const subs = ref(null as null | Subscription);
const currentSizeMsgs = ref(0);
const isScrolledUp = ref(false);
const newMessagesCount = ref(0);
const chatWidth = ref(0);
const firstLoadedIndex = ref(0);
const lastLoadedIndex = ref(0);

const generateMockMessage = (index: number): ArgonMessage => {
  const messageId = BigInt(index);
  const isMyMessage = index % 3 === 0;

  // @ts-expect-error Завали ебало, пожалуйста.
  return {
    messageId,
    replyId: null,
    channelId: props.channelId,
    spaceId: props.channelId,
    sender: isMyMessage ? (me.me?.userId ?? '0') : `user-${Math.floor(Math.random() * 1000)}`,
    text: `Mock message ${index} - ${Array(Math.floor(Math.random() * 50) + 10).fill('text').join(' ')}`,
    timeSent: {
      date: new Date(Date.now() - (TOTAL_MESSAGES - index) * 1000),
    },
    entities: [],
  } as ArgonMessage;
};

const mockLoad = (from: number, to: number): ArgonMessage[] => {
  const arr: ArgonMessage[] = [];

  for (let i = from; i < to; i++) {
    arr.push(generateMockMessage(i));
  }

  return arr;
};

const virtualizerOptions = computed(() => ({
  count: messages.value.length,
  getScrollElement: () => parentRef.value,
  estimateSize: () => 65,
  overscan: 10,
}));

// @ts-expect-error Завали ебало, пожалуйста.
const virtualizer = useVirtualizer(virtualizerOptions);

const virtualItems = computed(() => virtualizer.value.getVirtualItems());

let isLoadingMore = false;

const trimBottom = () => {
  if (messages.value.length <= WINDOW_SIZE) {
    return;
  }

  const excess = messages.value.length - WINDOW_SIZE;

  messages.value.splice(messages.value.length - excess, excess);
  lastLoadedIndex.value -= excess;
};

const trimTop = async () => {
  if (messages.value.length <= WINDOW_SIZE || !parentRef.value) {
    return;
  }

  const excess = messages.value.length - WINDOW_SIZE;
  const prevHeight = parentRef.value.scrollHeight;

  messages.value.splice(0, excess);
  firstLoadedIndex.value += excess;

  await nextTick();

  if (parentRef.value) {
    const newHeight = parentRef.value.scrollHeight;
    parentRef.value.scrollTop -= prevHeight - newHeight;
  }
};

const loadOlder = async () => {
  if (firstLoadedIndex.value <= 0) {
    hasEnded.value = true;
    return;
  }

  const from = Math.max(0, firstLoadedIndex.value - LOAD_CHUNK);
  const to = firstLoadedIndex.value;

  const older = mockLoad(from, to);

  const prevHeight = parentRef.value!.scrollHeight;

  messages.value.unshift(...older);
  firstLoadedIndex.value = from;

  await nextTick();

  if (parentRef.value) {
    const newHeight = parentRef.value.scrollHeight;
    parentRef.value.scrollTop += newHeight - prevHeight;
  }

  trimBottom();
};

const loadNewer = async () => {
  if (lastLoadedIndex.value >= TOTAL_MESSAGES) {
    return;
  }

  const from = lastLoadedIndex.value;
  const to = Math.min(TOTAL_MESSAGES, from + LOAD_CHUNK);

  const newer = mockLoad(from, to);

  messages.value.push(...newer);
  lastLoadedIndex.value = to;

  await nextTick();
  await trimTop();
};

const triggerLoadOlder = () => {
  if (isLoadingMore || !parentRef.value) {
    return;
  }

  console.log('LOADING OLDER! Current messages:', messages.value.length, 'First index:', firstLoadedIndex.value);
  isLoadingMore = true;

  loadOlder().then(() => {
    setTimeout(() => {
      isLoadingMore = false;
    }, 300);
  });
};

const triggerLoadNewer = () => {
  if (isLoadingMore || !parentRef.value) {
    return;
  }

  console.log('LOADING NEWER! Current messages:', messages.value.length, 'Last index:', lastLoadedIndex.value);
  isLoadingMore = true;

  loadNewer().then(() => {
    setTimeout(() => {
      isLoadingMore = false;
    }, 300);
  });
};

watchEffect(() => {
  const items = virtualItems.value;
  if (!items || items.length === 0) {
    return;
  }

  const firstItem = items[0];
  const lastItem = items[items.length - 1];

  if (firstItem && firstItem.index < 10 && !isLoadingMore && firstLoadedIndex.value > 0) {
    console.log('watchEffect trigger - loading older, firstItem.index:', firstItem.index);
    triggerLoadOlder();
  }

  if (lastItem && lastItem.index > messages.value.length - 10 && !isLoadingMore && lastLoadedIndex.value < TOTAL_MESSAGES) {
    console.log('watchEffect trigger - loading newer, lastItem.index:', lastItem.index);
    triggerLoadNewer();
  }
});

const handleScroll = () => {
  if (!parentRef.value || isLoadingMore) {
    return;
  }

  const scrollTop = parentRef.value.scrollTop;
  const scrollHeight = parentRef.value.scrollHeight;
  const clientHeight = parentRef.value.clientHeight;

  if (scrollTop < 800 && !isLoadingMore && firstLoadedIndex.value > 0) {
    console.log('scroll event trigger - loading older, scrollTop:', scrollTop);
    triggerLoadOlder();
  }

  if (scrollHeight - scrollTop - clientHeight < 800 && !isLoadingMore && lastLoadedIndex.value < TOTAL_MESSAGES) {
    console.log('scroll event trigger - loading newer');
    triggerLoadNewer();
  }
};

let rafId: number | null = null;

const checkScrollPosition = () => {
  if (!parentRef.value) {
    return;
  }

  const scrollTop = parentRef.value.scrollTop;
  const scrollHeight = parentRef.value.scrollHeight;
  const clientHeight = parentRef.value.clientHeight;

  if (scrollTop < 800 && !isLoadingMore && firstLoadedIndex.value > 0) {
    triggerLoadOlder();
  }

  if (scrollHeight - scrollTop - clientHeight < 800 && !isLoadingMore && lastLoadedIndex.value < TOTAL_MESSAGES) {
    triggerLoadNewer();
  }

  rafId = requestAnimationFrame(checkScrollPosition);
};

onMounted(() => {
  nextTick(() => {
    if (parentRef.value) {
      parentRef.value.addEventListener("scroll", handleScroll);
      chatWidth.value = parentRef.value.offsetWidth;

      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  });

  rafId = requestAnimationFrame(checkScrollPosition);
  window.addEventListener("resize", updateChatWidth);
});

const getMessageById = (messageId: bigint | null): ArgonMessage => {
  return (
    messages.value.find((x) => x.messageId === (messageId ?? 0n)) ??
    ({} as ArgonMessage)
  );
};

const emit =
  defineEmits<(e: "select-reply", message: ArgonMessage) => void>();

const scrollToBottom = () => {
  if (!parentRef.value) {
    return;
  }

  parentRef.value.scrollTop = parentRef.value.scrollHeight;

  nextTick(() => {
    checkIsScrolledUp();
  });
};

const checkIsScrolledUp = () => {
  if (!parentRef.value) {
    return;
  }

  const { scrollTop, scrollHeight, clientHeight } = parentRef.value;
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;

  if (!isAtBottom) {
    isScrolledUp.value = true;
  } else {
    newMessagesCount.value = 0;
    isScrolledUp.value = false;
  }
};

const loadMessages = () => {
  messages.value = [];
  hasEnded.value = false;
  currentSizeMsgs.value = 0;
  newMessagesCount.value = 0;

  const startIndex = Math.max(0, TOTAL_MESSAGES - MESSAGES_PER_LOAD);
  const endIndex = TOTAL_MESSAGES;

  messages.value = mockLoad(startIndex, endIndex);

  firstLoadedIndex.value = startIndex;
  lastLoadedIndex.value = endIndex;

  nextTick(() => {
    if (parentRef.value) {
      scrollToBottom();
      checkIsScrolledUp();
      isScrolledUp.value = false;
    }
  });
};

watch(
  () => props.channelId,
  (newChannelId) => {
    subs.value?.unsubscribe();

    loadMessages();

    subs.value = pool.onNewMessageReceived.subscribe((e) => {
      if (newChannelId === e.channelId) {
        messages.value.push(e);
        lastLoadedIndex.value++;

        if (
          e.entities.filter(filterMention).find((x) => x.userId === me.me?.userId)
        ) {
          tone.playNotificationSound();
        }

        nextTick(checkIsScrolledUp);

        if (e.sender === me.me?.userId) {
          setTimeout(scrollToBottom, 50);
        } else {
          if (isScrolledUp.value) {
            newMessagesCount.value++;
          } else {
            setTimeout(scrollToBottom, 50);
          }
        }
      }
    });
  },
  { immediate: true },
);

const filterMention = (e: IMessageEntity): e is MessageEntityMention => {
  return e.type === EntityType.Bold;
};


const updateChatWidth = () => {
  if (parentRef.value) {
    chatWidth.value = parentRef.value.offsetWidth;
  }
};

onUnmounted(() => {
  subs.value?.unsubscribe();
  if (parentRef.value) {
    parentRef.value.removeEventListener("scroll", handleScroll);
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  window.removeEventListener("resize", updateChatWidth);
});
</script>

<style scoped>
/* Христа ради, все стили ниже не трогай, сломается нахуй всё */
.chat-scroll {
  height: 100%;
  overflow-y: auto;
  position: relative;
  padding: 8px;
}

.chat-message {
  word-wrap: break-word;
}

.messages::-webkit-scrollbar {
  width: 6px;
}

.messages::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
</style>
