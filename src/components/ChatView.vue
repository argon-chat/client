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

        <!-- Follow: announcement channels only; ml-auto keeps it beside the bell -->
        <button
          v-if="channelType === 'announcement' && spaceId"
          class="icon-motion icon-motion--pop ml-auto flex items-center gap-1.5 h-8 px-2.5 bg-transparent border-none rounded-lg text-[13px] font-medium text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
          :title="t('follow_channel_hint')"
          data-testid="follow-channel"
          @click="followOpen = true"
        >
          <RssIcon class="w-4 h-4" />
          {{ t('follow_channel') }}
        </button>
        <PinnedMessagesButton
          class="-mr-2"
          :class="{ 'ml-auto': channelType !== 'announcement' || !spaceId }"
          :channel-id="channelId"
          :space-id="spaceId"
          :jump-to="jumpToPinned"
        />

        <!-- Mute bell -->
        <Popover>
          <PopoverTrigger as-child>
            <button
              class="icon-motion icon-motion--shake relative flex items-center justify-center w-8 h-8 bg-transparent border-none rounded-lg text-muted-foreground cursor-pointer transition-colors hover:bg-accent hover:text-foreground"
              :title="t('notification_settings')"
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
      :can-react="canReact && !reactionsOff"
      :can-reply="canReply"
      :can-edit="canEdit"
      :can-delete-own="true"
      :can-delete-any="canDeleteAny"
      :can-pin="canPin"
      :announcement="announcementCard"
      :channel-type="channelType"
      :can-publish-any="canPublishAny"
      :read-counts="channelType === 'announcement' && spaceId ? { spaceId, channelId } : null"
      :toggle-reaction="toggleReaction"
      @select-reply="(m) => emit('select-reply', m)"
      @select-edit="(m) => emit('select-edit', m)"
      @delete-message="onDeleteMessage"
      @publish="publishMessage"
      @retry="retryMessage"
      @near-top="onNearTop"
      @scroll-state="onScrollState"
      @reset-unread="onResetUnread"
    />

    <!-- One confirmation for the whole list; shift-clicking the bin skips it -->
    <Dialog :open="!!pendingDelete" @update:open="(open) => { if (!open) pendingDelete = null; }">
      <DialogContent described class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('delete_message') }}</DialogTitle>
          <DialogDescription>{{ t('delete_message_confirm') }}</DialogDescription>
        </DialogHeader>
        <p v-if="pendingDelete?.text" class="text-sm rounded-md bg-muted px-3 py-2 line-clamp-3 break-words">
          {{ pendingDelete.text }}
        </p>
        <p class="text-xs text-muted-foreground">{{ t('delete_message_shift_hint') }}</p>
        <DialogFooter>
          <Button variant="outline" @click="pendingDelete = null">{{ t('cancel') }}</Button>
          <Button variant="destructive" data-testid="confirm-delete-message" @click="pendingDelete && deleteNow(pendingDelete)">
            {{ t('delete') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <FollowChannelDialog
      v-if="channelType === 'announcement' && spaceId"
      v-model:open="followOpen"
      :space-id="spaceId"
      :channel-id="channelId"
      :channel-name="channelName ?? ''"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from "vue";
import { AntennaIcon, BellIcon, HashIcon, RssIcon } from "lucide-vue-next";
import { type ArgonMessage, DeleteMessageError, MuteLevelType, MuteTargetKind } from "@argon/glue";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";
import { usePexStore } from "@/store/data/permissionStore";
import { metrics, errorKind } from "@/lib/telemetry/metrics";
import type { Guid } from "@argon-chat/ion.webcore";
import { Popover, PopoverTrigger, PopoverContent } from "@argon/ui/popover";

import ChatMessageList from "@/components/chats/ChatMessageList.vue";
import PinnedMessagesButton from "@/components/chats/PinnedMessagesButton.vue";
import FollowChannelDialog from "@/components/channels/FollowChannelDialog.vue";
import { usePublishToFollowers } from "@/composables/useChannelFollow";

import { useLocale } from "@/store/system/localeStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import { useChatMessages } from "@/composables/useChatMessages";
import { useMessageReactions } from "@/composables/useMessageReactions";
import { useMessageGrouping } from "@/composables/useMessageGrouping";
import { useAnnouncementChannel } from "@/composables/useAnnouncementChannel";
import { useMe } from "@/store/auth/meStore";

// ── Stores ──

const { t } = useLocale();
const ntf = useNotificationStore();

// ── Props / Emits ──

const props = withDefaults(defineProps<{
  channelId: Guid;
  spaceId?: Guid;
  channelName?: string;
  channelType?: "text" | "announcement";
  typingUsers?: { displayName: string }[];
  /** False in a channel the user cannot send in: reply actions are hidden. */
  canReply?: boolean;
  /** Own messages can be edited (the composer does the editing). */
  canEdit?: boolean;
}>(), { canReply: true, canEdit: false });

const emit = defineEmits<{
  (e: "select-reply", message: ArgonMessage): void;
  (e: "select-edit", message: ArgonMessage): void;
}>();

const me = useMe();

// ── Mute UI ──

const channelMuted = computed(() => {
  if (!props.channelId || !props.spaceId) return false;
  return ntf.effectiveMuteLevel(props.channelId, props.spaceId) !== MuteLevelType.None;
});

const currentMuteLevel = computed(() =>
  props.spaceId ? ntf.effectiveMuteLevel(props.channelId, props.spaceId) : MuteLevelType.None,
);

const muteOptions = computed(() => [
  { level: MuteLevelType.None, label: t("unmuted"), iconClass: "" },
  { level: MuteLevelType.OnlyMentions, label: t("only_mentions"), iconClass: "opacity-60" },
  { level: MuteLevelType.All, label: t("mute_all"), iconClass: "opacity-30" },
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
  markOptimisticFailed, retryMessage, applyServerMessage, removeMessage, markPublished,
  cleanup: cleanupMessages,
} = useChatMessages(() => props.channelId, () => props.spaceId);

const {
  canReact, toggleReaction, batchLoadReactions,
  subscribe: subReactions, unsubscribe: unsubReactions,
} = useMessageReactions(messages, () => props.channelId, () => props.spaceId);

// Announcement channels: posts render as cards, and reactions may be turned off.
const { card: announcementCard, reactionsOff } = useAnnouncementChannel(() => props.channelId, () => props.spaceId);

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

function jumpToPinned(messageId: bigint): boolean {
  if (!messages.value.some((m) => m.messageId === messageId)) return false;
  listRef.value?.scrollToMessage(messageId);
  return true;
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

// ── Deleting ──

const api = useApi();
const pex = usePexStore();
const { toast } = useToast();

// Your own messages always; anyone's with ManageMessages here. Neither needs SendMessages.
const canDeleteAny = computed(() => pex.hasIn(props.channelId, "ManageMessages", props.spaceId));
const canPin = canDeleteAny;
const pendingDelete = ref<ArgonMessage | null>(null);

function onDeleteMessage(message: ArgonMessage, skipConfirm: boolean) {
  if (skipConfirm) void deleteNow(message);
  else pendingDelete.value = message;
}

async function deleteNow(message: ArgonMessage) {
  pendingDelete.value = null;
  if (!props.spaceId) return;
  try {
    const result = await api.channelInteraction.DeleteMessage(props.spaceId, props.channelId, message.messageId);
    const error = result.isFailedDeleteMessage() ? result.error : DeleteMessageError.NONE;
    const scope = message.sender === me.me?.userId ? "own" : "moderation";
    // Gone already counts: somebody else took it down first.
    if (result.isSuccessDeleteMessage() || error === DeleteMessageError.MESSAGE_NOT_FOUND) {
      metrics.count("message.deleted", { scope, result: "ok" });
      await removeMessage(message.messageId);
      return;
    }
    metrics.count("message.deleted", { scope, result: "failed", error: metrics.enumName(DeleteMessageError, error) });
    toast({ title: t("delete_message_failed"), description: t("delete_message_no_permission"), variant: "destructive" });
  } catch (e) {
    metrics.count("message.deleted", { result: "failed", error: errorKind(e) });
    logger.error("Failed to delete message:", e);
    toast({ title: t("delete_message_failed"), description: t("edit_error_unknown"), variant: "destructive" });
  }
}

// ── Following ──

const followOpen = ref(false);
const canPublishAny = computed(
  () => props.channelType === "announcement" && pex.hasIn(props.channelId, "ManageMessages", props.spaceId),
);
const { publishMessage } = usePublishToFollowers(
  () => ({ spaceId: props.spaceId, channelId: props.channelId }),
  markPublished,
);

/** The newest message the user sent that is on the server, for "arrow up edits the last one". */
function lastOwnMessage(): ArgonMessage | null {
  const myId = me.me?.userId;
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i];
    if (m.sender === myId && !m._optimistic && !m._failed && !m.crosspost) return m;
  }
  return null;
}

defineExpose({
  addOptimisticMessage, resolveOptimisticMessage, markOptimisticFailed, scrollToBottomImmediate,
  applyServerMessage, lastOwnMessage,
});

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
