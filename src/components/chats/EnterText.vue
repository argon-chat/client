<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker, { EmojiExt } from 'vue3-emoji-picker';
import { logger } from '@/lib/logger';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { parseHtmlAsFormattedText, renderTextWithEntities } from "@argon-chat/infer"
import {
    SendHorizonalIcon,
    SmileIcon,
    X,
} from 'lucide-vue-next';
import { useApi } from '@/store/apiStore';
import { usePoolStore } from '@/store/poolStore';
import { cn } from '@/lib/utils';

const message = ref('');
const textareaRef = ref<HTMLTextAreaElement>();
const api = useApi();
const pool = usePoolStore();

marked.setOptions({
    breaks: true,
    gfm: true
});

const props = defineProps<{
    replyTo: IArgonMessageDto | null
}>();

const emit = defineEmits<{
    (e: 'clear-reply'): void,
    (e: 'send', html: string, rawText: string): void;
}>();

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.replyTo) {
    emit('clear-reply');
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

const onEmojiClick = (emoji: EmojiExt) => {
    logger.log(emoji);
    message.value += emoji.i;
};
const adjustHeight = () => {
    if (textareaRef.value) {
        textareaRef.value.style.height = 'auto';
        textareaRef.value.style.height = `${textareaRef.value.scrollHeight}px`;
    }
};
const renderMarkdown = async (text: string) => {
    const rawMarkdown = await marked(text);
    logger.log("rawMarkdown", rawMarkdown);
    return DOMPurify.sanitize(rawMarkdown).replace(/<\/?p>/g, '').replaceAll('<br>', '\n');
};

const handleSend = async () => {
    if (!message.value.trim()) {
        logger.warn("after trim message is empty");
        return;
    }
    if (!pool.selectedTextChannel) {
        logger.warn("selected text channel is not defined");
        return;
    }

    const md = await renderMarkdown(message.value);

    const entities = parseHtmlAsFormattedText(md, false, true);

    const entitiesList = [] as IMessageEntity[];

    for (let i of entities.entities ?? []) {
        entitiesList.push({
            Length: i.length,
            Offset: i.offset,
            Type: i.type
        });
    }

    await api.serverInteraction.SendMessage(pool.selectedTextChannel, entities.text, entitiesList, (props.replyTo?.MessageId ?? null) as number);
    /*logger.log(entities);
    logger.log(renderTextWithEntities({
        text: entities.text,
        entities: entities.entities,
        shouldRenderAsHtml: true
    }));*/
    message.value = '';

    if (props.replyTo) {
        emit('clear-reply');
    }
};


</script>

<template>
    <div style="display: block;">
        <div v-if="replyTo" class="reply-banner">
            <div class="reply-info">
                <strong>Replying to:</strong> {{ replyTo.Text }}
            </div>
            <X class="text-red-600" @click="$emit('clear-reply')"></X>
        </div>
        <div class="flex items-end gap-2 p-2 border rounded-lg bg-background">

            <textarea ref="textareaRef" @input="adjustHeight" v-model="message" placeholder="Enter text..."
                @keydown.enter.exact.prevent="message.trim() && handleSend()"
                class="flex-1 min-h-[40px] max-h-[200px] px-3 py-2 text-sm bg-transparent outline-none resize-none"
                rows="1" />
            <Popover>
                <PopoverTrigger style="align-items: flex-start;">
                    <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                        <SmileIcon />
                    </Button>
                </PopoverTrigger>
                <PopoverContent class="w-auto p-0">
                    <EmojiPicker :native="true" :disable-skin-tones="true" theme="dark"
                        @select="(e: EmojiExt) => onEmojiClick(e)" />
                </PopoverContent>
            </Popover>
            <div style="align-items: flex-start;">
                <Button variant="ghost" size="sm" class="h-8 w-8 p-0" @click="handleSend">
                    <SendHorizonalIcon />
                </Button>
            </div>


        </div>
    </div>

</template>

<style lang="css" scoped>
.reply-preview {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: #d0d0d0;
    background-color: #1e1e1e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid #2a2a2a;
}

.reply-banner {
    background-color: #222;
    border-left: 3px solid #444;
    padding: 6px 10px;
    margin-bottom: 6px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.clear-reply {
    background: transparent;
    border: none;
    color: #999;
    cursor: pointer;
    margin-left: 8px;
    white-space: nowrap;
    flex-shrink: 0;
}

.reply-info {
    color: #d0d0d0;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-grow: 1;
}
</style>
