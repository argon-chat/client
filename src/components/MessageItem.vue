<template>
    <div class="message-item" :class="{
        incoming: isIncoming,
        outgoing: !isIncoming
    }" v-if="user">

        <Popover v-model:open="isOpened">
            <PopoverContent style="width: 19rem;min-height: 25rem;"
                class="p-0 rounded-2xl shadow-xl border border-neutral-800 bg-[#09090b] text-white overflow-hidden">
                <UserProfilePopover :user-id="user!.UserId" @close:pressed="isOpened = false" />
            </PopoverContent>
            <PopoverTrigger>
                <ArgonAvatar :file-id="user.AvatarFileId ?? null" :fallback="user.DisplayName"
                    :serverId="message.ServerId" :userId="user.UserId" class="avatar" />
            </PopoverTrigger>
        </Popover>

        <div class="message-content">
            <div class="meta">
                <span class="username" :data-user-id="user.UserId"
                    :style="{ 'color': getColorByUserId(user.UserId) }">{{ user?.DisplayName || 'Неизвестный' }}</span>

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
            }" ref="bubble">
                <div v-if="replyMessage" style="display: inline-table;" :class="cn(
                    'reply-preview inline-table',
                    'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground')
                    ">
                    <div class="reply-username" :style="{ 'color': getColorByUserId(user.UserId) }">{{
                        replyUser?.value?.DisplayName || 'Неизвестный' }}</div>
                    <div class="reply-text">{{ replyMessage.Text }}</div>
                </div>
                <div>
                    <ChatSegment style="flex-flow: none;" v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity"
                        :text="x.text" />
                </div>
            </div>
            <div v-if="isSingleEmojiMessage" class="flex" style="font-size: xxx-large; flex-flow: column;">
                <div v-if="replyMessage" style="display: inline-table;":class="cn(
                    'reply-preview inline-table',
                    'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground')
                    ">
                    <div class="reply-username" :style="{ 'color': getColorByUserId(user.UserId) }">{{
                        replyUser?.value?.DisplayName || 'Неизвестный' }}</div>
                    <div class="reply-text">{{ replyMessage.Text }}</div>
                </div>
                <div>
                    <ChatSegment style="flex-flow: none;" v-for="(x, y) in renderedMessage" :key="y" :entity="x.entity"
                        :text="x.text" />
                </div>
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
import { useUserColors } from '@/store/userColors';
import ChatSegment from './chats/ChatSegment.vue';
import UserProfilePopover from './UserProfilePopover.vue';
import {
    Popover,
    PopoverTrigger,
    PopoverContent
} from '@/components/ui/popover';

const isOpened = ref(false);

const props = defineProps<{
    message: IArgonMessageDto,
    getMsgById: (replyId: number) => IArgonMessageDto
}>()

const bubble = ref<HTMLElement | null>(null)
const backgroundOffset = ref(0)
const pool = usePoolStore()
const user = pool.getUserReactive(props.message.Sender);
const me = useMe();
const userColors = useUserColors();

interface IFrag { entity?: IMessageEntity, text: string };

const isSingleEmojiMessage = isUpEmojisOnly(props.message);

const isIncoming = computed(() => props.message.Sender !== me.me?.Id);

const renderedMessage = ref([] as IFrag[]);


function fragmentMessageText(
    text: string,
    entities: IMessageEntity[]
): IFrag[] {
    const fragments: IFrag[] = []
    let cursor = 0

    const sorted = [...entities].sort((a, b) => a.Offset - b.Offset)

    for (const entity of sorted) {
        const start = entity.Offset
        const end = entity.Offset + entity.Length

        if (cursor < start) {
            fragments.push({
                text: text.slice(cursor, start),
            })
        }

        fragments.push({
            text: text.slice(start, end),
            entity,
        })

        cursor = end
    }

    if (cursor < text.length) {
        fragments.push({
            text: text.slice(cursor),
        })
    }

    return fragments
}

// TODO
async function renderMessageTextWithEntities(
    text: string,
    entities: IMessageEntity[]
) {
    const parts: string[] = []
    let current = 0

    const sorted = [...entities].sort((a, b) => a.Offset - b.Offset)

    for (const entity of sorted) {
        if (entity.Type !== 'Mention') continue

        const mention = entity as IMessageEntityMention

        if (mention.Offset > current) {
            parts.push(escapeHtml(text.slice(current, mention.Offset)))
        }

        const mentionText = text.slice(mention.Offset, mention.Offset + mention.Length)
        const user = await pool.getUser(mention.UserId);
        const display = user?.Username || mentionText.replace(/^@/, '')

        parts.push(`<span class="text-blue-400 font-semibold">@${escapeHtml(display)}</span>`)

        current = mention.Offset + mention.Length
    }

    if (current < text.length) {
        parts.push(escapeHtml(text.slice(current)))
    }

    return parts.join('')
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
const replyMessage = computed(() => {
    if (!props.message.ReplyId) return null;
    return props.getMsgById(props.message.ReplyId);
});

const replyUser = computed(() => {
    if (!replyMessage.value) return null;
    return pool.getUserReactive(replyMessage.value.Sender);
});

const updateBackground = () => {
    if (!bubble.value) return
    const rect = bubble.value.getBoundingClientRect()
    backgroundOffset.value = rect.top
}

onMounted(async () => {
    renderedMessage.value = fragmentMessageText(props.message.Text, props.message.Entities);
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
    return userColors.getColorByUserId(userId);
}

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

.incoming {}

.outgoing {}

.bubble {
    padding: 10px;
    border-radius: 4px 18px 18px 18px;
    color: #e0e0e0;
    font-size: 14px;
    line-height: 1.4;
    word-break: break-word;
    white-space: pre-wrap;
    background-color: #222;
}

.reply-preview {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: #d0d0d0;
    background-color: #181818;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.reply-username {
    font-weight: 800;
    margin-bottom: 2px;
}
</style>
