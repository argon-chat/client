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
    }" v-if="user">

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

        <div class="message-content">
            <div class="meta">
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
                <div class="bubble-wrapper">
                    <!-- Telegram-style: images above the bubble -->
                    <div class="media-message-container" v-if="!isSingleEmojiMessage">
                        <AttachmentImageGrid v-if="imageAttachments.length" :images="imageAttachments" class="media-block" />
                        <div class="bubble flex" style="flex-flow: column;" v-if="!hasOnlyImages" :style="{
                            backgroundPositionY: backgroundOffset + 'px',
                        }" ref="bubble" :class="{ 'bubble-below-media': imageAttachments.length > 0 }">
                            <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                                'reply-preview inline-table',
                                'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground')
                                ">
                                <div class="reply-username" :style="{ 'color': getColorByUserId(user.userId) }">{{
                                    replyUser?.displayName || t("unknown_display_name")}}</div>
                                <div class="reply-text">{{ replyMessage.text }}</div>
                            </div>
                            <div v-if="renderedMessage.length">
                                <ChatSegment v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity" :text="x.text" @unsupported="isRequiredUpperVersionMessage = true" />
                            </div>
                            <AttachmentFileCard
                                v-for="(file, i) in fileAttachments"
                                :key="i"
                                :file-id="file.fileId"
                                :file-name="file.fileName"
                                :file-size="file.fileSize"
                                :content-type="file.contentType"
                            />
                        </div>
                    </div>
                    <!-- Single emoji -->
                    <div v-if="isSingleEmojiMessage" class="flex" style="font-size: xxx-large; flex-flow: column;">
                        <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                            'reply-preview inline-table',
                            'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground')
                            ">
                            <div class="reply-username" :style="{ 'color': getColorByUserId(user.userId) }">{{ 
                                replyUser?.displayName || t("unknown_display_name") }}</div>
                            <div class="reply-text">{{ replyMessage.text }}</div>
                        </div>
                        <div>
                            <ChatSegment v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity" :text="x.text" @unsupported="isRequiredUpperVersionMessage = true" />
                        </div>
                    </div>

                    <!-- Hover actions -->
                    <div class="message-actions">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger as-child>
                                    <button class="action-btn" @click="copyMessage">
                                        <CopyIcon class="w-4 h-4" />
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
                                        <ReplyIcon class="w-4 h-4" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    <p>{{ t("reply") }}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            </template>
            <template v-else>
                <div class="rounded-r-lg border-red-500 border-l-4 bg-destructive/10 italic text-sm p-4" v-html="t('not_supported_message_please_update')">
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
import { cn } from "@argon/core";
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
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@argon/ui/popover";
import type { ArgonMessage } from "@argon/glue";
import { EntityType, type MessageEntityAttachment } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";
import { CopyIcon, ReplyIcon, AlertCircleIcon, Loader2Icon, RefreshCwIcon, CheckIcon } from "lucide-vue-next";
import {
  useMessageContent,
  fragmentMessageText,
  type IFrag,
} from "@/composables/useMessageContent";

const { t } = useLocale();
const isOpened = ref(false);

const props = defineProps<{
  message: ArgonMessage;
  getMsgById: (replyId: bigint | null) => ArgonMessage;
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
const backgroundOffset = ref(0);
const userIdRef = computed(() => props.message.sender);
const user = pool.getUserReactive(userIdRef);

const messageAttachments = computed(() =>
  (props.message.entities ?? []).filter(
    (e): e is MessageEntityAttachment => e.type === EntityType.Attachment,
  ),
);

const imageAttachments = computed(() =>
  messageAttachments.value.filter((a) => a.contentType.startsWith("image/")),
);

const fileAttachments = computed(() =>
  messageAttachments.value.filter((a) => !a.contentType.startsWith("image/")),
);

const hasOnlyImages = computed(() =>
  messageAttachments.value.length > 0 &&
  fileAttachments.value.length === 0 &&
  renderedMessage.value.length === 0 &&
  !props.message.text?.trim(),
);

const isOptimistic = computed(() => (props.message as any)._optimistic === true);
const isFailed = computed(() => (props.message as any)._failed === true);
const failedError = computed(() => (props.message as any)._error as string | undefined);

const isSingleEmojiMessage = isUpEmojisOnly(props.message);
const isIncoming = computed(() => props.message.sender !== me.me?.userId);
const renderedMessage = ref([] as IFrag[]);

const replyMessage = computed(() => {
  if (!props.message.replyId) return null;
  return props.getMsgById(props.message.replyId);
});

const replyUserIdRef = computed(() => replyMessage.value?.sender);
const replyUser = pool.getUserReactive(replyUserIdRef);

const updateBackground = () => {
  if (!bubble.value) return;
  const rect = bubble.value.getBoundingClientRect();
  backgroundOffset.value = rect.top;
};

onMounted(async () => {
  renderedMessage.value = fragmentMessageText(
    props.message.text,
    props.message.entities,
  );
  updateBackground();
  window.addEventListener("scroll", updateBackground, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", updateBackground);
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
.system-message {
    display: flex;
    justify-content: center;
    padding: 8px 0;
    width: 100%;
}

.system-message-content {
    padding: 6px 12px;
    border-radius: 12px;
    background: hsl(var(--muted) / 0.5);
    color: hsl(var(--muted-foreground));
    font-size: 13px;
    text-align: center;
    max-width: 80%;
}

.message-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
}

.message-content {
    max-width: 60%;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.meta {
    display: flex;
    align-items: center;
    gap: 8px;
}

.meta .time {
    font-size: 12px;
    color: hsl(var(--muted-foreground));
}

.meta .username {
    font-size: 13px;
    font-weight: 600;
    color: hsl(var(--foreground) / 0.8);
    margin-bottom: 2px;
}
.bubble {
    padding: 10px;
    border-radius: 4px 18px 18px 18px;
    color: hsl(var(--foreground));
    font-size: 14px;
    line-height: 1.4;
    word-break: break-word;
    white-space: pre-wrap;
    background-color: hsl(var(--muted));
}

.reply-preview {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: hsl(var(--foreground) / 0.85);
    background-color: hsl(var(--muted) / 0.7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.reply-username {
    font-weight: 800;
    margin-bottom: 2px;
}

/* Hover actions */
.bubble-wrapper {
    position: relative;
    display: inline-flex;
    align-items: flex-start;
    gap: 4px;
}

.message-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease, visibility 0.15s ease;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 6px;
    padding: 2px;
    box-shadow: 0 2px 8px hsl(var(--background) / 0.5);
    flex-shrink: 0;
    align-self: flex-start;
}

.bubble-wrapper:hover .message-actions {
    opacity: 1;
    visibility: visible;
}

.action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: hsl(var(--muted-foreground));
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.action-btn:hover {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
}

/* Telegram-style media container */
.media-message-container {
    display: flex;
    flex-direction: column;
    width: 420px;
    max-width: 100%;
}

.media-block {
    border-radius: 18px 18px 0 0;
    overflow: hidden;
}

/* When only images, no text bubble below — fully rounded */
.media-message-container > .media-block:last-child {
    border-radius: 18px;
}

.media-block :deep(.image-grid) {
    max-width: none;
    width: 100%;
    border-radius: 0;
}

.media-message-container .bubble-below-media {
    border-radius: 0 0 18px 18px;
    margin-top: 0;
}

/* Optimistic (sending) state */
.message-item.is-optimistic {
    opacity: 0.7;
}

.message-item.is-optimistic .bubble {
    opacity: 0.8;
}

/* Failed state */
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

/* Status icon next to time */
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
</style>
