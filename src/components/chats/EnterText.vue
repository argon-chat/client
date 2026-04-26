<template>
    <div class="relative w-full">
        <div class="relative" @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
            <!-- Drag overlay -->
            <Transition
              enter-active-class="transition duration-150 ease-out"
              leave-active-class="transition duration-100 ease-in"
              enter-from-class="opacity-0"
              leave-to-class="opacity-0"
            >
              <div
                v-if="isDragging && !captionMode"
                class="absolute inset-0 z-20 bg-primary/[0.08] border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none"
              >
                <div class="flex flex-col items-center gap-1 text-primary text-[13px] font-medium">
                  <PaperclipIcon class="w-6 h-6" />
                  <span>{{ t('drop_files_here') || 'Drop files here' }}</span>
                </div>
              </div>
            </Transition>

            <div :class="['flex items-end gap-1 px-2 py-1.5 border border-border rounded-lg bg-background transition-colors focus-within:border-ring', captionMode && '!border-0 !p-1']">
                <!-- Attach file button -->
                <button v-if="!captionMode && canAttachFiles" class="flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-transparent text-muted-foreground cursor-pointer transition-colors hover:bg-muted-foreground/[0.12] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" title="Attach file" @click="openFilePicker">
                    <PaperclipIcon class="w-5 h-5" />
                </button>
                <input
                    v-if="!captionMode"
                    ref="fileInputRef"
                    type="file"
                    multiple
                    class="hidden"
                    @change="onFileInputChange"
                />

                <!-- Rich text input -->
                <EmojiInput
                    ref="editorRef"
                    :model-value="messageText"
                    @update:model-value="onModelValueUpdate"
                    class="flex-1 min-h-9 max-h-[200px] py-1.5 px-1 text-sm leading-relaxed text-foreground overflow-y-auto"
                    :disabled="!canSendMessages"
                    :placeholder="!canSendMessages ? (t('no_send_permission') || 'You do not have permission to send messages') : captionMode ? (t('add_caption') || 'Add a caption...') : t('enter_some_text')"
                    :unstyled="true"
                    render-mode="noto"
                    @input="onEditorInput"
                    @keydown="onEditorKeydown"
                    @paste="onPaste"
                />

                <!-- Emoji picker -->
                <Popover>
                    <PopoverTrigger>
                        <button class="flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-transparent text-muted-foreground cursor-pointer transition-colors hover:bg-muted-foreground/[0.12] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                            <SmileIcon class="w-5 h-5" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent class="w-auto p-0">
                        <EmojixPicker :theme="'auto'" :render-mode="'noto'"
                            @select="onEmojixSelect" />
                    </PopoverContent>
                </Popover>

                <!-- Send button -->
                <Transition
                  enter-active-class="transition-all duration-150"
                  leave-active-class="transition-all duration-150"
                  enter-from-class="opacity-0 scale-50"
                  leave-to-class="opacity-0 scale-50"
                >
                    <button
                      v-if="hasContent"
                      class="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-primary text-primary-foreground cursor-pointer transition-all hover:bg-primary/85 active:scale-[0.92] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                      @click="captionMode ? $emit('submit') : handleSend()"
                      :title="t('send') || 'Send'"
                    >
                        <SendHorizonalIcon class="w-5 h-5" />
                    </button>
                </Transition>
            </div>
        </div>

        <!-- Mentions dropdown -->
        <Transition
          enter-active-class="transition duration-100 ease-out"
          leave-active-class="transition duration-100 ease-in"
          enter-from-class="opacity-0 translate-y-1.5"
          leave-to-class="opacity-0 translate-y-1.5"
        >
        <ul v-if="mention.show && mention.candidates.length"
            class="absolute bottom-full left-0 right-0 max-w-[min(100%,340px)] max-h-[200px] mb-1 overflow-y-auto bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50 list-none p-1 m-0">
            <li v-for="(user, i) in mention.candidates" :key="user.id"
                :class="['flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors', i === mention.index ? 'bg-primary text-primary-foreground' : 'hover:bg-muted']"
                @mousedown.prevent="selectMention(user)"
                @mouseenter="mention.index = i">
                <ArgonAvatar :user-id="user.id" :overrided-size="28" class="shrink-0 rounded-full" />
                <div class="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
                    <span class="font-medium text-[13px] truncate">{{ user.displayName }}</span>
                    <span :class="['text-xs truncate', i === mention.index ? 'text-primary-foreground/70' : 'text-muted-foreground']">@{{ user.username }}</span>
                </div>
            </li>
        </ul>
        </Transition>

        <!-- Slash command dropdown -->
        <Transition
          enter-active-class="transition duration-100 ease-out"
          leave-active-class="transition duration-100 ease-in"
          enter-from-class="opacity-0 translate-y-1.5"
          leave-to-class="opacity-0 translate-y-1.5"
        >
        <ul v-if="slashCmd.show && slashCmd.candidates.length"
            class="absolute bottom-full left-0 right-0 max-w-[min(100%,420px)] max-h-[200px] mb-1 overflow-y-auto bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50 list-none p-1 m-0">
            <li v-for="(cmd, i) in slashCmd.candidates" :key="cmd.commandId"
                :class="['flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors', i === slashCmd.index ? 'bg-primary text-primary-foreground' : 'hover:bg-muted']"
                @mousedown.prevent="selectSlashCommand(cmd)"
                @mouseenter="slashCmd.index = i">
                <div class="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-muted font-bold text-sm text-primary">/</div>
                <div class="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
                    <span class="font-medium text-[13px] truncate">{{ cmd.name }}</span>
                    <span :class="['text-xs truncate', i === slashCmd.index ? 'text-primary-foreground/70' : 'text-muted-foreground']">{{ cmd.description }}</span>
                </div>
            </li>
        </ul>
        </Transition>

        <!-- Formatting Help Dialog -->
        <Dialog v-if="!captionMode" v-model:open="showFormatHelp" class="w-max">
            <DialogContent class="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{{ t('formatting_help') || 'Message Formatting' }}</DialogTitle>
                    <DialogDescription>
                        {{ t('formatting_help_desc') || 'Use these special characters to format your messages' }}
                    </DialogDescription>
                </DialogHeader>

                <div class="space-y-4 py-4">
                    <!-- Text Styling -->
                    <div class="space-y-2">
                        <h3 class="font-semibold text-sm">{{ t('text_styling') || 'Text Styling' }}</h3>
                        <div class="space-y-2 text-sm">
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">**bold text**</code>
                                <span class="flex-1"><BoldSegment :entity="mockBoldEntity" text="bold text" /></span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">__italic text__</code>
                                <span class="flex-1"><ItalicSegment :entity="mockItalicEntity" text="italic text" /></span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">~~strikethrough~~</code>
                                <span class="flex-1"><StrikethroughSegment :entity="mockStrikeEntity" text="strikethrough" /></span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">`monospace code`</code>
                                <span class="flex-1"><MonospaceSegment :entity="mockMonospaceEntity" text="monospace code" /></span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">||spoiler text||</code>
                                <span class="flex-1"><SpoilerSegment :entity="mockSpoilerEntity" text="spoiler text" /></span>
                            </div>
                        </div>
                    </div>

                    <!-- Special Formatting -->
                    <div class="space-y-2">
                        <h3 class="font-semibold text-sm">{{ t('special_formatting') || 'Special Formatting' }}</h3>
                        <div class="space-y-2 text-sm">
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">^^CAPITALIZED^^</code>
                                <span class="flex-1"><CapitalizedSegment :entity="mockCapitalizedEntity" text="capitalized" /></span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">ordinal^5</code>
                                <span class="flex-1">ordinal<OrdinalSegment :entity="mockOrdinalEntity" text="5" /></span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">1/2</code>
                                <span class="flex-1">½ (fraction)</span>
                            </div>
                        </div>
                    </div>

                    <!-- Links and Mentions -->
                    <div class="space-y-2">
                        <h3 class="font-semibold text-sm">{{ t('links_mentions') || 'Links & Mentions' }}</h3>
                        <div class="space-y-2 text-sm">
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">@username</code>
                                <span class="flex-1 text-primary">@username (mention)</span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">#hashtag</code>
                                <span class="flex-1"><HashTagSegment :entity="mockHashtagEntity" text="#hashtag" /></span>
                            </div>
                            <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">&lt;blue-500:text&gt;</code>
                                <span class="flex-1"><UnderlineSegment :entity="mockUnderlineEntity" text="colored underline" /></span>
                            </div>
                             <div class="flex items-center gap-3 p-2 rounded bg-muted/50">
                                <code class="flex-1">&lt;red-500:text&gt;</code>
                                <span class="flex-1"><UnderlineSegment :entity="mockUnderlineEntity2" text="colored underline" /></span>
                            </div>
                        </div>
                    </div>

                    <!-- Tips -->
                    <div class="space-y-2 pt-2 border-t">
                        <h3 class="font-semibold text-sm">{{ t('tips') || 'Tips' }}</h3>
                        <ul class="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                            <li>{{ t('tip_enter') || 'Press Enter to send (Shift+Enter for new line)' }}</li>
                            <li>{{ t('tip_mention') || 'Type @ to mention users' }}</li>
                        </ul>
                    </div>
                </div>

                <DialogFooter>
                    <Button @click="showFormatHelp = false">{{ t('got_it') || 'Got it!' }}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <!-- Attachment Dialog -->
        <AttachmentDialog
            v-if="!captionMode"
            :files="attachments.pendingFiles.value"
            :open="showAttachmentDialog"
            :space-id="spaceId"
            @send="onAttachmentDialogSend"
            @close="showAttachmentDialog = false"
            @add-more="openFilePicker"
            @remove="attachments.removeFile"
            @add-files="onDialogAddFiles"
        />
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch, nextTick, computed } from "vue";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@argon/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { EmojixPicker, EmojiInput, type EmojiSelection } from "@argon-chat/emojix";
import type { EmojiEntry } from "@argon-chat/emojix";
import { logger } from "@argon/core";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import BoldSegment from "./BoldSegment.vue";
import ItalicSegment from "./ItalicSegment.vue";
import StrikethroughSegment from "./StrikethroughSegment.vue";
import MonospaceSegment from "./MonospaceSegment.vue";
import SpoilerSegment from "./SpoilerSegment.vue";
import CapitalizedSegment from "./CapitalizedSegment.vue";
import OrdinalSegment from "./OrdinalSegment.vue";
import HashTagSegment from "./HashTagSegment.vue";
import UnderlineSegment from "./UnderlineSegment.vue";
import { SendHorizonalIcon, SmileIcon, PaperclipIcon } from "lucide-vue-next";
import { useApi } from "@/store/system/apiStore";
import { type MentionUser, usePoolStore } from "@/store/data/poolStore";
import { refDebounced } from "@vueuse/core";
import { ArgonMessage, EntityType, IMessageEntity, MessageEntityBold, MessageEntityCapitalized, MessageEntityFraction, MessageEntityHashTag, MessageEntityItalic, MessageEntityMention, MessageEntityMonospace, MessageEntityOrdinal, MessageEntitySpoiler, MessageEntityStrikethrough, MessageEntityUnderline } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/system/localeStore";
import { useAttachmentUpload } from "@/composables/useAttachmentUpload";
import { useMe } from "@/store/auth/meStore";
import AttachmentDialog from "./AttachmentDialog.vue";
import { usePexStore } from "@/store/data/permissionStore";
import { useSlashCommands } from "@/composables/useSlashCommands";
import { useBotInteraction } from "@/composables/useBotInteraction";
import type { SpaceCommand } from "@argon/glue";
const { t } = useLocale();

const pex = usePexStore();
const canSendMessages = computed(() => pex.has("SendMessages"));
const canAttachFiles = computed(() => pex.has("AttachFiles"));

interface EmojiInputExposed {
  insertEmoji(entry: EmojiEntry): void;
  insertTextAtCursor(text: string): void;
  replaceRange(start: number, end: number, replacement: string): void;
  getCursorOffset(): number;
  setCursorOffset(offset: number): void;
  getTextBeforeCursor(): string;
  focus(): void;
  blur(): void;
  clear(): void;
  getText(): string;
  el: HTMLDivElement | null;
}

const editorRef = ref<EmojiInputExposed | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const messageText = ref("");
const showFormatHelp = ref(false);
const showAttachmentDialog = ref(false);
const isDragging = ref(false);
const api = useApi();
const pool = usePoolStore();
const me = useMe();
const attachments = useAttachmentUpload();

const hasContent = computed(() => messageText.value.trim().length > 0 || attachments.hasFiles.value);

// Mock entities for formatting examples
const mockBoldEntity = new MessageEntityBold(EntityType.Bold, 0, 9, 1);
const mockItalicEntity = new MessageEntityItalic(EntityType.Italic, 0, 11, 1);
const mockStrikeEntity = new MessageEntityStrikethrough(EntityType.Strikethrough, 0, 13, 1);
const mockMonospaceEntity = new MessageEntityMonospace(EntityType.Monospace, 0, 14, 1);
const mockSpoilerEntity = new MessageEntitySpoiler(EntityType.Spoiler, 0, 12, 1);
const mockCapitalizedEntity = new MessageEntityCapitalized(EntityType.Capitalized, 0, 11, 1);
const mockOrdinalEntity = new MessageEntityOrdinal(EntityType.Ordinal, 0, 7, 1);
const mockHashtagEntity = new MessageEntityHashTag(EntityType.Hashtag, 0, 8, 1, "hashtag");
const mockUnderlineEntity = new MessageEntityUnderline(EntityType.Underline, 0, 16, 1, 0x3b82f6);
const mockUnderlineEntity2 = new MessageEntityUnderline(EntityType.Underline, 0, 16, 1, 0xf63b3b);
const mention = reactive({
  show: false,
  query: "",
  candidates: [] as MentionUser[],
  index: 0,
  startOffset: 0,
});

// Slash command autocomplete
const slashCmd = reactive({
  show: false,
  query: "",
  candidates: [] as SpaceCommand[],
  index: 0,
});

const botInteraction = useBotInteraction();
const slashCommands = useSlashCommands(() => props.spaceId);

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
  channelId?: Guid;
  captionMode?: boolean;
}>();

const emit = defineEmits<{
  (e: "clear-reply"): void;
  (e: "send", html: string, rawText: string): void;
  (e: "typing"): void;
  (e: "stop_typing"): void;
  (e: "add-optimistic", msg: ArgonMessage, randomId: bigint): void;
  (e: "resolve-optimistic", randomId: bigint, readback: { messageId: bigint; channelId: Guid; spaceId: Guid }): void;
  (e: "mark-optimistic-failed", randomId: bigint, error: string): void;
  (e: "submit"): void;
}>();

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "Escape" && props.replyTo) {
    emit("clear-reply");
  }
};

// Auto-replacement configuration
const autoReplacements = [
  { pattern: "--", replacement: "—" },
  { pattern: "...", replacement: "…" },
  { pattern: "->", replacement: "→" },
  { pattern: "<-", replacement: "←" },
  { pattern: "<3", replacement: "♥" },
  { pattern: "(c)", replacement: "©" },
  { pattern: "(r)", replacement: "®" },
  { pattern: "(tm)", replacement: "™" },
  { pattern: "+-", replacement: "±" },
  { pattern: "!=", replacement: "≠" },
  { pattern: "<=", replacement: "≤" },
  { pattern: ">=", replacement: "≥" },
  { pattern: "~=", replacement: "≈" },
  { pattern: "<<", replacement: "«" },
  { pattern: ">>", replacement: "»" },
  { pattern: "(shrug)", replacement: "¯\\_(ツ)_/¯" },
  { pattern: "(check)", replacement: "✓" },
  { pattern: "(x)", replacement: "✗" },
];

// Track recent replacements for backspace reversal
interface ReplacementRecord {
  position: number;
  original: string;
  replacement: string;
}
let lastReplacement: ReplacementRecord | null = null;

let typingTimeout: ReturnType<typeof setTimeout> | undefined;
let lastTypingSent = 0;

function onModelValueUpdate(val: string) {
  messageText.value = val;
}

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

  // Auto-replacements
  const cursorPos = editorRef.value?.getCursorOffset() ?? 0;
  const text = messageText.value;
  
  // Check each pattern
  for (const { pattern, replacement } of autoReplacements) {
    // Check if pattern appears just before cursor
    const startPos = cursorPos - pattern.length;
    if (startPos >= 0) {
      const textBeforeCursor = text.slice(startPos, cursorPos);
      
      if (textBeforeCursor === pattern) {
        // Perform replacement
        const before = text.slice(0, startPos);
        const after = text.slice(cursorPos);
        
        messageText.value = before + replacement + after;
        
        // Record this replacement for potential backspace reversal
        lastReplacement = {
          position: startPos,
          original: pattern,
          replacement: replacement,
        };
        
        // Position cursor after replacement
        nextTick(() => {
          if (editorRef.value) {
            const newCursorPos = startPos + replacement.length;
            editorRef.value.setCursorOffset(newCursorPos);
          }
        });
        
        return; // Only one replacement per input event
      }
    }
  }
  
  // Clear replacement record if text changed without replacement
  lastReplacement = null;

  // Check for mention trigger
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
      slashCmd.show = false;
      return;
    }
  }

  mention.show = false;

  // Check for slash command trigger: "/" at start of line
  if (text.startsWith("/") && cursorPos > 0) {
    const query = text.slice(1, cursorPos);
    if (/^[\w\d_-]{0,32}$/.test(query)) {
      const filtered = slashCommands.filterCommands(query);
      if (filtered.length > 0 || slashCommands.commands.value.length === 0) {
        slashCmd.show = true;
        slashCmd.query = query;
        slashCmd.index = 0;
        // Fetch commands lazily on first "/"
        if (slashCommands.commands.value.length === 0) {
          slashCommands.fetchCommands().then(() => {
            slashCmd.candidates = slashCommands.filterCommands(slashCmd.query);
          });
        } else {
          slashCmd.candidates = filtered;
        }
        return;
      }
    }
  }

  slashCmd.show = false;
}



async function onEditorKeydown(e: KeyboardEvent) {
  // Handle backspace to revert auto-replacements
  if (e.key === "Backspace" && !mention.show && editorRef.value && lastReplacement) {
    const cursorPos = editorRef.value.getCursorOffset();
    const text = messageText.value;
    
    // Check if we're right after a replacement
    const expectedPos = lastReplacement.position + lastReplacement.replacement.length;
    
    if (cursorPos === expectedPos) {
      // Check if the replacement is still there
      const replacementText = text.slice(lastReplacement.position, expectedPos);
      
      if (replacementText === lastReplacement.replacement) {
        e.preventDefault();
        
        const before = text.slice(0, lastReplacement.position);
        const after = text.slice(expectedPos);
        
        messageText.value = before + lastReplacement.original + after;
        
        nextTick(() => {
          if (editorRef.value) {
            // Position cursor after the original pattern
            const newCursorPos = lastReplacement!.position + lastReplacement!.original.length;
            editorRef.value.setCursorOffset(newCursorPos);
          }
        });
        
        // Clear the replacement record
        lastReplacement = null;
        
        return;
      }
    }
    
    // If conditions don't match, clear the record
    lastReplacement = null;
  }

  if (!mention.show && !slashCmd.show) {
    if (e.shiftKey || e.altKey || e.ctrlKey) return;
    if (e.altKey) return;
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (props.captionMode) {
      emit("submit");
      return;
    }
    await handleSend();
    return;
  }

  // Slash command navigation
  if (slashCmd.show && slashCmd.candidates.length > 0) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashCmd.index = (slashCmd.index + 1) % slashCmd.candidates.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      slashCmd.index = (slashCmd.index - 1 + slashCmd.candidates.length) % slashCmd.candidates.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectSlashCommand(slashCmd.candidates[slashCmd.index]);
    } else if (e.key === "Escape") {
      slashCmd.show = false;
    }
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

  const cursorPos = editorRef.value.getCursorOffset();
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
      editorRef.value.setCursorOffset(newPos);
      editorRef.value.focus();
    }
  });

  mention.show = false;
}

function selectSlashCommand(cmd: SpaceCommand) {
  slashCmd.show = false;
  messageText.value = "";

  // If command has no options, invoke immediately
  if (!cmd.options || cmd.options.length === 0) {
    const resolvedChannelId = props.channelId ?? pool.selectedTextChannel;
    if (resolvedChannelId) {
      botInteraction.invokeSlashCommand(props.spaceId, resolvedChannelId, cmd.commandId, []);
    }
    return;
  }

  // If command has options, build a simple prompt string and invoke
  // For now, show a basic prompt-based approach via the text field
  // TODO: In the future, implement inline option inputs
  const resolvedChannelId = props.channelId ?? pool.selectedTextChannel;
  if (resolvedChannelId) {
    // Pre-fill the text with the command for user context
    messageText.value = `/${cmd.name} `;
    nextTick(() => {
      if (editorRef.value) {
        const newPos = messageText.value.length;
        editorRef.value.setCursorOffset(newPos);
        editorRef.value.focus();
      }
    });
    // Store selected command for send interception
    selectedSlashCommand.value = { cmd, channelId: resolvedChannelId };
  }
}

const selectedSlashCommand = ref<{ cmd: SpaceCommand; channelId: string } | null>(null);

// Watch for send with active slash command
watch(messageText, (val: string) => {
  if (selectedSlashCommand.value && !val.startsWith("/")) {
    selectedSlashCommand.value = null;
  }
});

onMounted(() => {
  if (!props.captionMode) {
    window.addEventListener("keydown", handleKeyDown);
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

const onEmojixSelect = (selection: EmojiSelection) => {
  if (!editorRef.value) return;
  
  if (selection.emoji) {
    editorRef.value.insertEmoji(selection.emoji);
  } else {
    editorRef.value.insertTextAtCursor(selection.text);
  }
  editorRef.value.focus();
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

// --- Attachment handlers ---

function openFilePicker() {
  fileInputRef.value?.click();
}

async function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    const errors = await attachments.addFiles(input.files);
    for (const err of errors) logger.warn(err);
    if (attachments.hasFiles.value) {
      showAttachmentDialog.value = true;
    }
  }
  input.value = "";
}

function onDragOver() {
  isDragging.value = true;
}

function onDragLeave() {
  isDragging.value = false;
}

async function onDrop(e: DragEvent) {
  isDragging.value = false;
  if (e.dataTransfer?.files?.length) {
    const errors = await attachments.addFiles(e.dataTransfer.files);
    for (const err of errors) logger.warn(err);
    if (attachments.hasFiles.value) {
      showAttachmentDialog.value = true;
    }
  }
}

async function onPaste(e: ClipboardEvent) {
  const files = e.clipboardData?.files;
  if (files?.length) {
    e.preventDefault();
    const errors = await attachments.addFiles(files);
    for (const err of errors) logger.warn(err);
    if (attachments.hasFiles.value) {
      showAttachmentDialog.value = true;
    }
  }
}

function onAttachmentDialogSend(text: string, entities: IMessageEntity[]) {
  showAttachmentDialog.value = false;
  handleSend({ text, entities });
}

async function onDialogAddFiles(files: FileList) {
  const errors = await attachments.addFiles(files);
  for (const err of errors) logger.warn(err);
}

// --- Send handler ---

const handleSend = async (captionContent?: { text: string; entities: IMessageEntity[] }) => {
  if (!canSendMessages.value) return;
  const resolvedChannelId = props.channelId ?? pool.selectedTextChannel;
  if (!resolvedChannelId) {
    logger.warn("selected text channel is not defined");
    return;
  }

  // Handle slash command invocation
  if (selectedSlashCommand.value && messageText.value.startsWith("/")) {
    const { cmd, channelId } = selectedSlashCommand.value;
    const optionText = messageText.value.slice(cmd.name.length + 2).trim(); // Remove "/name "
    const options: { name: string; value: string }[] = [];

    // Parse simple "key:value" pairs from the remaining text
    if (optionText && cmd.options?.length) {
      // If command has a single required option, use the whole text as its value
      if (cmd.options.length === 1) {
        options.push({ name: cmd.options[0].name, value: optionText });
      } else {
        // Try to parse "key:value key2:value2" format
        const parts = optionText.match(/(\w+):("[^"]*"|\S+)/g);
        if (parts) {
          for (const part of parts) {
            const colonIdx = part.indexOf(":");
            const key = part.slice(0, colonIdx);
            let value = part.slice(colonIdx + 1);
            if (value.startsWith('"') && value.endsWith('"')) {
              value = value.slice(1, -1);
            }
            options.push({ name: key, value });
          }
        }
      }
    }

    botInteraction.invokeSlashCommand(props.spaceId, channelId, cmd.commandId, options);
    selectedSlashCommand.value = null;
    messageText.value = "";
    if (editorRef.value) {
      editorRef.value.clear();
    }
    return;
  }

  const { text: plainText, entities } = captionContent ?? parseMessageContent();
  const hasAttachments = attachments.hasFiles.value;

  if (entities.length === 0 && plainText.length === 0 && !hasAttachments) return;

  // Step 3: Crypto-grade random ID — no collisions even at rapid sends
  // Mask top bit: server expects signed Int64 (max 2^63-1)
  const randomId = crypto.getRandomValues(new BigUint64Array(1))[0] & 0x7FFFFFFFFFFFFFFFn;
  const channelId = resolvedChannelId;
  const spaceId = props.spaceId;
  const replyTo = props.replyTo?.messageId ?? null;

  // Build optimistic attachment entities (with placeholder fileId + real thumbHash)
  const optimisticAttachEntities = hasAttachments
    ? attachments.buildOptimisticEntities()
    : [];

  // Detach files from composable BEFORE creating optimistic message
  // This gives us a standalone uploader snapshot and frees the composable for new files
  const detachedUploader = hasAttachments ? attachments.detach() : null;

  // Create optimistic message — appears in chat immediately
  const optimisticMsg = {
    messageId: randomId,
    replyId: replyTo,
    channelId,
    spaceId,
    text: plainText,
    entities: [...entities, ...optimisticAttachEntities],
    timeSent: { date: new Date(), offsetMinutes: 0 },
    sender: me.me!.userId,
  } as ArgonMessage;

  emit("add-optimistic", optimisticMsg, randomId);

  // Clear UI immediately
  emit("stop_typing");
  if (props.replyTo) {
    emit("clear-reply");
  }
  messageText.value = "";
  if (editorRef.value) {
    editorRef.value.clear();
  }
  mentionRegistry.clear();

  // Fire-and-forget: upload + send in background
  (async () => {
    try {
      let finalEntities = [...entities];

      // Upload attachments if any
      if (detachedUploader) {
        const realAttachEntities = await detachedUploader.uploadAll(spaceId, channelId);

        if (detachedUploader.hasErrors()) {
          emit("mark-optimistic-failed", randomId, "Failed to upload attachments");
          detachedUploader.cleanup();
          return;
        }

        finalEntities.push(...realAttachEntities);
      }

      // Send to server
      const readback = await api.channelInteraction.SendMessageWithReadback(
        spaceId,
        channelId,
        plainText,
        finalEntities,
        randomId,
        replyTo,
      );

      // Step 1: Resolve optimistic → replace placeholder with real messageId
      emit("resolve-optimistic", randomId, readback);

      detachedUploader?.cleanup();
    } catch (e: any) {
      logger.error("Failed to send message:", e);
      emit("mark-optimistic-failed", randomId, e?.message ?? "Send failed");
      detachedUploader?.cleanup();
    }
  })();
};

async function handleExternalFiles(files: FileList) {
  const errors = await attachments.addFiles(files);
  for (const err of errors) logger.warn(err);
  if (attachments.hasFiles.value) {
    showAttachmentDialog.value = true;
  }
}

defineExpose({
  handleExternalFiles,
  getParsedContent: parseMessageContent,
  focus: () => editorRef.value?.focus(),
  clear: () => { messageText.value = ''; mentionRegistry.clear(); },
});
</script>
