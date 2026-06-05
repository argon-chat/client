<template>
  <div class="relative h-full w-full flex flex-col min-h-0 bg-card">
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

    <!-- ═══ Message list ═══ -->
    <ChatMessageList
      ref="listRef"
      class="flex-1 min-h-0"
      :source="getMessages"
      :grouping-map="groupingMap"
      :get-message-by-id="getMessageById"
      :is-loading="isLoading"
      :is-loading-older="isLoadingOlder"
      :is-scrolled-up="isScrolledUp"
      :new-messages-count="newMessagesCount"
      :can-react="canReact"
      :toggle-reaction="toggleReaction"
      @select-reply="(m) => emit('select-reply', m)"
      @retry="retryMessage"
      @near-top="onNearTop"
      @scroll-state="onScrollState"
      @reset-unread="onResetUnread"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import { AntennaIcon, BellIcon, HashIcon } from "lucide-vue-next";
import { type ArgonMessage, MuteLevelType, MuteTargetKind } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { Popover, PopoverTrigger, PopoverContent } from "@argon/ui/popover";

import ChatMessageList from "@/components/chats/ChatMessageList.vue";

import { useLocale } from "@/store/system/localeStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import { useChatMessages } from "@/composables/useChatMessages";
import { useMessageReactions } from "@/composables/useMessageReactions";
import { useMessageGrouping } from "@/composables/useMessageGrouping";

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
}>();

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

// ── Data ──

const {
  messages, hasReachedEnd, isLoading, isLoadingOlder,
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

const { groupingMap } = useMessageGrouping(messages, {
  lastReadId: () => ntf.readStates?.get(props.channelId)?.lastReadMessageId,
});

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

function onScrollState(distanceFromBottom: number) {
  const was = isScrolledUp.value;
  isScrolledUp.value = distanceFromBottom > 100;
  if (was && !isScrolledUp.value) newMessagesCount.value = 0;

  // ACK when at bottom
  if (distanceFromBottom <= 100 && messages.value.length) {
    const last = messages.value[messages.value.length - 1];
    if (last && !last._optimistic) ntf.scheduleAck(props.channelId, last.messageId, props.spaceId);
  }
}

function onResetUnread() {
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

    listRef.value?.resetScroller();
    subscribeToNewMessages(newId, () => listRef.value?.scrollToBottomImmediate());
    unsubReactions();
    subReactions();
    await loadInitialMessages(() => listRef.value?.scrollToBottomImmediate());

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
</style>
