<template>
  <!--
    ╔═══════════════════════════════════════════════════════╗
    ║  TextChannelView — outer shell for a chat channel    ║
    ║  Manages: ChatView + EnterText + drag-drop + empty   ║
    ╚═══════════════════════════════════════════════════════╝
  -->
  <div
    class="flex flex-col h-full overflow-hidden relative border border-border/50 rounded-2xl bg-card"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- ── Drag-drop overlay ── -->
    <Transition name="drag">
      <div
        v-if="isDragging"
        class="absolute inset-0 z-50 rounded-2xl border-2 border-dashed border-primary bg-primary/[0.06] flex items-center justify-center pointer-events-none"
      >
        <div class="flex flex-col items-center gap-2 text-primary animate-in fade-in zoom-in-95 duration-200">
          <PaperclipIcon class="w-10 h-10" />
          <span class="text-base font-medium">{{ t('drop_files_here') || 'Drop files here' }}</span>
        </div>
      </div>
    </Transition>

    <!-- ── Chat area (ChatView + virtualised messages) ── -->
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
        @select-reply="replyTo = $event"
      />
    </div>

    <!-- ── Empty state (no channel data) ── -->
    <div v-if="!channelData" class="flex-1 flex flex-col items-center justify-center p-8 bg-card">
      <div class="max-w-xs flex flex-col items-center text-center">
        <div class="w-14 h-14 rounded-[14px] bg-muted/35 flex items-center justify-center text-muted-foreground mb-4">
          <component :is="isAnnouncement ? AntennaIcon : RadioIcon" class="h-8 w-8" />
        </div>
        <h3 class="text-base font-semibold text-foreground mb-1.5">
          {{ t(isAnnouncement ? 'no_announcement_channel_found' : 'no_text_channel_found') }}
        </h3>
        <p class="text-sm text-muted-foreground leading-relaxed">
          {{ t('you_not_access_to_channel_or_not_found_channels') }}
        </p>
      </div>
    </div>

    <!-- ── Message input ── -->
    <div v-if="channelData && canInput" class="shrink-0 bg-card rounded-b-2xl px-5 py-5 border-t border-border/30">
      <EnterText
        ref="enterTextRef"
        :reply-to="replyTo"
        :space-id="selectedSpaceId!"
        :channel-id="selectedChannelId!"
        @clear-reply="replyTo = null"
        @typing="onTyping"
        @stop_typing="onStopTyping"
        @add-optimistic="onAddOptimistic"
        @resolve-optimistic="onResolveOptimistic"
        @mark-optimistic-failed="onMarkFailed"
      />
    </div>

    <!-- ── Announcement read-only footer ── -->
    <div v-else-if="channelData && isAnnouncement" class="shrink-0 bg-card rounded-b-2xl px-5 py-3.5 border-t border-border/30">
      <div class="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <BellIcon class="h-4 w-4" />
        <span>{{ t('follow_to_get_updates') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
import { RadioIcon, AntennaIcon, BellIcon, PaperclipIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
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

const isAnnouncement = computed(() => props.channelType === "announcement");
const canInput = computed(() => !isAnnouncement.value || pex.has("ManageChannels"));

// ── Models (two-way bound to parent) ──

const selectedSpaceId = defineModel<string | null>("selectedSpace", { type: String, required: true });
const selectedChannelId = defineModel<string | null>("selectedChannelId", { type: String, required: true });

// ── Composables ──

const { channelData } = useChannelData(selectedChannelId);
const { typingUsers, onTyping, onStopTyping } = useChannelTyping(selectedChannelId, channelData);

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

function onDragLeave(e: DragEvent) {
  const related = e.relatedTarget as HTMLElement | null;
  if (related && (e.currentTarget as HTMLElement)?.contains(related)) return;
  isDragging.value = false;
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  if (e.dataTransfer?.files?.length && enterTextRef.value) {
    enterTextRef.value.handleExternalFiles(e.dataTransfer.files);
  }
}
</script>

<style scoped>
.drag-enter-active,
.drag-leave-active {
  transition: opacity 0.2s ease;
}
.drag-enter-from,
.drag-leave-to {
  opacity: 0;
}
</style>
