<template>
    <div class="relative w-full">
        <div v-if="replyTo" class="reply-banner">
            <div class="reply-info">
                <strong>{{ t("replying_to") }}</strong> {{ replyTo.text }}
            </div>
            <X class="text-red-600" @click="$emit('clear-reply')" />
        </div>

        <div class="flex items-end gap-2 p-2 border rounded-lg bg-background">
            <!-- Editable message area -->
            <div 
                class="flex-1 text-sm min-h-[40px] max-h-[200px] overflow-y-auto outline-none text-white bg-transparent rounded resize-none flex items-center"
                ref="editorRef" 
                contenteditable="true" 
                @input="onEditorInput" 
                @keydown="onEditorKeydown"
                :data-placeholder="t('enter_some_text')"
            ></div>

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
import { onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import EmojiPicker, { type EmojiExt } from "vue3-emoji-picker";
import { logger } from "@/lib/logger";
import SmartArgonAvatar from "../SmartArgonAvatar.vue";
import { SendHorizonalIcon, SmileIcon, X } from "lucide-vue-next";
import { useApi } from "@/store/apiStore";
import { type MentionUser, usePoolStore } from "@/store/poolStore";
import { refDebounced } from "@vueuse/core";
import { ArgonMessage, EntityType, IMessageEntity, MessageEntityHashTag, MessageEntityMention, MessageEntityUnderline } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/localeStore";
const { t } = useLocale();

const editorRef = ref<HTMLElement | null>(null);
const api = useApi();
const pool = usePoolStore();
const mention = reactive({
  show: false,
  query: "",
  candidates: [] as MentionUser[],
  index: 0,
  startNode: null as Node | null,
  startOffset: 0,
});

// Map to store mention text -> userId for post-parsing
const mentionRegistry = new Map<string, string>();

const rawQuery = ref("");
const debouncedQuery = refDebounced(rawQuery, 150);



watch(debouncedQuery, async (query) => {
  if (!query || !mention.show) return;
  mention.candidates = await pool.searchMentions(query);
});

const props = defineProps<{
  replyTo: ArgonMessage | null;
  spaceId: Guid;
}>();

const emit = defineEmits<{
  (e: "clear-reply"): void;
  (e: "send", html: string, rawText: string): void;
  (e: "typing"): void;
  (e: "stop_typing"): void;
}>();

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && props.replyTo) {
    emit("clear-reply");
  }
};

let typingTimeout: NodeJS.Timeout | undefined;
let lastTypingSent = 0;

function onEditorInput() {
  const now = Date.now();

  if (now - lastTypingSent > 3000) {
    emit("typing");
    lastTypingSent = now;
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    emit("stop_typing");
  }, 3000);

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    mention.show = false;
    return;
  }

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  const offset = range.startOffset;

  const text = node.textContent?.slice(0, offset) || "";
  const atIndex = text.lastIndexOf("@");

  if (atIndex >= 0) {
    const query = text.slice(atIndex + 1);
    if (/^[\w\d_]{0,20}$/.test(query)) {
      mention.show = true;
      mention.query = query;
      mention.startNode = node;
      mention.startOffset = atIndex;
      mention.index = 0;

      rawQuery.value = mention.query;
      return;
    }
  }

  mention.show = false;
}



async function onEditorKeydown(e: KeyboardEvent) {
  if (!mention.show) {
    if (e.shiftKey || e.altKey || e.ctrlKey) return;
    if (e.altKey) return;
    if (e.key !== "Enter") return;
    await handleSend();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    mention.index = (mention.index + 1) % mention.candidates.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    mention.index =
      (mention.index - 1 + mention.candidates.length) %
      mention.candidates.length;
  } else if (e.key === "Enter") {
    e.preventDefault();
    selectMention(mention.candidates[mention.index]);
  }
}
function selectMention(user: MentionUser) {
  const range = document.createRange();
  const sel = window.getSelection();
  if (!mention.startNode || !sel) return;

  range.setStart(mention.startNode, mention.startOffset);
  if (sel.focusNode) {
    range.setEnd(sel.focusNode, sel.focusOffset);
  }
  range.deleteContents();
  
  // Insert mention as plain text with special marker
  const mentionText = `@${user.displayName}`;
  const textNode = document.createTextNode(mentionText);
  
  // Register mention for post-parsing
  mentionRegistry.set(mentionText, user.id);

  const space = document.createTextNode("\u00A0");
  range.insertNode(space);
  range.insertNode(textNode);
  range.setStartAfter(space);
  range.setEndAfter(space);
  sel.removeAllRanges();
  sel.addRange(range);

  mention.show = false;
}


onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

const onEmojiClick = (emoji: EmojiExt) => {
  logger.log(emoji);
};

interface ParsedMessage {
  text: string;
  entities: IMessageEntity[];
}

interface FormatMatch {
  start: number;
  end: number;
  content: string;
  type: EntityType;
  extra?: Record<string, any>;
}

/**
 * Parse message content and extract entities
 * Formats:
 * - __text__ = italic
 * - **text** = bold  
 * - ~~text~~ = strikethrough
 * - #hashtag = hashtag
 * - <tailwind-color:text> = colored underline
 * - @mention = mention (from mentionRegistry)
 */
function parseMessageContent(): ParsedMessage {
  if (!editorRef.value) return { text: "", entities: [] };

  // Get raw text from editor
  let rawText = editorRef.value.innerText.replace(/\u00A0/g, " ").trim();
  
  const entities: IMessageEntity[] = [];
  const formatMatches: FormatMatch[] = [];

  // Pattern definitions: [regex, entityType, contentGroupIndex, extraHandler?]
  const patterns: Array<{
    regex: RegExp;
    type: EntityType;
    contentGroup: number;
    extraHandler?: (match: RegExpMatchArray) => Record<string, any>;
  }> = [
    { regex: /__(.+?)__/g, type: EntityType.Italic, contentGroup: 1 },
    { regex: /\*\*(.+?)\*\*/g, type: EntityType.Bold, contentGroup: 1 },
    { regex: /~~(.+?)~~/g, type: EntityType.Strikethrough, contentGroup: 1 },
    { regex: /#(\w+)/g, type: EntityType.Hashtag, contentGroup: 0 },
    { 
      regex: /<([a-z]+-\d{3}):(.+?)>/g, 
      type: EntityType.Underline, 
      contentGroup: 2,
      extraHandler: (m) => {
        const colorKey = m[1];
        const mapped = (window as any).tailwindColorMap?.[colorKey];
        const hex = mapped?.replace(/^#/, "") || "ffffff";
        return { colour: Number.parseInt(hex, 16) };
      }
    },
  ];

  // Find all formatting matches
  for (const { regex, type, contentGroup, extraHandler } of patterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(rawText)) !== null) {
      formatMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: contentGroup === 0 ? match[0] : match[contentGroup],
        type,
        extra: extraHandler?.(match),
      });
    }
  }

  // Find mentions from registry
  for (const [mentionText, userId] of mentionRegistry) {
    let searchPos = 0;
    while (true) {
      const idx = rawText.indexOf(mentionText, searchPos);
      if (idx === -1) break;
      
      formatMatches.push({
        start: idx,
        end: idx + mentionText.length,
        content: mentionText,
        type: EntityType.Mention,
        extra: { userId },
      });
      searchPos = idx + mentionText.length;
    }
  }

  // Sort by start position, then by length (longer matches first for same position)
  formatMatches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Remove overlapping matches (keep first one)
  const nonOverlapping: FormatMatch[] = [];
  for (const fm of formatMatches) {
    const overlaps = nonOverlapping.some(
      existing => !(fm.end <= existing.start || fm.start >= existing.end)
    );
    if (!overlaps) {
      nonOverlapping.push(fm);
    }
  }

  // Build clean text and entities with adjusted offsets
  let cleanText = "";
  let lastEnd = 0;
  
  for (const fm of nonOverlapping) {
    // Add text before this match
    cleanText += rawText.slice(lastEnd, fm.start);
    
    const entityStart = cleanText.length;
    
    // Add content without markers
    cleanText += fm.content;
    
    const entityEnd = cleanText.length;

    // Create entity
    if (fm.type === EntityType.Mention) {
      entities.push({
        type: EntityType.Mention,
        offset: entityStart,
        length: entityEnd - entityStart,
        userId: fm.extra!.userId,
        version: 1,
      } as MessageEntityMention);
    } else if (fm.type === EntityType.Hashtag) {
      entities.push({
        type: EntityType.Hashtag,
        offset: entityStart,
        length: entityEnd - entityStart,
        hashtag: fm.content.slice(1), // Remove # prefix
        version: 1,
      } as MessageEntityHashTag);
    } else if (fm.type === EntityType.Underline) {
      entities.push({
        type: EntityType.Underline,
        offset: entityStart,
        length: entityEnd - entityStart,
        colour: fm.extra?.colour ?? 0xffffff,
        version: 1,
      } as MessageEntityUnderline);
    } else {
      entities.push({
        type: fm.type,
        offset: entityStart,
        length: entityEnd - entityStart,
        version: 1,
      } as IMessageEntity);
    }

    lastEnd = fm.end;
  }

  // Add remaining text
  cleanText += rawText.slice(lastEnd);

  return { text: cleanText, entities };
}

const handleSend = async () => {
  if (!pool.selectedTextChannel) {
    logger.warn("selected text channel is not defined");
    return;
  }

  const { text: plainText, entities } = parseMessageContent();

  if (entities.length === 0 && plainText.length === 0) return;

  // Generate random message ID as bigint
  const randomId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  await api.channelInteraction.SendMessage(
    props.spaceId,
    pool.selectedTextChannel,
    plainText,
    entities,
    randomId,
    props.replyTo?.messageId ?? null,
  );

  emit("stop_typing");
  if (props.replyTo) {
    emit("clear-reply");
  }
  if (editorRef.value) {
    editorRef.value.innerHTML = "";
  }
  
  // Clear mention registry after send
  mentionRegistry.clear();
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
