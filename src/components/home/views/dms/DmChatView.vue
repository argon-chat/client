<template>
  <div :class="cn('relative h-full w-full flex flex-col min-h-0 bg-card', externalClass)">
    <!-- ═══ Typing indicator ═══ -->
    <Transition name="typing-slide">
      <div
        v-if="typingUsers?.length"
        class="absolute top-0 left-1/2 -translate-x-1/2 z-20"
      >
        <div
          class="flex items-center backdrop-blur-[10px] bg-card/[0.88] border border-border/20 rounded-b-[10px] px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap shadow-sm"
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

    <!-- ═══ Message list (two-sided in DMs) ═══ -->
    <ChatMessageList
      ref="listRef"
      class="flex-1 min-h-0"
      two-sided
      :source="getMessages"
      :grouping-map="groupingMap"
      :get-message-by-id="getMessageById"
      :is-loading="isLoading"
      :is-loading-older="isLoadingOlder"
      :is-scrolled-up="isScrolledUp"
      :new-messages-count="newMessagesCount"
      @select-reply="(m) => emit('select-reply', m)"
      @retry="retryMessage"
      @near-top="onNearTop"
      @scroll-state="onScrollState"
      @reset-unread="onResetUnread"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { cn } from "@argon/core";
import type { ArgonMessage } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

import ChatMessageList from "@/components/chats/ChatMessageList.vue";

import { useLocale } from "@/store/system/localeStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import { useRecentChatsStore } from "@/store/chat/useRecentChatsStore";
import { useDirectMessages } from "@/composables/useDirectMessages";
import { useMessageGrouping } from "@/composables/useMessageGrouping";
import { useApi } from "@/store/system/apiStore";

// ── Stores ──

const { t } = useLocale();
const ntf = useNotificationStore();
const api = useApi();
const recentChats = useRecentChatsStore();

// ── Props / Emits ──

const props = defineProps<{
  peerId: Guid;
  peerName?: string;
  typingUsers?: { displayName: string }[];
  class?: string;
}>();

const externalClass = computed(() => props.class);

const emit = defineEmits<(e: "select-reply", message: ArgonMessage) => void>();

// ── Typing text ──

const typingText = computed(() => {
  const users = props.typingUsers ?? [];
  if (users.length === 1) return t("typing.one", { name: users[0].displayName });
  if (users.length <= 3) return t("typing.few", { names: users.map((u) => u.displayName).join(", ") });
  return t("typing.many");
});

// ── Data ──

const {
  messages, hasReachedEnd, isLoading, isLoadingOlder,
  newMessagesCount, isScrolledUp,
  loadOlderMessages, loadInitialMessages, subscribeToNewMessages,
  getMessageById, addOptimisticMessage, resolveOptimisticMessage,
  markOptimisticFailed, retryMessage,
  cleanup: cleanupMessages,
} = useDirectMessages(() => props.peerId);

const { groupingMap } = useMessageGrouping(messages);

// Stable getter — passes the real shallowRef into the list (keeps triggerRef reactivity).
const getMessages = () => messages;

// ── List ref ──

const listRef = ref<InstanceType<typeof ChatMessageList> | null>(null);
function scrollToBottomImmediate() {
  listRef.value?.scrollToBottomImmediate();
}

// ── Scroll callbacks ──

function onNearTop() {
  if (!isLoadingOlder.value && !hasReachedEnd.value) {
    loadOlderMessages({ beforePrepend: () => {}, afterPrepend: () => {} });
  }
}

const markedReadForPeer = ref<string | null>(null);

function markDmAsRead() {
  if (markedReadForPeer.value === props.peerId) return;
  markedReadForPeer.value = props.peerId;

  const chat = recentChats.recent.find((x) => x.peerId === props.peerId);
  const unread = chat?.unreadCount ?? 0;

  recentChats.markRead(props.peerId);
  if (unread > 0) {
    ntf.unreadDmCount = Math.max(0, ntf.unreadDmCount - unread);
  }

  // Notify the server so it persists across sessions
  api.userChatInteractions.MarkChatRead(props.peerId as Guid).catch(() => {});
}

function onScrollState(distanceFromBottom: number) {
  const was = isScrolledUp.value;
  isScrolledUp.value = distanceFromBottom > 100;
  if (was && !isScrolledUp.value) newMessagesCount.value = 0;

  if (distanceFromBottom <= 100) {
    markDmAsRead();
  }
}

function onResetUnread() {
  newMessagesCount.value = 0;
  isScrolledUp.value = false;
}

// ── Expose for parent ──

defineExpose({ addOptimisticMessage, resolveOptimisticMessage, markOptimisticFailed, scrollToBottomImmediate });

// ── Peer lifecycle ──

watch(
  () => props.peerId,
  async (newId) => {
    markedReadForPeer.value = null;
    listRef.value?.resetScroller();
    subscribeToNewMessages(newId, () => listRef.value?.scrollToBottomImmediate());
    await loadInitialMessages(() => listRef.value?.scrollToBottomImmediate());
  },
  { immediate: true },
);

onUnmounted(() => {
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
</style>
