<template>
    <div class="relative w-full">
        <div v-if="replyTo" class="reply-banner">
            <div class="reply-info">
                <strong>{{ t("replying_to") }}</strong> {{ replyTo.text }}
            </div>
            <X class="text-red-600" @click="$emit('clear-reply')" />
        </div>

        <div class="flex items-end gap-2 p-2 border rounded-lg bg-background">
            <LexicalComposer :initial-config="editorConfig">
                <LexicalPlainTextPlugin>
                    <template #contentEditable>
                        <LexicalContentEditable
                            class="flex-1 text-sm min-h-[40px] max-h-[200px] overflow-y-auto outline-none text-white bg-transparent rounded resize-none  editor"
                            style="padding-top: 8px;padding-left: 5px;" />
                    </template>
                    <template #placeholder>
                        <div class="editor-placeholder">
                           {{t("enter_some_text")}}
                        </div>
                    </template>
                </LexicalPlainTextPlugin>
            </LexicalComposer>

            <Popover>
                <PopoverTrigger style="align-items: flex-start;">
                    <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                        <SmileIcon />
                    </Button>
                </PopoverTrigger>
                <PopoverContent class="w-auto p-0">
                    <EmojiPicker :native="true" :disable-skin-tones="true" theme="dark" @select="onEmojiClick" />
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

<script setup lang="ts">
import {
  LexicalComposer,
} from "lexical-vue";
import EmojiPicker, { type EmojiExt } from "vue3-emoji-picker";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SmileIcon, SendHorizonalIcon, X } from "lucide-vue-next";
import { useApi } from "@/store/apiStore";
import { usePoolStore, type MentionUser } from "@/store/poolStore";
import { ArgonMessage } from "@/lib/glue/argonChat";
import { useLocale } from "@/store/localeStore";
const { t } = useLocale();

const props = defineProps<{ replyTo: ArgonMessage | null }>();
const emit = defineEmits<{
  (e: "clear-reply"): void;
  (e: "send", html: string, rawText: string): void;
}>();

const pool = usePoolStore();
const api = useApi();

const editorConfig = {
  namespace: "chat-editor",
  editable: true,
  theme: {},
  onError: (e: Error) => console.error(e),
};

const mentionQueryFn = async (query: string): Promise<MentionUser[]> => {
  if (!query) return [];
  return await pool.searchMentions(query);
};

const onMentionSelect = (user: MentionUser) => {
  return {
    value: `@${user.displayName}`,
    data: { userId: user.id },
  };
};

const renderMentionItem = (user: MentionUser) => {
  return `@${user.displayName}`;
};

function onEmojiClick(emoji: EmojiExt) {
  const event = new CustomEvent("insert-emoji", { detail: emoji.i });
  window.dispatchEvent(event);
}

async function handleSend() {
  // TODO: реализовать парс текста из Lexical (html + plainText + mentions) и вызвать emit('send', html, text);
  emit("send", "", ""); // заглушка
}
</script>

<style scoped>
.editor {
    white-space: pre-wrap;
    word-break: break-word;
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

.reply-info {
    color: #d0d0d0;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-grow: 1;
}

.editor-placeholder {
    color: #999;
    overflow: hidden;
    position: absolute;
    top: 15px;
    left: 15px;
    user-select: none;
    pointer-events: none;
}
</style>
