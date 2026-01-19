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
        outgoing: !isIncoming
    }" v-if="user">

        <Popover v-model:open="isOpened">
            <PopoverContent style="width: 19rem;min-height: 25rem;"
                class="p-0 rounded-2xl shadow-xl border border-border bg-popover text-popover-foreground overflow-hidden">
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
            </div>
            <template v-if="!isRequiredUpperVersionMessage">
                <div class="bubble-wrapper">
                    <div class="bubble flex" style="flex-flow: column;" v-if="!isSingleEmojiMessage" :style="{
                        backgroundPositionY: backgroundOffset + 'px',
                    }" ref="bubble">
                        <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                            'reply-preview inline-table',
                            'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground')
                            ">
                            <div class="reply-username" :style="{ 'color': getColorByUserId(user.userId) }">{{
                                replyUser?.displayName || t("unknown_display_name")}}</div>
                            <div class="reply-text">{{ replyMessage.text }}</div>
                        </div>
                        <div>
                            <ChatSegment v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity" :text="x.text" @unsupported="isRequiredUpperVersionMessage = true"  />
                        </div>
                    </div>
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
import { ref, onMounted, onBeforeUnmount, computed, Ref } from "vue";
import { usePoolStore } from "@/store/poolStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useMe } from "@/store/meStore";
import emojiRegex from "emoji-regex";
import { cn } from "@argon/core";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@argon/ui/tooltip";
import { useDateFormat } from "@vueuse/core";
import { useUserColors } from "@/store/userColors";
import ChatSegment from "./chats/ChatSegment.vue";
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@argon/ui/popover";
import { ArgonMessage, IMessageEntity, EntityType, MessageEntitySystemCallStarted, MessageEntitySystemCallEnded, MessageEntitySystemCallTimeout, MessageEntitySystemUserJoined } from "@argon/glue";
import { useLocale } from "@/store/localeStore";
import { CopyIcon, ReplyIcon } from "lucide-vue-next";

const { t } = useLocale();
const isOpened = ref(false);

const SYSTEM_USER_ID = "11111111-2222-1111-2222-111111111111";

const props = defineProps<{
  message: ArgonMessage;
  getMsgById: (replyId: bigint | null) => ArgonMessage;
}>();

const pool = usePoolStore();
const me = useMe();
const userColors = useUserColors();

const isSystemMessage = computed(() => {
  return props.message.sender === SYSTEM_USER_ID;
});

const systemMessageText = computed(() => {
  if (!isSystemMessage.value || !props.message.entities || props.message.entities.length === 0) {
    return "";
  }

  const entity = props.message.entities[0];
  
  if (entity.type === EntityType.SystemCallStarted) {
    const callEntity = entity as MessageEntitySystemCallStarted;
    const caller = pool.getUserReactive(ref(callEntity.callerId));
    return `${caller.value?.displayName || "User"} started a call`;
  }
  
  if (entity.type === EntityType.SystemCallEnded) {
    const callEntity = entity as MessageEntitySystemCallEnded;
    const caller = pool.getUserReactive(ref(callEntity.callerId));
    const duration = formatCallDuration(callEntity.durationSeconds);
    return `Call ended • ${duration}`;
  }
  
  if (entity.type === EntityType.SystemCallTimeout) {
    const callEntity = entity as MessageEntitySystemCallTimeout;
    const caller = pool.getUserReactive(ref(callEntity.callerId));
    return `Call timeout • No answer`;
  }
  
  if (entity.type === EntityType.SystemUserJoined) {
    const joinEntity = entity as MessageEntitySystemUserJoined;
    const user = pool.getUserReactive(ref(joinEntity.userId));
    if (joinEntity.inviterId) {
      const inviter = pool.getUserReactive(ref(joinEntity.inviterId));
      return `${user.value?.displayName || "User"} joined (invited by ${inviter.value?.displayName || "User"})`;
    }
    return `${user.value?.displayName || "User"} joined`;
  }
  
  return "";
});

function formatCallDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

const emit = defineEmits<{
  (e: "reply", message: ArgonMessage): void;
}>();

const isRequiredUpperVersionMessage = ref(false);
const bubble = ref<HTMLElement | null>(null);
const backgroundOffset = ref(0);
const userIdRef = computed(() => props.message.sender);
const user = pool.getUserReactive(userIdRef);

interface IFrag {
  entity?: IMessageEntity;
  text: string;
}

const isSingleEmojiMessage = isUpEmojisOnly(props.message);

const isIncoming = computed(() => props.message.sender !== me.me?.userId);

const renderedMessage = ref([] as IFrag[]);

function fragmentMessageText(
  text: string,
  entities: IMessageEntity[],
): IFrag[] {
  const fragments: IFrag[] = [];
  let cursor = 0;

  const sorted = [...entities].sort((a, b) => a.offset - b.offset);

  for (const entity of sorted) {
    const start = entity.offset;
    const end = entity.offset + entity.length;

    if (cursor < start) {
      fragments.push({
        text: text.slice(cursor, start),
      });
    }

    fragments.push({
      text: text.slice(start, end),
      entity,
    });

    cursor = end;
  }

  if (cursor < (text?.length ?? 0)) {
    fragments.push({
      text: text.slice(cursor),
    });
  }

  return fragments;
}
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
    hours = hours ? hours : 12; // 0 should be 12
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
</style>
