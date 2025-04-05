<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker, { EmojiExt } from 'vue3-emoji-picker';
import { logger } from '@/lib/logger';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { parseHtmlAsFormattedText, renderTextWithEntities } from "@argon-chat/infer"
import {
    SendHorizonalIcon,
    SmileIcon
} from 'lucide-vue-next';
import { useApi } from '@/store/apiStore';
import { usePoolStore } from '@/store/poolStore';

const message = ref('');
const textareaRef = ref<HTMLTextAreaElement>();
const api = useApi();
const pool = usePoolStore();

marked.setOptions({
    breaks: true,
    gfm: true
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

const emit = defineEmits<{
    (e: 'send', html: string, rawText: string): void;
}>();
const handleSend = async () => {
    if (!message.value.trim()) return;
    if (!pool.selectedChannel) return;

    const md = await renderMarkdown(message.value);

    const entities = parseHtmlAsFormattedText(md, false, true);

    const entitiesList = [] as IMessageEntity[];

    for(let i of entities.entities ?? []) {
        entitiesList.push({
            Length: i.length,
            Offset: i.offset,
            Type: i.type
        });
    }

    
    await api.serverInteraction.SendMessage(pool.selectedChannel, entities.text, entitiesList);
    /*logger.log(entities);
    logger.log(renderTextWithEntities({
        text: entities.text,
        entities: entities.entities,
        shouldRenderAsHtml: true
    }));*/
    message.value = '';
};


</script>

<template>
    <div class="flex items-end gap-2 p-2 border rounded-lg bg-background">
        <textarea ref="textareaRef" @input="adjustHeight" v-model="message" placeholder="Enter text..."
            @keydown.enter.exact.prevent="message.trim() && handleSend"
            class="flex-1 min-h-[40px] max-h-[200px] px-3 py-2 text-sm bg-transparent outline-none resize-none"
            rows="1" />
        <Popover>
            <PopoverTrigger style="align-items: flex-start;">
                <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                    <SmileIcon/>
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
</template>