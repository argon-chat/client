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
};


</script>

<template>
    <div style="display: block;">
        <div v-if="replyTo" :class="
      cn(
        'rainbow-reply-banner',
        'group relative inline-flex h-11 items-center justify-center rounded-xl border-0 bg-[length:200%] px-8 py-2 font-medium text-primary-foreground transition-colors [background-clip:padding-box,border-box,border-box] [background-origin:border-box] [border:calc(0.08*1rem)_solid_transparent] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        
        'bg-[linear-gradient(#121213,#121213),linear-gradient(#121213_50%,rgba(18,18,19,0.6)_80%,rgba(18,18,19,0)),linear-gradient(90deg,var(--color-1),var(--color-5),var(--color-3),var(--color-4),var(--color-2))]',
       )
    ">
            <div class="reply-info" style="color: white;">
                <strong>Replying to:</strong> {{ replyTo.Text }}
            </div>
            <button @click="$emit('clear-reply')" class="clear-reply">✖</button>
        </div>
        <div class="flex items-end gap-2 p-2 border rounded-lg bg-background">

            <textarea ref="textareaRef" @input="adjustHeight" v-model="message" placeholder="Enter text..."
                @keydown.enter.exact.prevent="message.trim() && handleSend"
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
.reply-banner {
    background-color: rgba(255, 255, 255, 0.05);
    border-left: 3px solid #888;
    padding: 6px 10px;
    margin-bottom: 6px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.rainbow-reply-banner {
    padding: 6px 10px;
    margin-bottom: 6px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    --color-1: hsl(0 100% 63%);
    --color-2: hsl(270 100% 63%);
    --color-3: hsl(210 100% 63%);
    --color-4: hsl(195 100% 63%);
    --color-5: hsl(90 100% 63%);
}


.clear-reply {
    background: transparent;
    border: none;
    color: #ccc;
    cursor: pointer;
}
</style>