<template>
    <div class="enter-text-wrapper">
        <div v-if="replyTo" class="reply-banner">
            <div class="reply-info">
                <strong>{{ t("replying_to") }}</strong> {{ replyTo.text }}
            </div>
            <X class="text-red-600 cursor-pointer flex-shrink-0" @click="$emit('clear-reply')" />
        </div>

        <div class="flex items-end gap-2 p-2 border rounded-lg bg-background">
            <!-- Textarea message area -->
            <textarea
                ref="editorRef"
                v-model="messageText"
                class="flex-1 text-sm min-h-[40px] max-h-[200px] overflow-y-auto outline-none bg-transparent rounded resize-none"
                :placeholder="t('enter_some_text')"
                @input="onEditorInput"
                @keydown="onEditorKeydown"
                rows="1"
            ></textarea>

            <!-- Emoji picker -->
            <Popover>
                <PopoverTrigger style="align-items: flex-start;">
                    <Button variant="ghost" size="sm" class="h-8 w-8 p-0">
                        <SmileIcon class="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent class="w-auto p-0">
                    <EmojiPicker :native="true" @select="onEmojiClick" :theme="emojiPickerTheme" />
                </PopoverContent>
            </Popover>

            <!-- Send button -->
            <div style="align-items: flex-start;">
                <Button variant="ghost" size="sm" class="h-8 w-8 p-0" @click="handleSend">
                    <SendHorizonalIcon class="h-4 w-4" />
                </Button>
            </div>
        </div>

        <!-- Mentions dropdown -->
        <ul v-if="mention.show && mention.candidates.length"
            class="absolute bottom-full mb-1 w-500 max-h-40 overflow-y-auto text-sm border rounded bg-popover text-popover-foreground shadow z-50 scrollbar-thin">
            <li v-for="(user, i) in mention.candidates" :key="user.id" :class="[
                'flex items-center gap-3 px-3 py-2 cursor-pointer',
                i === mention.index ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            ]" @mousedown.prevent="selectMention(user)">
                <SmartArgonAvatar :user-id="user.id" :overrided-size="32" />
                <span>{{ user.displayName }}</span>
                <span class="text-muted-foreground"> @{{ user.username }}</span>
            </li>
        </ul>
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch, nextTick, computed } from "vue";
import { Button } from "@argon/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@argon/ui/popover";
import EmojiPicker, { type EmojiExt } from "vue3-emoji-picker";
import { logger } from "@argon/core";
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { SendHorizonalIcon, SmileIcon, X } from "lucide-vue-next";
import { useApi } from "@/store/apiStore";
import { type MentionUser, usePoolStore } from "@/store/poolStore";
import { refDebounced } from "@vueuse/core";
import { DirectMessage, EntityType, IMessageEntity, MessageEntityBold, MessageEntityCapitalized, MessageEntityFraction, MessageEntityHashTag, MessageEntityItalic, MessageEntityMention, MessageEntityMonospace, MessageEntityOrdinal, MessageEntitySpoiler, MessageEntityStrikethrough, MessageEntityUnderline } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/localeStore";
import { persistedValue } from "@argon/storage";
const { t } = useLocale();

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const emojiPickerTheme = computed(() => currentTheme.value === "light" ? "light" : "dark");

const editorRef = ref<HTMLTextAreaElement | null>(null);
const messageText = ref("");
const api = useApi();
const pool = usePoolStore();
const mention = reactive({
  show: false,
  query: "",
  candidates: [] as MentionUser[],
  index: 0,
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
  replyTo: DirectMessage | null;
  receiverId: Guid;
}>();

const emit = defineEmits<{
  (e: "clear-reply"): void;
  (e: "send", html: string, rawText: string): void;
}>();

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && props.replyTo) {
    emit("clear-reply");
  }
};

function onEditorInput() {
  // Auto-resize textarea
  if (editorRef.value) {
    editorRef.value.style.height = "auto";
    editorRef.value.style.height = `${Math.min(editorRef.value.scrollHeight, 200)}px`;
  }

  // Check for mention trigger
  const text = messageText.value;
  const cursorPos = editorRef.value?.selectionStart ?? 0;
  const textBeforeCursor = text.slice(0, cursorPos);
  const atIndex = textBeforeCursor.lastIndexOf("@");

  if (atIndex >= 0) {
    const query = textBeforeCursor.slice(atIndex + 1);
    if (/^[\w\d_]{0,20}$/.test(query)) {
      mention.show = true;
      mention.query = query;
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
    if (e.key !== "Enter") return;
    e.preventDefault();
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
  } else if (e.key === "Escape") {
    mention.show = false;
  }
}

function selectMention(user: MentionUser) {
  if (!editorRef.value) return;

  const cursorPos = editorRef.value.selectionStart ?? 0;
  const text = messageText.value;
  
  // Replace @query with @displayName
  const mentionText = `@${user.displayName}`;
  const beforeMention = text.slice(0, mention.startOffset);
  const afterCursor = text.slice(cursorPos);
  
  messageText.value = beforeMention + mentionText + " " + afterCursor;
  
  // Register mention for post-parsing
  mentionRegistry.set(mentionText, user.id);

  // Set cursor position after mention
  nextTick(() => {
    if (editorRef.value) {
      const newPos = mention.startOffset + mentionText.length + 1;
      editorRef.value.setSelectionRange(newPos, newPos);
      editorRef.value.focus();
    }
  });

  mention.show = false;
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

const onEmojiClick = (emoji: EmojiExt) => {
  if (!editorRef.value) return;
  
  const cursorPos = editorRef.value.selectionStart ?? messageText.value.length;
  const before = messageText.value.slice(0, cursorPos);
  const after = messageText.value.slice(cursorPos);
  
  messageText.value = before + emoji.i + after;
  
  nextTick(() => {
    if (editorRef.value) {
      const newPos = cursorPos + emoji.i.length;
      editorRef.value.setSelectionRange(newPos, newPos);
      editorRef.value.focus();
    }
  });
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
 * Supported formats:
 * - __text__ = italic
 * - **text** = bold  
 * - ~~text~~ = strikethrough
 * - ||text|| = spoiler
 * - `text` = monospace
 * - ^text = ordinal (superscript)
 * - ^^text^^ = capitalized
 * - numerator/denominator = fraction (e.g. 1/2)
 * - #hashtag = hashtag
 * - <tailwind-color:text> = colored underline
 * - @mention = mention (from mentionRegistry)
 */
function parseMessageContent(): ParsedMessage {
  let rawText = messageText.value.trim();
  
  const entities: IMessageEntity[] = [];
  const formatMatches: FormatMatch[] = [];

  // Pattern definitions
  const patterns: Array<{
    regex: RegExp;
    type: EntityType;
    contentGroup: number;
    extraHandler?: (match: RegExpMatchArray) => Record<string, any>;
  }> = [
    { regex: /__(.+?)__/g, type: EntityType.Italic, contentGroup: 1 },
    { regex: /\*\*(.+?)\*\*/g, type: EntityType.Bold, contentGroup: 1 },
    { regex: /~~(.+?)~~/g, type: EntityType.Strikethrough, contentGroup: 1 },
    { regex: /\|\|(.+?)\|\|/g, type: EntityType.Spoiler, contentGroup: 1 },
    { regex: /`([^`]+)`/g, type: EntityType.Monospace, contentGroup: 1 },
    { regex: /\^\^(.+?)\^\^/g, type: EntityType.Capitalized, contentGroup: 1 },
    { regex: /\^(\w+)/g, type: EntityType.Ordinal, contentGroup: 1 },
    { 
      regex: /(\d+)\/(\d+)/g, 
      type: EntityType.Fraction, 
      contentGroup: 0,
      extraHandler: (m) => ({ numerator: Number.parseInt(m[1], 10), denominator: Number.parseInt(m[2], 10) })
    },
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
    const entityLength = entityEnd - entityStart;

    // Create entity using proper constructors (required for serialization)
    if (fm.type === EntityType.Mention) {
      entities.push(new MessageEntityMention(
        EntityType.Mention,
        entityStart,
        entityLength,
        1, // version
        fm.extra!.userId
      ));
    } else if (fm.type === EntityType.Hashtag) {
      entities.push(new MessageEntityHashTag(
        EntityType.Hashtag,
        entityStart,
        entityLength,
        1, // version
        fm.content.slice(1) // Remove # prefix
      ));
    } else if (fm.type === EntityType.Underline) {
      entities.push(new MessageEntityUnderline(
        EntityType.Underline,
        entityStart,
        entityLength,
        1, // version
        fm.extra?.colour ?? 0xffffff
      ));
    } else if (fm.type === EntityType.Bold) {
      entities.push(new MessageEntityBold(
        EntityType.Bold,
        entityStart,
        entityLength,
        1 // version
      ));
    } else if (fm.type === EntityType.Italic) {
      entities.push(new MessageEntityItalic(
        EntityType.Italic,
        entityStart,
        entityLength,
        1 // version
      ));
    } else if (fm.type === EntityType.Strikethrough) {
      entities.push(new MessageEntityStrikethrough(
        EntityType.Strikethrough,
        entityStart,
        entityLength,
        1 // version
      ));
    } else if (fm.type === EntityType.Spoiler) {
      entities.push(new MessageEntitySpoiler(
        EntityType.Spoiler,
        entityStart,
        entityLength,
        1 // version
      ));
    } else if (fm.type === EntityType.Monospace) {
      entities.push(new MessageEntityMonospace(
        EntityType.Monospace,
        entityStart,
        entityLength,
        1 // version
      ));
    } else if (fm.type === EntityType.Ordinal) {
      entities.push(new MessageEntityOrdinal(
        EntityType.Ordinal,
        entityStart,
        entityLength,
        1 // version
      ));
    } else if (fm.type === EntityType.Capitalized) {
      entities.push(new MessageEntityCapitalized(
        EntityType.Capitalized,
        entityStart,
        entityLength,
        1 // version
      ));
    } else if (fm.type === EntityType.Fraction) {
      entities.push(new MessageEntityFraction(
        EntityType.Fraction,
        entityStart,
        entityLength,
        1, // version
        fm.extra!.numerator,
        fm.extra!.denominator
      ));
    }

    lastEnd = fm.end;
  }

  // Add remaining text
  cleanText += rawText.slice(lastEnd);

  return { text: cleanText, entities };
}

const handleSend = async () => {
  const { text: plainText, entities } = parseMessageContent();

  if (entities.length === 0 && plainText.length === 0) return;

  // Generate random message ID as bigint
  const randomId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  logger.log("Sending DM message", {
    plainText,
    entities,
    replyTo: props.replyTo?.messageId ?? null,
  });

  await api.userChatInteractions.SendDirectMessage(
    props.receiverId,
    plainText,
    entities,
    randomId,
    props.replyTo?.messageId ?? null,
  );

  if (props.replyTo) {
    emit("clear-reply");
  }
  
  // Clear editor
  messageText.value = "";
  if (editorRef.value) {
    editorRef.value.style.height = "auto";
  }
  
  // Clear mention registry after send
  mentionRegistry.clear();
};
</script>
<style lang="css" scoped>
.enter-text-wrapper {
    position: relative;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
}

textarea {
    font-family: inherit;
    line-height: 1.5;
    color: hsl(var(--foreground));
}

textarea::placeholder {
    color: hsl(var(--muted-foreground));
}

.reply-preview {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 6px;
    color: hsl(var(--foreground) / 0.85);
    background-color: hsl(var(--muted));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border: 1px solid hsl(var(--border) / 0.5);
}

.reply-banner {
    background-color: hsl(var(--muted));
    border-left: 3px solid hsl(var(--border));
    padding: 6px 10px;
    margin-bottom: 6px;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    overflow: hidden;
}

.clear-reply {
    background: transparent;
    border: none;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
}

.reply-info {
    color: hsl(var(--foreground) / 0.85);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
}
</style>
