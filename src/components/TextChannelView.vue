<template>
  <div
    class="flex flex-col h-full overflow-hidden relative border border-border/50 rounded-2xl bg-card"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- ── Drag-drop overlay ── -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isDragging"
        class="absolute inset-0 z-50 rounded-2xl border-2 border-dashed border-primary bg-primary/[0.06] backdrop-blur-[2px] flex items-center justify-center"
      >
        <div class="flex flex-col items-center gap-2.5 text-primary">
          <div class="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <PaperclipIcon class="w-7 h-7" />
          </div>
          <span class="text-sm font-medium">{{ t('drop_files_here') || 'Drop files here' }}</span>
        </div>
      </div>
    </Transition>

    <!-- ── Chat area ── -->
    <div
      v-if="channelData && selectedChannelId && selectedSpaceId"
      class="flex flex-col flex-1 overflow-hidden min-h-0"
    >
      <ChatView
        ref="chatViewRef"
        :channel-id="selectedChannelId"
        :space-id="selectedSpaceId"
        :channel-name="channelData.name"
        :channel-type="isAnnouncement ? 'announcement' : undefined"
        :typing-users="typingUsers"
        @select-reply="onSelectReply"
      />
    </div>

    <!-- ── Empty state ── -->
    <div v-else class="flex-1 flex flex-col items-center justify-center p-8">
      <div class="max-w-xs flex flex-col items-center text-center">
        <div class="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center text-muted-foreground/70 mb-4">
          <component :is="isAnnouncement ? AntennaIcon : RadioIcon" class="h-7 w-7" />
        </div>
        <h3 class="text-base font-semibold text-foreground mb-1">
          {{ t(isAnnouncement ? 'no_announcement_channel_found' : 'no_text_channel_found') }}
        </h3>
        <p class="text-sm text-muted-foreground/80 leading-relaxed">
          {{ t('you_not_access_to_channel_or_not_found_channels') }}
        </p>
      </div>
    </div>

    <!-- ── Bottom input area ── -->
    <div
      v-if="channelData && canInput"
      class="shrink-0 flex flex-col bg-card rounded-b-2xl border-t border-border/30"
    >
      <!-- Reply preview bar (slides in above input) -->
      <Transition
        enter-active-class="transition-all duration-150 ease-out"
        leave-active-class="transition-all duration-100 ease-in"
        enter-from-class="opacity-0 -translate-y-1"
        leave-to-class="opacity-0 -translate-y-1"
      >
        <div
          v-if="replyTo"
          class="flex items-center gap-3 px-5 pt-3 pb-0 overflow-hidden"
        >
          <!-- Accent bar -->
          <div
            class="w-[3px] self-stretch rounded-full shrink-0"
            :style="{ backgroundColor: replyColor }"
          />
          <!-- Reply info -->
          <div class="flex flex-col gap-0.5 min-w-0 flex-1 overflow-hidden">
            <div class="flex items-center gap-1.5">
              <ReplyIcon class="w-3 h-3 text-muted-foreground/60 shrink-0" />
              <span
                class="text-xs font-semibold leading-none truncate"
                :style="{ color: replyColor }"
              >
                {{ replySenderName }}
              </span>
            </div>
            <span class="text-xs text-muted-foreground/70 truncate leading-snug">
              {{ replyTo.text || t('attachment') || 'Attachment' }}
            </span>
          </div>
          <!-- Close button -->
          <button
            class="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
            @click="clearReply"
          >
            <XIcon class="w-3.5 h-3.5" />
          </button>
        </div>
      </Transition>

      <!-- Input -->
      <div class="px-5 py-4">
        <EnterText
          ref="enterTextRef"
          :reply-to="replyTo"
          :space-id="selectedSpaceId!"
          :channel-id="selectedChannelId!"
          @clear-reply="clearReply"
          @typing="onTyping"
          @stop_typing="onStopTyping"
          @add-optimistic="onAddOptimistic"
          @resolve-optimistic="onResolveOptimistic"
          @mark-optimistic-failed="onMarkFailed"
        />
      </div>
    </div>

    <!-- ── Announcement read-only footer ── -->
    <div
      v-else-if="channelData && isAnnouncement"
      class="shrink-0 rounded-b-2xl px-5 py-3 border-t border-border/30"
    >
      <div class="flex items-center justify-center gap-2 text-sm text-muted-foreground/70">
        <BellIcon class="h-4 w-4" />
        <span>{{ t('follow_to_get_updates') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from "vue";
import { RadioIcon, AntennaIcon, BellIcon, PaperclipIcon, XIcon, ReplyIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useUserColors } from "@/store/chat/userColors";
import { useChannelData } from "@/composables/useChannelData";
import { useChannelTyping } from "@/composables/useChannelTyping";
import { ArgonMessage } from "@argon/glue";

import ChatView from "./ChatView.vue";
import EnterText from "./chats/EnterText.vue";

// ── Refs ──

const chatViewRef = ref<InstanceType<typeof ChatView> | null>(null);
const enterTextRef = ref<InstanceType<typeof EnterText> | null>(null);
const isDragging = ref(false);
const replyTo = ref<ArgonMessage | null>(null);

// ── Props ──

const props = withDefaults(
  defineProps<{ channelType?: "text" | "announcement" }>(),
  { channelType: "text" },
);

const { t } = useLocale();
const pex = usePexStore();
const pool = usePoolStore();
const userColors = useUserColors();

const isAnnouncement = computed(() => props.channelType === "announcement");
const canInput = computed(() => !isAnnouncement.value || pex.has("ManageChannels"));

// ── Models (two-way bound to parent) ──

const selectedSpaceId = defineModel<string | null>("selectedSpace", { type: String, required: true });
const selectedChannelId = defineModel<string | null>("selectedChannelId", { type: String, required: true });

// ── Composables ──

const { channelData } = useChannelData(selectedChannelId);
const { typingUsers, onTyping, onStopTyping } = useChannelTyping(selectedChannelId, channelData);

// ── Reply state ──

const replySenderId = computed(() => replyTo.value?.sender);
const replySender = pool.getUserReactive(replySenderId as any);
const replySenderName = computed(() => replySender.value?.displayName || t("unknown_display_name"));
const replyColor = computed(() => userColors.getColorByUserId(replyTo.value?.sender ?? ""));

function onSelectReply(msg: ArgonMessage) {
  replyTo.value = msg;
  nextTick(() => enterTextRef.value?.focus());
}

function clearReply() {
  replyTo.value = null;
}

// Keep last messages visible when reply bar resizes the chat area
watch(replyTo, (val) => {
  if (val) nextTick(() => chatViewRef.value?.scrollToBottomImmediate());
});

// ── Optimistic message bridge (EnterText → ChatView) ──

function onAddOptimistic(msg: ArgonMessage, randomId: bigint) {
  chatViewRef.value?.addOptimisticMessage(msg, randomId);
  nextTick(() => chatViewRef.value?.scrollToBottomImmediate());
}

function onResolveOptimistic(randomId: bigint, readback: { messageId: bigint; channelId: string; spaceId: string }) {
  chatViewRef.value?.resolveOptimisticMessage(randomId, readback);
}

function onMarkFailed(randomId: bigint, error: string) {
  chatViewRef.value?.markOptimisticFailed(randomId, error);
}

// ── Drag & drop ──

let _dragCounter = 0;

function onDragOver() {
  _dragCounter++;
  isDragging.value = true;
}

function onDragLeave(e: DragEvent) {
  _dragCounter--;
  if (_dragCounter <= 0) {
    _dragCounter = 0;
    isDragging.value = false;
  }
}

function onDrop(e: DragEvent) {
  _dragCounter = 0;
  isDragging.value = false;
  if (e.dataTransfer?.files?.length && enterTextRef.value) {
    enterTextRef.value.handleExternalFiles(e.dataTransfer.files);
  }
}
</script>
