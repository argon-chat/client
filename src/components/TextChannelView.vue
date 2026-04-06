<template>
    <div class="channel-chat flex flex-col h-full overflow-hidden relative"
         @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
        <!-- Chat-wide drag overlay -->
        <div v-if="isDragging" class="chat-drag-overlay">
            <div class="chat-drag-content">
                <PaperclipIcon class="w-10 h-10" />
                <span class="text-base font-medium">{{ t('drop_files_here') || 'Drop files here' }}</span>
            </div>
        </div>

        <div v-if="channelData && selectedChannelId && selectedSpaceId" ref="messageContainer"
            class="messages-scroll flex-1">
            <ChatView
                ref="chatViewRef" 
                :channel-id="selectedChannelId" 
                :space-id="selectedSpaceId" 
                :channel-name="channelData.name" 
                :channel-type="isAnnouncement ? 'announcement' : undefined"
                :typing-users="typingUsers" 
                @select-reply="onReplySelect" 
            />
        </div>

        <div v-if="!channelData" class="empty-state">
            <div class="empty-state-inner">
                <div class="empty-state-icon">
                    <component :is="emptyIcon" class="h-8 w-8" />
                </div>
                <h3 class="empty-state-title">
                    {{ t(isAnnouncement ? "no_announcement_channel_found" : "no_text_channel_found") }}
                </h3>
                <p class="empty-state-desc">
                    {{ t("you_not_access_to_channel_or_not_found_channels") }}
                </p>
            </div>
        </div>

        <div v-if="channelData && canInput" class="message-input-area">
            <EnterText ref="enterTextRef" :reply-to="replyTo" :space-id="selectedSpaceId!" :channel-id="selectedChannelId!" @clear-reply="replyTo = null" @typing="onTyping"
                @stop_typing="onStopTyping"
                @add-optimistic="onAddOptimistic"
                @mark-optimistic-failed="onMarkOptimisticFailed" />
        </div>

        <div v-else-if="channelData && isAnnouncement" class="announcement-footer">
            <div class="announcement-footer-inner">
                <BellIcon class="h-4 w-4" />
                <span>{{ t("follow_to_get_updates") }}</span>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { RadioIcon, AntennaIcon, BellIcon, PaperclipIcon } from "lucide-vue-next";
import { computed, ref, nextTick } from "vue";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
import EnterText from "./chats/EnterText.vue";
import ChatView from "./ChatView.vue";
import { useChannelData } from "@/composables/useChannelData";
import { useChannelTyping } from "@/composables/useChannelTyping";
import { ArgonMessage } from "@argon/glue";

const chatViewRef = ref<InstanceType<typeof ChatView> | null>(null);
const enterTextRef = ref<InstanceType<typeof EnterText> | null>(null);
const isDragging = ref(false);

const props = withDefaults(defineProps<{
    channelType?: 'text' | 'announcement';
}>(), { channelType: 'text' });

const { t } = useLocale();
const pex = usePexStore();

const isAnnouncement = computed(() => props.channelType === 'announcement');
const emptyIcon = computed(() => isAnnouncement.value ? AntennaIcon : RadioIcon);
const canInput = computed(() => !isAnnouncement.value || pex.has('ManageChannels'));

const replyTo = ref<ArgonMessage | null>(null);

function onReplySelect(message: ArgonMessage) {
    replyTo.value = message;
}

const selectedSpaceId = defineModel<string | null>('selectedSpace', {
    type: String, required: true
});

const selectedChannelId = defineModel<string | null>('selectedChannelId', {
    type: String, required: true
});

const { channelData } = useChannelData(selectedChannelId);
const { typingUsers, onTyping, onStopTyping } = useChannelTyping(selectedChannelId, channelData);

function onAddOptimistic(msg: ArgonMessage, randomId: bigint) {
    chatViewRef.value?.addOptimisticMessage(msg, randomId);
    nextTick(() => chatViewRef.value?.scrollToBottomImmediate());
}

function onMarkOptimisticFailed(randomId: bigint, error: string) {
    chatViewRef.value?.markOptimisticFailed(randomId, error);
}

function onDragOver() {
    isDragging.value = true;
}

function onDragLeave(e: DragEvent) {
    // Only leave if exiting the container
    const related = e.relatedTarget as HTMLElement | null;
    if (related && (e.currentTarget as HTMLElement)?.contains(related)) return;
    isDragging.value = false;
}

async function onDrop(e: DragEvent) {
    isDragging.value = false;
    if (e.dataTransfer?.files?.length && enterTextRef.value) {
        enterTextRef.value.handleExternalFiles(e.dataTransfer.files);
    }
}
</script>

<style scoped>
.channel-chat {
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    background: hsl(var(--card));
}

.chat-drag-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    background: hsl(var(--primary) / 0.06);
    border: 2px dashed hsl(var(--primary));
    border-radius: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}

.chat-drag-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: hsl(var(--primary));
}

.messages-scroll {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
}

/* Empty state */
.empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: hsl(var(--card));
}

.empty-state-inner {
    max-width: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.empty-state-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: hsl(var(--muted) / 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    color: hsl(var(--muted-foreground));
    margin-bottom: 1rem;
}

.empty-state-title {
    font-size: 1rem;
    font-weight: 600;
    color: hsl(var(--foreground));
    margin-bottom: 0.375rem;
}

.empty-state-desc {
    font-size: 0.82rem;
    color: hsl(var(--muted-foreground));
    line-height: 1.45;
}

/* Input area */
.message-input-area {
    background: hsl(var(--card));
    border-radius: 0 0 15px 15px;
    padding: 1.25rem;
    flex-shrink: 0;
    border-top: 1px solid hsl(var(--border) / 0.3);
}

/* Announcement footer */
.announcement-footer {
    background: hsl(var(--card));
    border-radius: 0 0 15px 15px;
    padding: 0.875rem 1.25rem;
    flex-shrink: 0;
    border-top: 1px solid hsl(var(--border) / 0.3);
}

.announcement-footer-inner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: hsl(var(--muted-foreground));
}
</style>
