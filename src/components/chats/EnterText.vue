<template>
    <div class="relative w-full">
        <div v-if="replyTo" class="reply-banner">
            <div class="reply-info">
                <strong>Replying to:</strong> {{ replyTo.Text }}
            </div>
            <X class="text-red-600" @click="$emit('clear-reply')" />
        </div>

        <div class="flex items-end gap-2 p-2 border rounded-lg bg-background">
            <!-- Editable message area -->
            <div ref="editorRef" contenteditable="true"
                class="flex-1 px-3 py-2 text-sm min-h-[40px] max-h-[200px] overflow-y-auto outline-none text-white bg-transparent rounded resize-none"
                @input="onEditorInput" @keydown="onEditorKeydown" placeholder="Enter text..."
                :data-placeholder="'Enter text..'"></div>

            <!-- Emoji picker -->
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

            <!-- Send button -->
            <div style="align-items: flex-start;">
                <Button variant="ghost" size="sm" class="h-8 w-8 p-0" @click="handleSend">
                    <SendHorizonalIcon />
                </Button>
            </div>
        </div>

        <!-- Mentions dropdown -->
        <ul v-if="mention.show && mention.candidates.length"
            class="absolute bottom-full mb-1 w-500 max-h-40 overflow-y-auto text-sm border rounded bg-zinc-900 text-white shadow z-50 scrollbar-thin">
            <li v-for="(user, i) in mention.candidates" :key="user.id" :class="[
                'flex items-center gap-3 px-3 py-2 cursor-pointer',
                i === mention.index ? 'bg-blue-600' : 'hover:bg-zinc-700',
            ]" @mousedown.prevent="selectMention(user)">
                <SmartArgonAvatar :user-id="user.id" :overrided-size="32" />
                <span>{{ user.displayName }}</span>
                <span class="text-gray-400"> @{{ user.username }}</span>
            </li>
        </ul>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import EmojiPicker, { EmojiExt } from 'vue3-emoji-picker';
import { logger } from '@/lib/logger';
import { marked } from 'marked';
import SmartArgonAvatar from '../SmartArgonAvatar.vue';
import {
    SendHorizonalIcon,
    SmileIcon,
    X,
} from 'lucide-vue-next';
import { useApi } from '@/store/apiStore';
import { MentionUser, usePoolStore } from '@/store/poolStore';
import { useDebounce } from '@vueuse/core'

const editorRef = ref<HTMLElement | null>(null)
const api = useApi();
const pool = usePoolStore();
const mention = reactive({
    show: false,
    query: '',
    candidates: [] as MentionUser[],
    index: 0,
    startNode: null as Node | null,
    startOffset: 0,
})
const rawQuery = ref('');
const debouncedQuery = useDebounce(rawQuery, 150)


watch(debouncedQuery, async (query) => {
    if (!query || !mention.show) return
    mention.candidates = await pool.searchMentions(query)
});

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
    (e: 'typing'): void;
    (e: 'stop_typing'): void;
}>();

const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.replyTo) {
        emit('clear-reply');
    }
};

let typingTimeout: NodeJS.Timeout | undefined;
let lastTypingSent = 0;

function onEditorInput() {

    const now = Date.now()

    if (now - lastTypingSent > 3000) {
        emit('typing');
        lastTypingSent = now
    }

    clearTimeout(typingTimeout)
    typingTimeout = setTimeout(() => {
        emit('stop_typing');
    }, 3000);


    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
        mention.show = false
        return
    }

    const range = sel.getRangeAt(0)
    const node = range.startContainer
    const offset = range.startOffset

    const text = node.textContent?.slice(0, offset) || ''
    const atIndex = text.lastIndexOf('@')

    if (atIndex >= 0) {
        const query = text.slice(atIndex + 1)
        if (/^[\w\d_]{0,20}$/.test(query)) {
            mention.show = true
            mention.query = query
            mention.startNode = node
            mention.startOffset = atIndex
            mention.index = 0

            rawQuery.value = mention.query;
            return
        }
    }

    mention.show = false;
    parseInlineFormatting();
}

async function onEditorKeydown(e: KeyboardEvent) {
    if (!mention.show) {
        if (e.shiftKey || e.altKey || e.ctrlKey) return;
        if (e.altKey) return;
        if (e.key !== "Enter") return;
        await handleSend();
        return;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault()
        mention.index = (mention.index + 1) % mention.candidates.length
    } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        mention.index = (mention.index - 1 + mention.candidates.length) % mention.candidates.length
    } else if (e.key === 'Enter') {
        e.preventDefault()
        selectMention(mention.candidates[mention.index])
    }
}
function selectMention(user: MentionUser) {
    const range = document.createRange()
    const sel = window.getSelection()
    if (!mention.startNode || !sel) return

    range.setStart(mention.startNode, mention.startOffset)
    range.setEnd(sel.focusNode!, sel.focusOffset)
    range.deleteContents()
    const span = document.createElement('span')
    span.contentEditable = 'false'
    span.className = 'bg-blue-700 text-white px-1 rounded mr-1'
    span.textContent = `@${user.displayName}`
    span.dataset.userId = user.id

    const space = document.createTextNode('\u00A0')
    range.insertNode(space)
    range.insertNode(span)
    range.setStartAfter(space)
    range.setEndAfter(space)
    sel.removeAllRanges()
    sel.addRange(range)

    mention.show = false
}

function extractMentionsFromEditor(): { id: string; label: string; start: number; end: number }[] {
    const mentions: { id: string; label: string; start: number; end: number }[] = []
    if (!editorRef.value) return mentions

    const walker = document.createTreeWalker(editorRef.value, NodeFilter.SHOW_TEXT, null)
    let index = 0

    while (walker.nextNode()) {
        const node = walker.currentNode
        const parent = node.parentElement

        if (parent?.dataset.userId) {
            const label = node.textContent ?? ''
            const length = label.length
            const id = parent.dataset.userId
            mentions.push({
                id,
                label: label.replace(/^@/, ''),
                start: index,
                end: index + length,
            })
            index += length
        } else {
            index += node.textContent?.length ?? 0
        }
    }

    return mentions
}

function applyItalicToSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const italic = document.createElement('i');
    italic.className = 'italic text-white/70';
    italic.appendChild(range.extractContents());
    range.insertNode(italic);

    range.setStartAfter(italic);
    range.setEndAfter(italic);
    sel.removeAllRanges();
    sel.addRange(range);
}

function isInsideEntity(node: Node): boolean {
    const el = node.parentElement;
    if (!el) return false;
    return (
        el.matches('[data-user-id]') || // mention
        el.matches('[data-url]') ||     // ссылка
        el.matches('[data-fractions]') || // дробь
        el.tagName === 'I' ||
        el.tagName === 'B' ||
        el.tagName === 'U'
    );
}
function parseInlineFormatting() {
    if (!editorRef.value) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const container = editorRef.value;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    const patterns: {
        regex: RegExp,
        tag: string,
        className?: string,
        handleMatch?: (match: RegExpMatchArray) => HTMLElement
    }[] = [
            {
                regex: /~~(.*?)~~/,
                tag: 'i',
                className: 'italic',
            },
            {
                regex: /\*\*(.*?)\*\*/,
                tag: 'b',
                className: 'font-bold',
            },
            {
                regex: /__(.*?)(?::([a-zA-Z0-9\-]{3,20}))?__/,
                tag: 'u',
                handleMatch: (match) => {
                    const [full, text, color] = match;
                    const u = document.createElement('u');
                    u.textContent = text;
                    u.classList.add('underline');

                    if (color) {
                        if (/^[a-fA-F0-9]{3,6}$/.test(color)) {
                            u.classList.add(`decoration-[#${color}]`);
                        } else if (/^[a-z]+-\d{3}$/.test(color)) {
                            u.classList.add(`decoration-${color}`);
                        }
                    }

                    return u;
                },
            },
            {
                regex: /\b(\d)\\(\d)\b/,
                tag: 'span',
                handleMatch: (match) => {
                    const [, numerator, denominator] = match;
                    const span = document.createElement('span');
                    span.className = 'stacked-fractions';
                    span.textContent = `${numerator}/${denominator}`;
                    span.dataset.fractions = "1";
                    return span;
                },
            },
            {
                regex: /\bhttps?:\/\/[^\s<>"'`{}()[\]]+[^\s<>"'`.,!?;:{}()[\]]/,
                tag: 'span',
                handleMatch: (match) => {
                    const url = match[0];
                    const span = document.createElement('span');
                    span.dataset.url = url;
                    span.textContent = new URL(url).hostname;
                    span.className = 'text-blue-600';
                    return span;
                }
            }
        ];

    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const text = node.textContent!;
        if (isInsideEntity(node)) continue;
        for (const { regex, tag, className, handleMatch } of patterns) {
            const match = regex.exec(text);
            if (match) {
                const matchIndex = match.index;
                const matchLength = match[0].length;

                const range = document.createRange();
                range.setStart(node, matchIndex);
                range.setEnd(node, matchIndex + matchLength);

                let el: HTMLElement;
                if (handleMatch) {
                    el = handleMatch(match);
                } else {
                    el = document.createElement(tag);
                    el.textContent = match[1];
                    if (className) el.className = className;
                }

                range.deleteContents();

                const space = document.createTextNode('\u200B');
                const wrapper = document.createDocumentFragment();
                wrapper.appendChild(el);
                wrapper.appendChild(space);
                range.insertNode(wrapper);

                sel.removeAllRanges();
                const newRange = document.createRange();
                newRange.setStart(space, 1);
                newRange.collapse(true);
                sel.addRange(newRange);

                return;
            }
        }
    }
}

function getEditorPlainText(): string {
    const clone = editorRef.value?.cloneNode(true) as HTMLElement
    if (!clone) return ''
    clone.querySelectorAll('[data-user-id]').forEach((el) => el.replaceWith(document.createTextNode(el.textContent || '')));
    clone.querySelectorAll('i').forEach(el => {
        el.replaceWith(document.createTextNode(el.textContent || ''));
    });
    return clone.innerText.replace(/\u00A0/g, ' ').trim();
}

onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
});

const onEmojiClick = (emoji: EmojiExt) => {
    logger.log(emoji);
};

function extractEntitiesFromEditor(): IMessageEntity[] {
    const entities: IMessageEntity[] = [];
    if (!editorRef.value) return entities;

    const walker = document.createTreeWalker(editorRef.value, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let currentOffset = 0;

    function addEntity(offset: number, length: number, type: EntityType, extra?: Partial<IMessageEntity>) {
        entities.push({
            Type: type,
            Offset: offset,
            Length: length,
            Version: 1,
            ...extra,
        } as IMessageEntity);
    }

    while (walker.nextNode()) {
        const node = walker.currentNode;

        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const text = el.textContent || '';
            const length = text.length;

            if (el.dataset.userId) {
                // Mention
                addEntity(currentOffset, length, "Mention", {
                    UserId: el.dataset.userId,
                    Version: 1,
                } as IMessageEntityMention);
            } else if (el.tagName === 'I') {
                addEntity(currentOffset, length, "Italic");
            } else if (el.tagName === 'SPAN' && el.dataset.fractions === "1") {
                addEntity(currentOffset, length, "Fraction");
            } else if (el.tagName === 'SPAN' && el.dataset.url) {
                addEntity(currentOffset, length, "Url", { Domain: new URL(el.dataset.url).hostname, Path:  new URL(el.dataset.url).pathname } as IMessageEntityUrl);
            } else if (el.tagName === 'B') {
                addEntity(currentOffset, length, "Bold");
            } else if (el.tagName === 'U') {
                const styleColor = el.style.textDecorationColor;
                const classColor = [...el.classList].find(c => c.startsWith('text-'));
                let colourHex: string | undefined;

                if (styleColor) {
                    colourHex = styleColor.replace(/^#/, '');
                } else if (classColor) {
                    const tailwindMatch = classColor.match(/^text-(.+)$/);
                    if (tailwindMatch) {
                        const colorKey = tailwindMatch[1];
                        const mapped = ((window as any).tailwindColorMap as any)[colorKey] as any;
                        if (mapped && /^#?[a-fA-F0-9]{3,6}$/.test(mapped)) {
                            colourHex = mapped.replace(/^#/, '');
                        }
                    }
                }

                const colourNum = colourHex ? parseInt(colourHex, 16) : 0xffffff;

                addEntity(currentOffset, length, "Underline", {
                    Colour: colourNum,
                } as IMessageEntityUnderline);
            }

            currentOffset += length;
        } else if (node.nodeType === Node.TEXT_NODE) {
            currentOffset += node.textContent?.length || 0;
        }
    }

    return entities;
}

const handleSend = async () => {
    if (!pool.selectedTextChannel) {
        logger.warn("selected text channel is not defined");
        return;
    }

    const plainText = getEditorPlainText();
    const entities = extractEntitiesFromEditor();

    console.log('Sending message:', plainText)
    console.log('totalEntities:', entities);


    await api.serverInteraction.SendMessage(pool.selectedTextChannel, plainText, entities, (props.replyTo?.MessageId ?? null) as number);

    emit('stop_typing');
    if (props.replyTo) {
        emit('clear-reply');
    }
    if (editorRef.value) {
        editorRef.value.innerHTML = ''
    }
};


</script>
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
