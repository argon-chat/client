<template>
  <div ref="scroller" class="chat-scroll messages" :style="{ '--chat-width': chatWidth + 'px' }">
    <button v-if="isScrolledUp" @click="scrollToBottom" class="scroll-to-bottom-btn">
      <CircleArrowDown class="arrow-icon" />
      <div v-if="newMessagesCount > 0" class="new-messages-count">
        {{ newMessagesCount > 99 ? '99+' : newMessagesCount }}
      </div>
    </button>

    <div v-for="(message) in messages" :key="message.MessageId" class="chat-message">
      <MessageItem :message="message" :get-msg-by-id="getMessageById" @dblclick="() => emit('select-reply', message)" />
    </div>
    <Separator v-if="hasEnded" orientation="horizontal"> </Separator>
    <div v-if="hasEnded" style="text-align: center;"> END </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, useTemplateRef, onUnmounted, nextTick, watch } from 'vue'
import { useInfiniteScroll } from '@vueuse/core'
import { CircleArrowDown } from 'lucide-vue-next';
import MessageItem from '@/components/MessageItem.vue'
import { useApi } from '@/store/apiStore'
import { Separator } from '@/components/ui/separator'
import { usePoolStore } from '@/store/poolStore';
import { Subscription } from 'rxjs';
import { useMe } from "@/store/meStore.ts";
import { useTone } from '@/store/toneStore';

const api = useApi();
const pool = usePoolStore();
const props = defineProps<{
  channelId: Guid
}>()

const scroller = useTemplateRef<HTMLElement>("scroller");
const messages = ref([] as IArgonMessageDto[]);
const hasEnded = ref(false);
const subs = ref(null as null | Subscription);
const currentSizeMsgs = ref(0);
const isScrolledUp = ref(false);
const newMessagesCount = ref(0);
const chatWidth = ref(0);
const me = useMe();
const tone = useTone();

const getMessageById = (messageId: number): IArgonMessageDto => {
  return messages.value.find(x => x.MessageId == messageId)!;
}

const emit = defineEmits<{
  (e: 'select-reply', message: IArgonMessageDto): void
}>();

const scrollToBottom = () => {
  if (!scroller.value) return;

  const { scrollHeight, clientHeight } = scroller.value;
  scroller.value.scrollTop = scrollHeight - clientHeight;

  nextTick(() => {
    checkScrollPosition();
  });
};

const checkScrollPosition = () => {
  if (!scroller.value) return;

  if (scroller.value.scrollTop < -10) {
    isScrolledUp.value = true;
  } else {
    newMessagesCount.value = 0;
    isScrolledUp.value = false;
  }
};

useInfiniteScroll(scroller, async () => {
  if (hasEnded.value) return;

  const result = await api.serverInteraction.GetMessages(props.channelId, 10, currentSizeMsgs.value);
  if (result.length === 0) {
    hasEnded.value = true;
    return;
  }

  const existingIds = new Set(messages.value.map(msg => msg.MessageId));
  const uniqueNewMessages = result.filter(msg => !existingIds.has(msg.MessageId));
  currentSizeMsgs.value += uniqueNewMessages.length;
  messages.value.push(...uniqueNewMessages);
}, {
  distance: 100,
  direction: "top",
  canLoadMore: () => !hasEnded.value
});

const loadMessages = async (channelId: Guid) => {
  messages.value = [];
  hasEnded.value = false;
  currentSizeMsgs.value = 0;
  newMessagesCount.value = 0;

  messages.value = await api.serverInteraction.GetMessages(channelId, 10, 0);
  currentSizeMsgs.value = messages.value.length;

  nextTick(() => {
    if (scroller.value) {
      scrollToBottom();
      checkScrollPosition();
      isScrolledUp.value = false;
    }
  });
};

watch(() => props.channelId, async (newChannelId) => {
  subs.value?.unsubscribe();

  await loadMessages(newChannelId);

  subs.value = pool.onNewMessageReceived.subscribe((e) => {
    if (newChannelId === e.ChannelId) {
      messages.value.unshift(e);
      // TODO reply
      if (e.Entities.filter(filterMention).find(x => x.UserId == me.me?.Id)) {
        tone.playNotificationSound();
      }

      nextTick(checkScrollPosition);

      if (e.Sender === me.me?.Id) {
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
}, { immediate: true });

const filterMention = (e: IMessageEntity): e is IMessageEntityMention => {
  return e.Type == 'Mention';
}


onMounted(() => {
  if (scroller.value) {
    scroller.value.addEventListener('scroll', checkScrollPosition);
  }

  nextTick(() => {
    if (scroller.value) {
      chatWidth.value = scroller.value.offsetWidth;
    }
  });

  window.addEventListener('resize', updateChatWidth);
});

const updateChatWidth = () => {
  if (scroller.value) {
    chatWidth.value = scroller.value.offsetWidth;
  }
};

onUnmounted(() => {
  subs.value?.unsubscribe();
  if (scroller.value) {
    scroller.value.removeEventListener('scroll', checkScrollPosition);
  }
  window.removeEventListener('resize', updateChatWidth);
});
</script>

<style scoped>
.chat-scroll {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column-reverse;
  position: relative;
  padding: 8px;
  gap: 8px;
}

.chat-message {
  padding: 8px;
  word-wrap: break-word;
}

.messages::-webkit-scrollbar {
  width: 6px;
}

.messages::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.scroll-to-bottom-btn {
  position: fixed;
  right: calc(50% - var(--chat-width) / 2 + 20px);
  width: 40px;
  height: 40px;
  background-color: #222;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
  z-index: 100;
}

.scroll-to-bottom-btn:hover {
  background-color: rgba(100, 100, 100, 0.8);
  transform: scale(1.1);
}

.scroll-to-bottom-btn:active {
  transform: scale(0.95);
}

.arrow-icon {
  color: white;
  width: 20px;
  height: 20px;
}

.new-messages-count {
  position: absolute;
  top: -6px;
  right: -6px;
  background-color: hsl(0, 72%, 50%);
  color: white;
  border-radius: 10px;
  min-width: 18px;
  height: 18px;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  font-weight: bold;
}
</style>
