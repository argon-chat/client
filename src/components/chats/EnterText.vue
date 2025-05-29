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

            <div @contextmenu.prevent="onContextMenu"
                class="flex-1 text-sm min-h-[40px] max-h-[200px] overflow-y-auto outline-none text-white bg-transparent rounded resize-none flex items-center"
                ref="editorRef" contenteditable="true" @input="onEditorInput" @keydown="onEditorKeydown"
                placeholder="Enter text..." :data-placeholder="'Enter text..'"></div>

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
import SmartArgonAvatar from '../SmartArgonAvatar.vue';
import {
    SendHorizonalIcon,
    SmileIcon,
    X,
} from 'lucide-vue-next';
import { useApi } from '@/store/apiStore';
import { MentionUser, usePoolStore } from '@/store/poolStore';
import { useDebounce } from '@vueuse/core'
import { Subscription } from 'rxjs';

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
});


const rawQuery = ref('');
const debouncedQuery = useDebounce(rawQuery, 150)

const onContextMenu = (e: MouseEvent) => {
    logger.error("try open context menu", e);

    if (!native.openContextMenu(e.clientX, e.clientY, items)) {
        logger.error("failed to open context menu", e);
    }
}

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
    if (argon.isArgonHost)
        native.clipboardWrite(text);
    else
        await navigator.clipboard.writeText(text);
    selection.deleteFromDocument();
}

async function copy() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const text = selection.toString();
    if (argon.isArgonHost)
        native.clipboardWrite(text);
    else
        await navigator.clipboard.writeText(text);
}

async function paste() {
    const text = argon.isArgonHost ? native.clipboardRead() : await navigator.clipboard.readText();

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

const items: IContextMenuItem[] = [
    { CommandId: 1, Label: 'Undo', KeyCode: 'Ctrl+Z', Action: undo },
    { CommandId: 2, Label: 'Redo', KeyCode: 'Ctrl+Y', Action: redo },
    { IsSeparator: true },
    { CommandId: 4, Label: 'Copy', KeyCode: 'Ctrl+C', Action: copy },
    { CommandId: 5, Label: 'Paste', KeyCode: 'Ctrl+V', Action: paste },
    { CommandId: 6, Label: 'Cut', KeyCode: 'Ctrl+X', Action: cut },
    { CommandId: 7, Label: 'Delete', KeyCode: 'Backspace', Action: deleteSelection },
];

watch(debouncedQuery, async (query) => {
    if (!query || !mention.show) return
    mention.candidates = await pool.searchMentions(query)
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
    cleanFormattingArtifacts();
    resetFormatIfEmpty();
    breakFormattingIfCursorInsideEmptyTag();
    resetEditorIfEmpty();
}

function resetEditorIfEmpty() {
    const el = editorRef.value;
    if (!el) return;

    const onlyBr = el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR';
    const onlyEmpty = Array.from(el.childNodes).every(n =>
        (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).textContent?.trim() === '') ||
        (n.nodeType === Node.TEXT_NODE && n.textContent?.trim() === '')
    );

    if (onlyBr || onlyEmpty) {
        el.innerHTML = ''; 

        const textNode = document.createTextNode(' '); 
        el.appendChild(textNode);

        const range = document.createRange();
        range.setStart(textNode, 1);
        range.collapse(true);

        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }
}

function breakFormattingIfCursorInsideEmptyTag() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const container = range.startContainer as HTMLElement;

    // ищем ближайший форматирующий тег
    let el = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;

    while (el && el !== editorRef.value) {
        if (['B', 'I', 'U'].includes(el.tagName)) {
            // если тег пустой или содержит только <br> / \u200B
            const textContent = el.textContent?.replace(/\u200B/g, '').trim();
            const onlyBr = el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR';

            if (!textContent && (onlyBr || el.childNodes.length === 0)) {
                // заменим формат-тег на пустой текстовый узел
                const text = document.createTextNode('');
                const parent = el.parentNode;
                if (!parent) return;

                parent.replaceChild(text, el);

                // переместим курсор в конец нового текстового узла
                const newRange = document.createRange();
                newRange.setStart(text, 0);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
            }
            return;
        }

        el = el.parentElement;
    }
}

function resetFormatIfEmpty() {
    const el = editorRef.value;
    if (!el) return;
    if (
        el.childNodes.length === 1 &&
        el.firstChild?.nodeName === 'BR'
    ) {
        document.execCommand('removeFormat');
    }
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
function isInsideFormattingTag(node: Node): boolean {
    while (node && node !== editorRef.value) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = (node as HTMLElement).tagName.toLowerCase();
            if (['b', 'i', 'u', 'span'].includes(tag)) {
                return true;
            }
        }
        node = node.parentNode!;
    }
    return false;
}

function cleanFormattingArtifacts() {
    if (!editorRef.value) return;

    const tags = editorRef.value.querySelectorAll('b, i, u, span');

    tags.forEach(tag => {
        const isEmpty = tag.textContent === '' || tag.textContent === '\u200B';
        if (!isEmpty) return;

        const parent = tag.parentNode;
        if (!parent) return;
        const space = document.createTextNode('\u200B');
        parent.replaceChild(space, tag);

        const range = document.createRange();
        range.setStartAfter(space);
        range.collapse(true);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
    });
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
        if (isInsideEntity(node) || isInsideFormattingTag(node)) continue;
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

const onCallContext = (cmd: { commandId: number }) => {
    const item = items.find(x => x.CommandId == cmd.commandId);
    if (item && item.Action) item.Action();
};

function getEditorPlainText(): string {
    const clone = editorRef.value?.cloneNode(true) as HTMLElement
    if (!clone) return ''
    clone.querySelectorAll('[data-user-id]').forEach((el) => el.replaceWith(document.createTextNode(el.textContent || '')));
    clone.querySelectorAll('i').forEach(el => {
        el.replaceWith(document.createTextNode(el.textContent || ''));
    });
    return clone.innerText.replace(/\u00A0/g, ' ').trim();
}

const subs = new Subscription();

onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
    subs.add(bus.subscribeToEvent<{ commandId: number }>('native.host.context.menu.call', onCallContext));
});

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
    subs.unsubscribe();
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


    if (entities.length == 0 && plainText.length == 0)
        return;

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
