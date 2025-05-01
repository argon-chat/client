<template>
    <div class="message-item" :class="{
        incoming: isIncoming,
        outgoing: !isIncoming
    }" v-if="user">
        <ArgonAvatar :file-id="user.AvatarFileId ?? null" :fallback="user.DisplayName" :serverId="message.ServerId"
            :userId="user.UserId" class="avatar" />

        <div class="message-content">
            <div class="meta">
                <span class="username">{{ user?.DisplayName || 'Неизвестный' }}</span>

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

            <div class="bubble flex" style="flex-flow: column;" v-if="!isSingleEmojiMessage" :style="{
                backgroundPositionY: backgroundOffset + 'px',
                backgroundColor: bubbleColor
            }" ref="bubble">
                <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                    'rainbow-reply-preview inline-table',
                    'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground transition-colors [background-clip:padding-box,border-box,border-box] [background-origin:border-box] [border:calc(0.08*1rem)_solid_transparent] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',

                    'bg-[linear-gradient(#121213,#121213),linear-gradient(#121213_50%,rgba(18,18,19,0.6)_80%,rgba(18,18,19,0)),linear-gradient(90deg,var(--color-1),var(--color-5),var(--color-3),var(--color-4),var(--color-2))]',
                )
                    ">
                    <div class="reply-username">{{ replyUser?.value?.DisplayName || 'Неизвестный' }}</div>
                    <div class="reply-text">{{ replyMessage.Text }}</div>
                </div>
                {{ message.Text }}
            </div>
            <div v-if="isSingleEmojiMessage" class="flex" style="font-size: xxx-large; flex-flow: column;">
                <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                    'rainbow-reply-preview inline-table',
                    'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground transition-colors [background-clip:padding-box,border-box,border-box] [background-origin:border-box] [border:calc(0.08*1rem)_solid_transparent] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',

                    'bg-[linear-gradient(#121213,#121213),linear-gradient(#121213_50%,rgba(18,18,19,0.6)_80%,rgba(18,18,19,0)),linear-gradient(90deg,var(--color-1),var(--color-5),var(--color-3),var(--color-4),var(--color-2))]',
                )
                    ">
                    <div class="reply-username">{{ replyUser?.value?.DisplayName || 'Неизвестный' }}</div>
                    <div class="reply-text">{{ replyMessage.Text }}</div>
                </div>
                {{ message.Text }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed, Ref } from 'vue'
import { usePoolStore } from '@/store/poolStore'
import ArgonAvatar from '@/components/ArgonAvatar.vue'
import { useMe } from '@/store/meStore';
import emojiRegex from 'emoji-regex';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from '@/components/ui/tooltip'
import { useDateFormat } from '@vueuse/core';

const props = defineProps<{
    message: IArgonMessageDto,
    getMsgById: (replyId: number) => IArgonMessageDto
}>()

const bubble = ref<HTMLElement | null>(null)
const backgroundOffset = ref(0)
const pool = usePoolStore()
const user = pool.getUserReactive(props.message.Sender);
const me = useMe();

const isSingleEmojiMessage = isUpEmojisOnly(props.message);

const isIncoming = true;
const isMe = props.message.Sender == me.me?.Id;

const loadUser = async () => {
    //logger.log(user.value, "reactive user");
}

const replyMessage = computed(() => {
    if (!props.message.ReplyId) return null;
    return props.getMsgById(props.message.ReplyId);
});

const replyUser = computed(() => {
    if (!replyMessage.value) return null;
    return pool.getUserReactive(replyMessage.value.Sender);
});

watch(() => props.message.Sender, loadUser, { immediate: true })

const updateBackground = () => {
    if (!bubble.value) return
    const rect = bubble.value.getBoundingClientRect()
    backgroundOffset.value = rect.top
}

onMounted(() => {
    updateBackground()
    window.addEventListener('scroll', updateBackground, { passive: true })
});

onBeforeUnmount(() => {
    window.removeEventListener('scroll', updateBackground)
});

const formattedTime = computed(() => {
    const date = new Date(props.message.TimeSent * 1000);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
});

const formattedFullTime = useDateFormat(new Date(props.message.TimeSent * 1000), 'YYYY-MM-DD HH:mm:ss')

function getColorByUserId(userId: string): string {
    if (isMe) return "#446df1";
    return "#303030";
}

const bubbleColor = computed(() => {
    if (!props.message.Sender) return '#e0e0e0'
    return isIncoming ? getColorByUserId(props.message.Sender) : ''
});

function isUpEmojisOnly(message: IArgonMessageDto): boolean {
    const text = message.Text.trim();
    const regex = emojiRegex();
    const matches = [...text.matchAll(regex)];
    const emojisOnly = matches.map(m => m[0]).join('');
    return matches.length >= 1 && matches.length <= 2 && emojisOnly === text;
}

</script>

<style scoped>
.message-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}


.incoming {
    flex-direction: row;
    justify-content: flex-start;
}

.outgoing {
    flex-direction: row-reverse;
    justify-content: flex-end;
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
    color: #888;
}

.meta .username {
    font-size: 13px;
    font-weight: 600;
    color: #bbb;
    margin-bottom: 2px;
}

.bubble {
    padding: 10px 14px;
    border-radius: 18px;
    background-size: 100% 800px;
    transition: background-position 0.1s;
    color: white;
    font-size: 14px;
    line-height: 1.4;
    word-break: break-word;
    white-space: pre-wrap;
    background-color: #0088cc;
}

.incoming .bubble {
    color: #fff;
    background-color: #666161;
    border-top-left-radius: 4px;
}

.outgoing .bubble {
    border-top-right-radius: 4px;
}

.rainbow-reply-preview {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    --color-1: hsl(0 100% 63%);
    --color-2: hsl(270 100% 63%);
    --color-3: hsl(210 100% 63%);
    --color-4: hsl(195 100% 63%);
    --color-5: hsl(90 100% 63%);
}

.reply-username {
    font-weight: 800;
    margin-bottom: 2px;
    color: #d39b18;
}
</style>
