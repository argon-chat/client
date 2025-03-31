<template>
    <div class="channel-chat flex flex-col h-full rounded-lg">
        <div v-if="!noMessageChannel" @scroll="onScroll" ref="messageContainer" class="messages flex-1 overflow-y-auto p-4 space-y-4 rounded-t-lg">
            <div v-for="(msg, index) in messages" :key="index" class="message flex space-x-3 items-start">
                <div class="avatar w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-gray-300">
                    1
                </div>
                <div class="tiptap">
                    <p class="text-gray-400 text-sm font-semibold">{{ msg.Text }}</p>
                    <div class="prose prose-sm dark:prose-invert prose-slate" v-html="msg.Text"></div>
                </div>
            </div>
        </div>

        <div v-if="noMessageChannel" class="flex flex-1 flex-col items-center justify-center text-center space-y-2">
            <div class="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <RadioIcon class="h-10 w-10 text-muted-foreground" />
                <h3 class="mt-4 text-lg font-semibold">
                    {{ t("no_text_channel_found") }}
                </h3>
                <p class="mb-4 mt-2 text-sm text-muted-foreground">
                    {{ t("you_not_access_to_channel_or_not_found_channels") }}
                </p>
            </div>
        </div>

        <div v-if="!noMessageChannel" class="message-input p-4 rounded-b-lg flex items-center space-x-3">
            <EditorContent :editor="editor" @keydown.enter="sendMessage"
                class="editor flex-1 text-white p-2 rounded-lg min-h-[40px] focus:outline-none prose prose-sm dark:prose-invert"
                style="min-width: 100%; background-color: #2f2f2f;padding: 20px;" />
        </div>
    </div>
</template>

<script setup lang="ts">
import Blockquote from '@tiptap/extension-blockquote'
import HardBreak from '@tiptap/extension-hard-break'
import Document from '@tiptap/extension-document'
import Mention from '@tiptap/extension-mention'
import Text from '@tiptap/extension-text'
import { Editor, EditorContent } from "@tiptap/vue-3";
import Heading from '@tiptap/extension-heading'
import Strike from '@tiptap/extension-strike'
import BulletList from '@tiptap/extension-bullet-list'
import ListItem from '@tiptap/extension-list-item'
import { RadioIcon } from 'lucide-vue-next';
import { nextTick, onMounted, ref } from 'vue'
import { Paragraph } from './Paragraph'
import { logger } from '@/lib/logger';
import { useApi } from '@/store/apiStore'
import { tiptapToArgonMessage } from '@/lib/messageRender'
import { useLocale } from '@/store/localeStore';
const { t } = useLocale();


const newMessage = ref('');
const props = defineProps<{ channelId: string }>();

const api = useApi();
const messages = ref<IArgonMessage[]>([]);
const noMessageChannel = ref(false);
const messageContainer = ref<HTMLElement | null>(null);
const isLoading = ref(false);
const hasMoreMessages = ref(true);
const offset = ref(0);
const PAGE_SIZE = 50;

const loadMoreMessages = async () => {
    if (isLoading.value || !hasMoreMessages.value) return;
    isLoading.value = true;
    let prevScrollHeight = 0;

    if (messageContainer.value) {
        prevScrollHeight = messageContainer.value.scrollHeight;
    }

    const newMessages = await api.serverInteraction.GetMessages(props.channelId, PAGE_SIZE, offset.value);
    if (newMessages.length === 0) {
        hasMoreMessages.value = false;
    } else {
        messages.value = [...newMessages, ...messages.value];
        offset.value += PAGE_SIZE;
    }
    isLoading.value = false;

    await nextTick();
    if (messageContainer.value) {
        messageContainer.value.scrollTop = messageContainer.value.scrollHeight - prevScrollHeight;
    }
};

const onScroll = () => {
    if (!messageContainer.value) return;
    if (messageContainer.value.scrollTop < 50) {
        loadMoreMessages();
    }
};

onMounted(async () => {
    const initialMessages = await api.serverInteraction.GetMessages(props.channelId, PAGE_SIZE, 0);
    if (initialMessages.length === 0) {
        noMessageChannel.value = true;
    } else {
        messages.value = initialMessages;
        offset.value = PAGE_SIZE;
    }
    await nextTick();
    if (messageContainer.value) {
        messageContainer.value.scrollTop = messageContainer.value.scrollHeight;
    }
});

const sendMessage = async (event: KeyboardEvent) => {
    if (event.shiftKey || event.altKey || event.ctrlKey) return;
    const newMessage = editor.getText().trim();
    if (!newMessage) return;

    logger.log(tiptapToArgonMessage(editor.getJSON()));
    //await api.serverInteraction.SendMessage(props.channelId, newMessage, []);
    editor.commands.clearContent();
};


const editor = new Editor({
    extensions: [
        Document.configure(),
        Paragraph.configure({
            HTMLAttributes: {
                class: "min-h-[1px]",
                style: "line-height: 1rem;"
            },
        }),
        Text,
        Blockquote,
        Heading.configure({ levels: [1, 2, 3] }),
        Strike,
        BulletList,
        ListItem,
        HardBreak.configure({
            keepMarks: false,
        }),
        Mention.configure({
          HTMLAttributes: {
            class: 'mention',
          }
        })
    ],
    onUpdate: () => {
        logger.log(editor.getJSON());
        newMessage.value = editor.getHTML();
    },
});
</script>

<style scoped>
.messages::-webkit-scrollbar {
    width: 6px;
}

.messages::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
}

.editor:focus {
    border: 1px solid #4a90e2;
}

.tiptap:first-child {
    margin-top: 0;
}

.tiptap>hr {
    border: none;
    border-top: 1px solid var(--gray-2);
    cursor: pointer;
    margin: 2rem 0;

    &.ProseMirror-selectednode {
        border-top: 1px solid var(--purple);
    }
}

.ProseMirror p {
    margin: 0;
    padding: 0;
}
</style>
