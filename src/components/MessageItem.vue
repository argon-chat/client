<template>
    <div class="message-item" :class="{
        incoming: isIncoming,
        outgoing: !isIncoming
    }" v-if="user">
        <ArgonAvatar :file-id="user.AvatarFileId ?? null" :fallback="user.DisplayName" :serverId="message.ServerId"
            :userId="user.Id" class="avatar" />

        <div class="message-content">
            <div class="meta">
                <span class="username">{{ user?.DisplayName || 'Неизвестный' }}</span>
            </div>
            <div class="bubble" v-if="!isSingleEmojiMessage" :style="{
                backgroundPositionY: backgroundOffset + 'px',
                backgroundColor: bubbleColor 
            }" ref="bubble">
                {{ message.Text }}
            </div>
            <div v-if="isSingleEmojiMessage" style="font-size: xxx-large;">
                {{ message.Text }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed } from 'vue'
import { usePoolStore } from '@/store/poolStore'
import ArgonAvatar from '@/components/ArgonAvatar.vue'
import { useMe } from '@/store/meStore';
import emojiRegex from 'emoji-regex';

const props = defineProps<{
    message: IArgonMessageDto
}>()

const bubble = ref<HTMLElement | null>(null)
const backgroundOffset = ref(0)
const pool = usePoolStore()
const user = ref<any>(null)
const me = useMe();

const isSingleEmojiMessage = isSingleEmojiOnly(props.message);

const isIncoming = true;
const isMe = props.message.Sender == me.me?.Id;

const loadUser = async () => {
    user.value = await pool.getUser(props.message.Sender)
}

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


function getColorByUserId(userId: string): string {
    if (isMe) return "#446df1";
    return "#303030";
}

const bubbleColor = computed(() => {
    if (!props.message.Sender) return '#e0e0e0'
    return isIncoming ? getColorByUserId(props.message.Sender) : ''
});

function isSingleEmojiOnly(message: IArgonMessageDto): boolean {
  const text = message.Text.trim();
  const regex = emojiRegex();
  const matches = [...text.matchAll(regex)];

  return matches.length === 1 && matches[0][0] === text;
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
</style>
