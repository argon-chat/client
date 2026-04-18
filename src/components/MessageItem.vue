<template>
    <!-- System message -->
    <div v-if="isSystemMessage" class="system-message">
        <div class="system-message-content">
            {{ systemMessageText }}
        </div>
    </div>

    <!-- Regular message -->
    <div v-else class="message-item" :class="{
        incoming: isIncoming,
        outgoing: !isIncoming,
        'is-optimistic': isOptimistic && !isFailed,
        'is-failed': isFailed,
        'is-grouped': isGrouped,
        'is-first': isFirstInGroup,
    }" v-if="user">

        <!-- Avatar: full component on first-in-group, bare spacer otherwise -->
        <div v-if="isFirstInGroup" class="avatar-col">
            <Popover v-model:open="isOpened">
                <PopoverContent style="width: 21rem;"
                    class="profile-popover p-0 rounded-2xl shadow-xl border border-border bg-popover text-popover-foreground overflow-hidden">
                    <UserProfilePopover :user-id="user!.userId" @close:pressed="isOpened = false" />
                </PopoverContent>
                <PopoverTrigger>
                    <ArgonAvatar 
                        :file-id="user.avatarFileId" 
                        :fallback="user.displayName"
                        :userId="user.userId"
                        :overrided-size="36"
                        class="avatar" 
                    />
                </PopoverTrigger>
            </Popover>
        </div>
        <div v-else class="avatar-spacer" />

        <div class="message-content">
            <!-- Meta: only for first in group -->
            <div v-if="isFirstInGroup" class="meta">
                <span class="username" :data-user-id="user.userId"
                    :style="{ 'color': getColorByUserId(user.userId) }">{{ user?.displayName || t("unknown_display_name") }}</span>

                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger>
                            <span class="time">{{ formattedTime }}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{{ formattedFullTime }}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>

                <!-- Optimistic status indicators -->
                <Loader2Icon v-if="isOptimistic && !isFailed" class="w-3.5 h-3.5 animate-spin text-muted-foreground status-icon" />
                <TooltipProvider v-if="isFailed">
                    <Tooltip>
                        <TooltipTrigger as-child>
                            <button class="failed-badge" @click="retryMessage">
                                <AlertCircleIcon class="w-3.5 h-3.5" />
                                <RefreshCwIcon class="w-3 h-3 retry-icon" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                            <p>{{ failedError || t('send_failed') || 'Failed to send' }} — {{ t('click_to_retry') || 'click to retry' }}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <template v-if="!isRequiredUpperVersionMessage">
                <ContextMenu>
                <ContextMenuTrigger>
                <div class="bubble-wrapper">
                    <!-- Telegram-style: images above the bubble -->
                    <div class="media-message-container" v-if="!isSingleEmojiMessage">
                        <AttachmentImageGrid v-if="imageAttachments.length" :images="imageAttachments" class="media-block" @open-lightbox="openLightbox" />
                        <ImageLightbox
                          :images="imageAttachments"
                          :initial-index="lightboxIndex"
                          :is-open="lightboxOpen"
                          :time-sent="props.message.timeSent?.date ?? null"
                          @close="lightboxOpen = false"
                        />
                        <div class="bubble" :class="[bubbleRadiusClass, { 'bubble-below-media': imageAttachments.length > 0 }]" v-if="!hasOnlyImages" ref="bubble">
                            <!-- Reply preview -->
                            <div v-if="replyMessage" class="reply-preview" @click="$emit('reply', replyMessage)">
                                <div class="reply-accent" :style="{ backgroundColor: getColorByUserId(replyMessage.sender) }" />
                                <div class="reply-body">
                                    <span class="reply-username" :style="{ color: getColorByUserId(replyMessage.sender) }">{{ replyUser?.displayName || t("unknown_display_name") }}</span>
                                    <span class="reply-text">{{ replyMessage.text }}</span>
                                </div>
                            </div>
                            <div v-if="renderedMessage.length" class="message-text">
                                <ChatSegment v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity" :text="x.text" @unsupported="isRequiredUpperVersionMessage = true" />
                                <span v-if="isGrouped" class="inline-time">{{ formattedTime }}</span>
                            </div>
                            <AttachmentFileCard
                                v-for="(file, i) in fileAttachments"
                                :key="i"
                                :file-id="file.fileId"
                                :file-name="file.fileName"
                                :file-size="file.fileSize"
                                :content-type="file.contentType"
                            />
                            <!-- Inline time for grouped messages without text -->
                            <span v-if="isGrouped && renderedMessage.length === 0" class="inline-time standalone">{{ formattedTime }}</span>
                        </div>
                        <!-- Images-only: inline time overlay -->
                        <span v-if="hasOnlyImages && isGrouped" class="image-time-overlay">{{ formattedTime }}</span>
                    </div>
                    <!-- Single emoji -->
                    <div v-if="isSingleEmojiMessage" class="single-emoji">
                        <!-- Reply preview for emoji -->
                        <div v-if="replyMessage" class="reply-preview" @click="$emit('reply', replyMessage)">
                            <div class="reply-accent" :style="{ backgroundColor: getColorByUserId(replyMessage.sender) }" />
                            <div class="reply-body">
                                <span class="reply-username" :style="{ color: getColorByUserId(replyMessage.sender) }">{{ replyUser?.displayName || t("unknown_display_name") }}</span>
                                <span class="reply-text">{{ replyMessage.text }}</span>
                            </div>
                        </div>
                        <div>
                            <ChatSegment v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity" :text="x.text" @unsupported="isRequiredUpperVersionMessage = true" />
                        </div>
                    </div>

                    <!-- Hover actions — absolute overlay -->
                    <div class="message-actions">
                        <Popover v-if="canReact" v-model:open="reactionPickerOpen">
                            <PopoverTrigger as-child>
                                <button class="action-btn">
                                    <SmilePlusIcon class="w-3.5 h-3.5" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent side="top" :side-offset="4" class="reaction-picker-popover p-0 border-0 bg-transparent shadow-none w-auto">
                                <ReactionPicker @select="onPickerSelect" />
                            </PopoverContent>
                        </Popover>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger as-child>
                                    <button class="action-btn" @click="copyMessage">
                                        <CopyIcon class="w-3.5 h-3.5" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    <p>{{ t("copy") }}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger as-child>
                                    <button class="action-btn" @click="replyToMessage">
                                        <ReplyIcon class="w-3.5 h-3.5" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    <p>{{ t("reply") }}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    <!-- Reaction pills -->
                    <MessageReactions
                      v-if="(props.message.reactions ?? []).length > 0"
                      :reactions="props.message.reactions"
                      :current-user-id="me.me?.userId ?? ''"
                      :can-react="canReact"
                      @toggle="onReactionToggle"
                    />
                </div>
                </ContextMenuTrigger>
                <ContextMenuContent class="w-auto min-w-48">
                    <div v-if="canReact" class="context-reaction-row">
                        <ReactionPicker @select="onPickerSelect" />
                    </div>
                    <ContextMenuSeparator v-if="canReact" />
                    <ContextMenuItem @click="copyMessage">
                        <CopyIcon class="w-3.5 h-3.5 mr-2" />
                        {{ t("copy") }}
                    </ContextMenuItem>
                    <ContextMenuItem @click="replyToMessage">
                        <ReplyIcon class="w-3.5 h-3.5 mr-2" />
                        {{ t("reply") }}
                    </ContextMenuItem>
                </ContextMenuContent>
                </ContextMenu>
            </template>
            <template v-else>
                <div class="unsupported-message" v-html="t('not_supported_message_please_update')">
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import { usePoolStore } from "@/store/data/poolStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useMe } from "@/store/auth/meStore";
import emojiRegex from "emoji-regex";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@argon/ui/tooltip";
import { useDateFormat } from "@vueuse/core";
import { useUserColors } from "@/store/chat/userColors";
import ChatSegment from "./chats/ChatSegment.vue";
import AttachmentImageGrid from "./chats/AttachmentImageGrid.vue";
import AttachmentFileCard from "./chats/AttachmentFileCard.vue";
import ImageLightbox from "./chats/ImageLightbox.vue";
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@argon/ui/popover";
import type { ArgonMessage } from "@argon/glue";
import type { ChatMessage } from "@/composables/useChatMessages";
import { EntityType, type MessageEntityAttachment } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";
import { CopyIcon, ReplyIcon, AlertCircleIcon, Loader2Icon, RefreshCwIcon, SmilePlusIcon } from "lucide-vue-next";
import {
  useMessageContent,
  fragmentMessageText,
  type IFrag,
} from "@/composables/useMessageContent";
import MessageReactions from "./chats/MessageReactions.vue";
import ReactionPicker from "./chats/ReactionPicker.vue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@argon/ui/context-menu";

const { t } = useLocale();
const isOpened = ref(false);

const props = defineProps<{
  message: ChatMessage;
  getMsgById: (replyId: bigint | null) => ArgonMessage;
  isGrouped?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  canReact?: boolean;
  toggleReaction?: (messageId: bigint, emoji: string) => void;
}>();

const pool = usePoolStore();
const me = useMe();
const userColors = useUserColors();

const { isSystemMessage, systemMessageText } = useMessageContent(() => props.message);

const emit = defineEmits<{
  (e: "reply", message: ArgonMessage): void;
  (e: "retry", message: ArgonMessage): void;
}>();

const isRequiredUpperVersionMessage = ref(false);
const bubble = ref<HTMLElement | null>(null);
const userIdRef = computed(() => props.message.sender);
const user = pool.getUserReactive(userIdRef);

const messageAttachments = computed(() =>
  (props.message.entities ?? []).filter(
    (e): e is MessageEntityAttachment => e.type === EntityType.Attachment,
  ),
);

function isImageAttachment(a: MessageEntityAttachment): boolean {
  if (a.contentType?.startsWith("image/")) return true;
  // Fallback: check file extension when contentType is missing/empty
  const ext = a.fileName?.split(".").pop()?.toLowerCase();
  return !!ext && ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext);
}

const imageAttachments = computed(() =>
  messageAttachments.value.filter(isImageAttachment),
);

const fileAttachments = computed(() =>
  messageAttachments.value.filter((a) => !isImageAttachment(a)),
);

const hasOnlyImages = computed(() =>
  messageAttachments.value.length > 0 &&
  fileAttachments.value.length === 0 &&
  renderedMessage.value.length === 0 &&
  !props.message.text?.trim(),
);

const isOptimistic = computed(() => props.message._optimistic === true);
const isFailed = computed(() => props.message._failed === true);
const failedError = computed(() => props.message._error);

const lightboxOpen = ref(false);
const lightboxIndex = ref(0);

function openLightbox(index: number) {
  lightboxIndex.value = index;
  lightboxOpen.value = true;
}

const isSingleEmojiMessage = isUpEmojisOnly(props.message);
const isIncoming = computed(() => props.message.sender !== me.me?.userId);
const renderedMessage = ref([] as IFrag[]);

const replyMessage = computed(() => {
  if (!props.message.replyId) return null;
  return props.getMsgById(props.message.replyId);
});

const replyUserIdRef = computed(() => replyMessage.value?.sender);
const replyUser = pool.getUserReactive(replyUserIdRef);

// Directional bubble radius based on group position
const bubbleRadiusClass = computed(() => {
  if (props.isFirstInGroup && props.isLastInGroup) return 'bubble-single';
  if (props.isFirstInGroup) return 'bubble-first';
  if (props.isLastInGroup) return 'bubble-last';
  return 'bubble-middle';
});

onMounted(async () => {
  renderedMessage.value = fragmentMessageText(
    props.message.text,
    props.message.entities,
  );
});

onBeforeUnmount(() => {
  // cleanup if needed
});

const formattedTime = computed(() => {
  const date = props.message.timeSent.date;
  const format = document.documentElement.getAttribute("data-timestamp-format") || "24h";
  
  if (format === "12h") {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  }
  
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
});

const formattedFullTime = useDateFormat(
  props.message.timeSent.date,
  "YYYY-MM-DD HH:mm:ss",
);

function copyMessage() {
  navigator.clipboard.writeText(props.message.text);
}

function replyToMessage() {
  emit("reply", props.message);
}

function retryMessage() {
  emit("retry", props.message);
}

function getColorByUserId(userId: string): string {
  return userColors.getColorByUserId(userId);
}

const reactionPickerOpen = ref(false);

function onPickerSelect(emoji: string) {
  reactionPickerOpen.value = false;
  props.toggleReaction?.(props.message.messageId, emoji);
}

function onReactionToggle(emoji: string) {
  props.toggleReaction?.(props.message.messageId, emoji);
}

function isUpEmojisOnly(message: ArgonMessage): boolean {
  if (!message.text) return false;
  const text = message.text.trim();
  const regex = emojiRegex();
  const matches = [...text.matchAll(regex)];
  const emojisOnly = matches.map((m) => m[0]).join("");
  return matches.length >= 1 && matches.length <= 2 && emojisOnly === text;
}
</script>

<style scoped>
/* ─── System message ─── */
.system-message {
    display: flex;
    justify-content: center;
    padding: 16px 0;
    width: 100%;
    contain: layout style;
}

.system-message-content {
    padding: 6px 12px;
    border-radius: var(--radius);
    background: hsl(var(--muted) / 0.5);
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    text-align: center;
    max-width: 80%;
}

/* ─── Message item ─── */
.message-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0 0;
    contain: layout style;
}

.message-item.is-first {
    padding-top: 12px;
}

.message-item.is-grouped {
    padding-top: 2px;
}

/* Avatar */
.avatar-col {
    width: 36px;
    flex-shrink: 0;
}

.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
}

.avatar-spacer {
    width: 36px;
    flex-shrink: 0;
}

.message-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    max-width: 85%;
}

/* ─── Meta (username + time) ─── */
.meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
}

.meta .time {
    font-size: 11px;
    color: hsl(var(--muted-foreground) / 0.7);
}

.meta .username {
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
}

/* ─── Bubble ─── */
.bubble {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    color: hsl(var(--foreground));
    font-size: 14px;
    line-height: 1.45;
    word-break: break-word;
    white-space: pre-wrap;
    background-color: hsl(var(--muted));
    max-width: 520px;
    min-width: 150px;
}

/* Directional radius — avatar is at top, so tail points top-left on first */
.bubble-single {
    border-radius: 4px 18px 18px 18px;
}

.bubble-first {
    border-radius: 4px 18px 18px 4px;
}

.bubble-middle {
    border-radius: 4px 18px 18px 4px;
}

.bubble-last {
    border-radius: 4px 18px 18px 18px;
}

/* ─── Message text ─── */
.message-text {
    position: relative;
}

/* ─── Inline time (grouped messages) ─── */
.inline-time {
    float: right;
    font-size: 11px;
    color: hsl(var(--muted-foreground) / 0.5);
    margin-left: 8px;
    margin-top: 4px;
    line-height: 1;
    user-select: none;
}

.inline-time.standalone {
    float: none;
    text-align: right;
}

.image-time-overlay {
    position: absolute;
    bottom: 6px;
    right: 8px;
    font-size: 11px;
    color: white;
    text-shadow: 0 1px 3px rgba(0,0,0,0.6);
    user-select: none;
    pointer-events: none;
}

/* ─── Reply preview (Telegram-style) ─── */
.reply-preview {
    display: flex;
    align-items: stretch;
    gap: 0;
    margin-bottom: 6px;
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    background: hsl(var(--muted) / 0.5);
    transition: background 0.15s ease;
    font-size: 13px;
}

.reply-preview:hover {
    background: hsl(var(--muted) / 0.8);
}

.reply-accent {
    width: 3px;
    flex-shrink: 0;
    border-radius: 3px 0 0 3px;
}

.reply-body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 10px;
    min-width: 0;
    overflow: hidden;
}

.reply-username {
    font-weight: 600;
    font-size: 12px;
    line-height: 1.2;
}

.reply-text {
    font-size: 12px;
    color: hsl(var(--foreground) / 0.7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
}

/* ─── Single emoji ─── */
.single-emoji {
    display: flex;
    flex-direction: column;
    font-size: xxx-large;
    line-height: 1.2;
}

/* ─── Unsupported message ─── */
.unsupported-message {
    border-radius: 0 var(--radius) var(--radius) var(--radius);
    border-left: 4px solid hsl(var(--destructive));
    background: hsl(var(--destructive) / 0.1);
    font-style: italic;
    font-size: 14px;
    padding: 12px 16px;
}

/* ─── Hover actions (overlay) ─── */
.bubble-wrapper {
    position: relative;
    display: inline-flex;
    flex-direction: column;
}

.message-actions {
    position: absolute;
    top: -28px;
    right: 0;
    display: flex;
    gap: 1px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease, visibility 0.15s ease;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.4);
    border-radius: 8px;
    padding: 2px;
    box-shadow: 0 2px 8px hsl(var(--background) / 0.4);
    z-index: 5;
}

.bubble-wrapper:hover .message-actions {
    opacity: 1;
    visibility: visible;
}

.action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: transparent;
    color: hsl(var(--muted-foreground));
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.action-btn:hover {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
}

.action-btn:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 1px;
}

/* ─── Media container ─── */
.media-message-container {
    display: flex;
    flex-direction: column;
    max-width: calc(var(--chat-width, 600px) * 0.8);
    position: relative;
}

.media-block {
    border-radius: 18px 18px 0 0;
    overflow: hidden;
}

.media-message-container > .media-block:last-child {
    border-radius: 18px;
}

.media-block :deep(.image-grid) {
    max-width: none;
    width: 100%;
    border-radius: 0;
}

.media-block :deep(.single-image-wrapper) {
    max-width: none;
    width: 100%;
    border-radius: 0;
}

.media-message-container .bubble-below-media {
    border-radius: 0 0 18px 18px !important;
    margin-top: 0;
}

/* ─── Optimistic / Failed states ─── */
.message-item.is-optimistic {
    opacity: 0.6;
}

.message-item.is-optimistic .bubble {
    opacity: 0.85;
}

.message-item.is-failed {
    opacity: 1;
}

.message-item.is-failed .bubble {
    border: 1px solid hsl(var(--destructive) / 0.3);
}

.message-item.is-failed .media-block {
    border: 1px solid hsl(var(--destructive) / 0.3);
    border-bottom: none;
}

/* ─── Status indicators ─── */
.status-icon {
    flex-shrink: 0;
}

.failed-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: hsl(var(--destructive));
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: opacity 0.15s;
}

.failed-badge:hover {
    opacity: 0.7;
}

.failed-badge .retry-icon {
    display: none;
}

.failed-badge:hover .retry-icon {
    display: block;
}

.failed-badge:hover > .lucide-alert-circle {
    display: none;
}

/* ─── Context menu reaction row ─── */
.context-reaction-row {
    padding: 4px;
    display: flex;
    justify-content: center;
}

.context-reaction-row :deep(.reaction-picker) {
    border: none;
    box-shadow: none;
    background: transparent;
    padding: 0;
}

/* ─── Reaction picker popover override ─── */
.reaction-picker-popover {
    width: auto !important;
}
</style>
