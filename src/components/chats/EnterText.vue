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

            <ContextMenu>
                <ContextMenuTrigger as="div" :as-child="true" class="p-2">
                    <div class="flex-1 text-sm min-h-[40px] max-h-[200px] overflow-y-auto outline-none text-white bg-transparent rounded resize-none"
                        ref="editorRef" contenteditable="true" @input="onEditorInput" @keydown="onEditorKeydown"
                        placeholder="Enter text..." :data-placeholder="'Enter text..'"></div>
                </ContextMenuTrigger>
                <ContextMenuContent class="w-64">
                    <ContextMenuItem @click="undo">
                        Undo
                        <ContextMenuShortcut>
                            <HotKey :keys="['Ctl', 'Z']" />
                        </ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem @click="redo">
                        Redo
                        <ContextMenuShortcut>
                            <HotKey :keys="['Ctl', 'Y']" />
                        </ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem @click="cut">
                        Cut
                        <ContextMenuShortcut>
                            <HotKey :keys="['Ctl', 'X']" />
                        </ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem @click="copy">
                        Copy
                        <ContextMenuShortcut>
                            <HotKey :keys="['Ctl', 'C']" />
                        </ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem @click="paste">
                        Paste
                        <ContextMenuShortcut>
                            <HotKey :keys="['Ctl', 'V']" />
                        </ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuSub>
                        <ContextMenuSubTrigger inset disabled>
                            Formatting..
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent class="w-48">
                            <ContextMenuItem>
                                Save Page As...
                                <ContextMenuShortcut>⇧⌘S</ContextMenuShortcut>
                            </ContextMenuItem>
                            <ContextMenuItem>Create Shortcut...</ContextMenuItem>
                            <ContextMenuItem>Name Window...</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem>Developer Tools</ContextMenuItem>
                        </ContextMenuSubContent>
                    </ContextMenuSub>
                </ContextMenuContent>
            </ContextMenu>

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
import {
    ContextMenu,
    ContextMenuCheckboxItem,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import HotKey from '../HotKey.vue';

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


const redo = () => {
    document.execCommand('redo');
}
const undo = () => {
    document.execCommand('undo');
}

async function cut() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString();
    await navigator.clipboard.writeText(text);
    selection.deleteFromDocument();
}

async function copy() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString();
    await navigator.clipboard.writeText(text);
}

async function paste() {
    const text = await navigator.clipboard.readText();

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

function deleteSelection() {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
        selection.deleteFromDocument();
    }
}

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

    let currentOffset = 0;

    const processNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            currentOffset += text.length;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;

            const offsetStart = currentOffset;

            if (el.dataset.userId) {
                el.childNodes.forEach(processNode);
                entities.push({
                    Type: "Mention",
                    Offset: offsetStart,
                    Length: currentOffset - offsetStart,
                    UserId: el.dataset.userId,
                    Version: 1
                } as IMessageEntityMention);
            } else if (el.tagName === 'I') {
                el.childNodes.forEach(processNode);
                entities.push({
                    Type: "Italic",
                    Offset: offsetStart,
                    Length: currentOffset - offsetStart,
                    Version: 1
                });
            } else if (el.tagName === 'B') {
                el.childNodes.forEach(processNode);
                entities.push({
                    Type: "Bold",
                    Offset: offsetStart,
                    Length: currentOffset - offsetStart,
                    Version: 1
                });
            } else if (el.tagName === 'U') {
                el.childNodes.forEach(processNode);
                const classColor = [...el.classList].find(c => c.startsWith('decoration-'));
                let colourHex: string | undefined;

                if (classColor) {
                    const colorKey = classColor.replace('decoration-', '').replace(/^\[#/, '').replace(/]$/, '');
                    const mapped = ((window as any).tailwindColorMap || {})[colorKey];
                    if (mapped && /^#?[a-fA-F0-9]{3,6}$/.test(mapped)) {
                        colourHex = mapped.replace(/^#/, '');
                    } else if (/^[a-fA-F0-9]{3,6}$/.test(colorKey)) {
                        colourHex = colorKey;
                    }
                }

                const colourNum = colourHex ? parseInt(colourHex, 16) : 0xffffff;

                entities.push({
                    Type: "Underline",
                    Offset: offsetStart,
                    Length: currentOffset - offsetStart,
                    Colour: colourNum,
                    Version: 1
                } as IMessageEntityUnderline);
            } else if (el.tagName === 'SPAN' && el.dataset.fractions === "1") {
                el.childNodes.forEach(processNode);
                entities.push({
                    Type: "Fraction",
                    Offset: offsetStart,
                    Length: currentOffset - offsetStart,
                    Version: 1
                });
            } else {
                el.childNodes.forEach(processNode);
            }
        }
    };

    editorRef.value.childNodes.forEach(processNode);
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
