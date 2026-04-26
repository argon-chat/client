<template>
  <!--
    ╔══════════════════════════════════════════════════════╗
    ║  MessageItem — single message in the virtual list   ║
    ║  Handles: system, regular, emoji-only, attachments  ║
    ╚══════════════════════════════════════════════════════╝
  -->

  <!-- ── System message (call started/ended, user joined) ── -->
  <div v-if="isSystemMessage" class="flex justify-center py-3 w-full">
    <div
      class="px-3 py-1.5 rounded-lg bg-muted/50 text-muted-foreground text-xs text-center max-w-[80%] select-text"
    >
      {{ systemMessageText }}
    </div>
  </div>

  <!-- ── Regular message ── -->
  <div
    v-else-if="user"
    class="group/msg flex items-start gap-2"
    :class="[
      isFirstInGroup ? 'pt-3' : 'pt-0.5',
      isOptimistic && !isFailed ? 'opacity-50' : '',
    ]"
    style="contain: layout style"
  >
    <!-- Avatar -->
    <div class="w-9 shrink-0">
      <template v-if="isFirstInGroup">
        <Popover v-model:open="profileOpen">
          <PopoverTrigger>
            <ArgonAvatar
              :file-id="user.avatarFileId"
              :fallback="user.displayName"
              :userId="user.userId"
              :overrided-size="36"
              class="w-9 h-9 rounded-full cursor-pointer transition-transform hover:scale-105"
            />
          </PopoverTrigger>
          <PopoverContent
            style="width: 21rem"
            class="p-0 rounded-2xl shadow-xl border border-border bg-popover text-popover-foreground overflow-hidden"
          >
            <UserProfilePopover :user-id="user!.userId" @close:pressed="profileOpen = false" />
          </PopoverContent>
        </Popover>
      </template>
      <!-- Grouped: show time on hover instead of empty space -->
      <span
        v-else
        class="hidden group-hover/msg:flex items-center justify-center w-9 h-4 text-[10px] text-muted-foreground/50 select-none tabular-nums"
      >
        {{ formattedTime }}
      </span>
    </div>

    <!-- Content -->
    <div class="flex flex-col items-start min-w-0 max-w-[85%]">

      <!-- Meta row: name + time + status badges -->
      <div v-if="isFirstInGroup" class="flex items-center gap-1.5 mb-0.5">
        <span
          class="text-[13px] font-semibold leading-none"
          :style="{ color: userColor }"
        >
          {{ user.displayName || t('unknown_display_name') }}
        </span>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <span class="text-[11px] text-muted-foreground/60 tabular-nums">{{ formattedTime }}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{{ formattedFullTime }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Loader2Icon
          v-if="isOptimistic && !isFailed"
          class="w-3.5 h-3.5 animate-spin text-muted-foreground"
        />

        <TooltipProvider v-if="isFailed">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="inline-flex items-center gap-0.5 text-destructive p-0 border-none bg-transparent cursor-pointer hover:opacity-70 transition-opacity"
                @click="emit('retry', props.message)"
              >
                <AlertCircleIcon class="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{{ failedError || t('send_failed') || 'Failed to send' }} — {{ t('click_to_retry') || 'click to retry' }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <!-- Unsupported version fallback -->
      <div
        v-if="isUnsupported"
        class="rounded-r-xl rounded-bl-xl border-l-4 border-destructive bg-destructive/10 italic text-sm py-3 px-4"
        v-html="t('not_supported_message_please_update')"
      />

      <!-- Normal content -->
      <template v-else>
        <ContextMenu>
          <ContextMenuTrigger>
            <div
              class="relative inline-flex flex-col"
              @mouseenter="onMouseEnter"
              @mouseleave="onMouseLeave"
            >

              <!-- ── Emoji-only message ── -->
              <div v-if="isSingleEmoji" class="flex flex-col">
                <ReplyPreview
                  v-if="replyMessage"
                  :reply-message="replyMessage"
                  :reply-user="replyUser"
                  @click="emit('scroll-to-message', replyMessage!.messageId)"
                />
                <div class="text-[2.5rem] leading-tight">
                  <ChatSegment
                    v-for="(seg, i) in fragments"
                    :key="i"
                    :entity="seg.entity"
                    :text="seg.text"
                    @unsupported="isUnsupported = true"
                  />
                </div>
              </div>

              <!-- ── Normal message (images + bubble + files) ── -->
              <div v-else class="flex flex-col relative" :style="mediaMaxWidth">

                <!-- Images above the bubble -->
                <AttachmentImageGrid
                  v-if="imageAttachments.length"
                  :images="imageAttachments"
                  class="overflow-hidden"
                  :class="hasOnlyImages ? 'rounded-2xl' : 'rounded-t-2xl'"
                  @open-lightbox="onImageClick"
                />

                <!-- Text/file bubble -->
                <div
                  v-if="!hasOnlyImages"
                  class="flex flex-col px-3 py-2 text-foreground text-sm leading-[1.45] break-words whitespace-pre-wrap bg-muted max-w-[520px] min-w-[120px]"
                  :class="[
                    bubbleRadius,
                    imageAttachments.length ? '!rounded-t-none' : '',
                  ]"
                >
                  <ReplyPreview
                    v-if="replyMessage"
                    :reply-message="replyMessage"
                    :reply-user="replyUser"
                    @click="emit('scroll-to-message', replyMessage!.messageId)"
                  />

                  <!-- Text -->
                  <div v-if="fragments.length" class="relative">
                    <ChatSegment
                      v-for="(seg, i) in fragments"
                      :key="i"
                      :entity="seg.entity"
                      :text="seg.text"
                      @unsupported="isUnsupported = true"
                    />
                    <span
                      v-if="isGrouped"
                      class="float-right text-[11px] text-muted-foreground/50 ml-2 mt-1 leading-none select-none tabular-nums"
                    >
                      {{ formattedTime }}
                    </span>
                  </div>

                  <!-- File cards -->
                  <AttachmentFileCard
                    v-for="(f, i) in fileAttachments"
                    :key="i"
                    :file-id="f.fileId"
                    :file-name="f.fileName"
                    :file-size="f.fileSize"
                    :content-type="f.contentType"
                  />

                  <!-- Inline time when no text -->
                  <span
                    v-if="isGrouped && !fragments.length"
                    class="text-right text-[11px] text-muted-foreground/50 leading-none select-none tabular-nums"
                  >
                    {{ formattedTime }}
                  </span>
                </div>

                <!-- Image-only time overlay -->
                <span
                  v-if="hasOnlyImages && isGrouped"
                  class="absolute bottom-1.5 right-2 text-[11px] text-white drop-shadow-md select-none pointer-events-none tabular-nums"
                >
                  {{ formattedTime }}
                </span>
              </div>

              <!-- Failed state border -->
              <div
                v-if="isFailed"
                class="absolute inset-0 rounded-2xl border border-destructive/30 pointer-events-none"
              />

              <!-- ── Hover action bar ── -->
              <Transition
                enter-active-class="transition duration-150 ease-out"
                leave-active-class="transition duration-100 ease-in"
                enter-from-class="opacity-0 scale-95"
                leave-to-class="opacity-0 scale-95"
              >
                <div
                  v-if="showActions"
                  class="absolute -top-8 right-0 flex items-center gap-px bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-0.5 shadow-lg z-20"
                  @mouseenter="onMouseEnter"
                  @mouseleave="onMouseLeave"
                >
                  <TooltipProvider :delay-duration="400">
                    <Popover v-if="canReact" v-model:open="reactionPickerOpen">
                      <PopoverTrigger as-child>
                        <ActionBtn><SmilePlusIcon class="w-3.5 h-3.5" /></ActionBtn>
                      </PopoverTrigger>
                      <PopoverContent
                        side="top"
                        :side-offset="6"
                        class="p-0 border-0 bg-transparent shadow-none w-auto"
                      >
                        <ReactionPicker @select="onPickReaction" />
                      </PopoverContent>
                    </Popover>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <ActionBtn @click="copyText"><CopyIcon class="w-3.5 h-3.5" /></ActionBtn>
                      </TooltipTrigger>
                      <TooltipContent side="top" :side-offset="4">{{ t('copy') }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <ActionBtn @click="emit('reply', props.message)"><ReplyIcon class="w-3.5 h-3.5" /></ActionBtn>
                      </TooltipTrigger>
                      <TooltipContent side="top" :side-offset="4">{{ t('reply') }}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </Transition>

              <!-- ── Bot controls ── -->
              <MessageControls
                v-if="hasControls"
                :controls="props.message.controls!"
                :message-id="props.message.messageId"
                :space-id="props.message.spaceId"
                :channel-id="props.message.channelId"
              />
            </div>
          </ContextMenuTrigger>

          <!-- ── Reactions (outside bubble to avoid width distortion) ── -->
          <MessageReactions
            v-if="hasReactions"
            :reactions="props.message.reactions"
            :current-user-id="me.me?.userId ?? ''"
            :can-react="canReact"
            @toggle="onToggleReaction"
          />

          <!-- ── Right-click context menu ── -->
          <ContextMenuContent class="min-w-40">
            <ContextMenuItem v-if="canReact" @select="openReactionFromMenu">
              <SmilePlusIcon class="w-4 h-4 mr-2 opacity-60" />
              {{ t('add_reaction') || 'React' }}
            </ContextMenuItem>
            <ContextMenuSeparator v-if="canReact" />
            <ContextMenuItem @select="emit('reply', props.message)">
              <ReplyIcon class="w-4 h-4 mr-2 opacity-60" />
              {{ t('reply') }}
            </ContextMenuItem>
            <ContextMenuItem @select="copyText">
              <CopyIcon class="w-4 h-4 mr-2 opacity-60" />
              {{ t('copy') }}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </template>
    </div>
  </div>
</template>

<!-- ─────────────────────────────────────────── -->
<!-- Inline sub-components (no separate files)   -->
<!-- ─────────────────────────────────────────── -->

<script lang="ts">
import { defineComponent, h } from "vue";

/** Tiny action button used in the hover bar */
const ActionBtn = defineComponent({
  name: "ActionBtn",
  setup(_, { slots }) {
    return () =>
      h(
        "button",
        {
          class:
            "flex items-center justify-center w-[26px] h-[26px] border-none bg-transparent text-muted-foreground rounded-md cursor-pointer transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1",
        },
        slots.default?.(),
      );
  },
});

export { ActionBtn };
</script>

<!-- ─────────────────────────────── -->
<!-- Main script                     -->
<!-- ─────────────────────────────── -->

<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useMe } from "@/store/auth/meStore";
import { useUserColors } from "@/store/chat/userColors";
import { useLocale } from "@/store/system/localeStore";
import { useMessageContent, fragmentMessageText, type IFrag } from "@/composables/useMessageContent";
import { EntityType, type ArgonMessage, type MessageEntityAttachment } from "@argon/glue";
import type { ChatMessage } from "@/composables/useChatMessages";
import emojiRegex from "emoji-regex";

import ArgonAvatar from "@/components/ArgonAvatar.vue";
import UserProfilePopover from "./popovers/UserProfilePopover.vue";
import ChatSegment from "./chats/ChatSegment.vue";
import AttachmentImageGrid from "./chats/AttachmentImageGrid.vue";
import AttachmentFileCard from "./chats/AttachmentFileCard.vue";
import MessageReactions from "./chats/MessageReactions.vue";
import MessageControls from "./chats/MessageControls.vue";
import ReactionPicker from "./chats/ReactionPicker.vue";

import {
  Popover, PopoverTrigger, PopoverContent,
} from "@argon/ui/popover";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@argon/ui/tooltip";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuTrigger, ContextMenuSeparator,
} from "@argon/ui/context-menu";
import {
  CopyIcon, ReplyIcon, AlertCircleIcon,
  Loader2Icon, RefreshCwIcon, SmilePlusIcon,
} from "lucide-vue-next";
import { useDateFormat } from "@vueuse/core";

// ── Shared singleton: timestamp format preference ──
let _tsFmt: string | null = null;
let _tsObs: MutationObserver | null = null;
function tsFormat(): string {
  if (!_tsFmt) {
    _tsFmt = document.documentElement.getAttribute("data-timestamp-format") || "24h";
    if (!_tsObs) {
      _tsObs = new MutationObserver(() => {
        _tsFmt = document.documentElement.getAttribute("data-timestamp-format") || "24h";
      });
      _tsObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-timestamp-format"] });
    }
  }
  return _tsFmt;
}

// ── Shared singleton: emoji regex ──
const emojiRx = emojiRegex();

// ── Inline reply preview component ──
const ReplyPreview = defineComponent({
  name: "ReplyPreview",
  props: {
    replyMessage: { type: Object as () => ArgonMessage, required: true },
    replyUser: { type: Object as () => { displayName?: string } | null, default: null },
  },
  setup(props) {
    const userColors = useUserColors();
    const { t } = useLocale();
    const color = computed(() => userColors.getColorByUserId(props.replyMessage?.sender ?? ""));

    return () =>
      h(
        "div",
        {
          class:
            "flex items-stretch mb-1.5 rounded overflow-hidden cursor-pointer bg-foreground/[0.04] text-[13px] transition-colors hover:bg-foreground/[0.08]",
        },
        [
          h("div", { class: "w-[3px] shrink-0 rounded-l-sm", style: { backgroundColor: color.value } }),
          h("div", { class: "flex flex-col gap-px py-1 px-2.5 min-w-0 overflow-hidden" }, [
            h(
              "span",
              { class: "font-semibold text-xs leading-tight", style: { color: color.value } },
              props.replyUser?.displayName || t("unknown_display_name"),
            ),
            h(
              "span",
              { class: "text-xs text-foreground/60 truncate leading-snug" },
              props.replyMessage?.text ?? "",
            ),
          ]),
        ],
      );
  },
});

// ── Props / Emits ──

const { t } = useLocale();
const pool = usePoolStore();
const me = useMe();
const userColors = useUserColors();

const props = defineProps<{
  message: ChatMessage;
  getMsgById: (replyId: bigint | null) => ArgonMessage;
  isGrouped?: boolean;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  canReact?: boolean;
  toggleReaction?: (messageId: bigint, emoji: string) => void;
}>();

const emit = defineEmits<{
  (e: "reply", message: ArgonMessage): void;
  (e: "retry", message: ArgonMessage): void;
  (e: "scroll-to-message", messageId: bigint): void;
  (e: "open-lightbox", images: MessageEntityAttachment[], index: number, timeSent: Date | null): void;
}>();

// ── Reactive data ──

const profileOpen = ref(false);
const reactionPickerOpen = ref(false);
const isUnsupported = ref(false);

// ── Hover actions (JS-based with debounced leave) ──
const isHovered = ref(false);
let _hoverTimer: ReturnType<typeof setTimeout> | undefined;

const showActions = computed(() => isHovered.value || reactionPickerOpen.value);

function onMouseEnter() {
  clearTimeout(_hoverTimer);
  isHovered.value = true;
}

function onMouseLeave() {
  _hoverTimer = setTimeout(() => { isHovered.value = false; }, 200);
}

function openReactionFromMenu() {
  nextTick(() => { reactionPickerOpen.value = true; });
}

const userIdRef = computed(() => props.message.sender);
const user = pool.getUserReactive(userIdRef);
const userColor = computed(() => userColors.getColorByUserId(props.message.sender ?? ""));

const { isSystemMessage, systemMessageText } = useMessageContent(() => props.message);

// Reactive fragments — recalculates when text/entities change (fixes the stale-text bug)
const fragments = computed<IFrag[]>(() =>
  fragmentMessageText(props.message.text, props.message.entities),
);

// ── Attachments ──

const allAttachments = computed(() =>
  (props.message.entities ?? []).filter(
    (e): e is MessageEntityAttachment => e.type === EntityType.Attachment,
  ),
);

function isImage(a: MessageEntityAttachment): boolean {
  if (a.contentType?.startsWith("image/")) return true;
  const ext = a.fileName?.split(".").pop()?.toLowerCase();
  return !!ext && ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext);
}

const imageAttachments = computed(() => allAttachments.value.filter(isImage));
const fileAttachments = computed(() => allAttachments.value.filter((a) => !isImage(a)));

const hasOnlyImages = computed(
  () =>
    allAttachments.value.length > 0 &&
    fileAttachments.value.length === 0 &&
    !fragments.value.length &&
    !props.message.text?.trim(),
);

// ── Emoji-only detection ──

const isSingleEmoji = computed(() => {
  const text = props.message.text?.trim();
  if (!text) return false;
  const matches = [...text.matchAll(emojiRx)];
  return matches.length >= 1 && matches.length <= 2 && matches.map((m) => m[0]).join("") === text;
});

// ── Reply ──

const replyMessage = computed(() => (props.message.replyId ? props.getMsgById(props.message.replyId) : null));
const replyUserIdRef = computed(() => replyMessage.value?.sender);
const replyUser = pool.getUserReactive(replyUserIdRef);

// ── Status flags ──

const isOptimistic = computed(() => props.message._optimistic === true);
const isFailed = computed(() => props.message._failed === true);
const failedError = computed(() => props.message._error);
const hasControls = computed(() => (props.message.controls ?? []).length > 0);
const hasReactions = computed(() => (props.message.reactions ?? []).length > 0);

// ── Bubble radius (top-left is the "tail" side) ──

const bubbleRadius = computed(() => {
  const first = props.isFirstInGroup;
  const last = props.isLastInGroup;
  // tail: rounded-tl-sm, everything else: rounded-*-2xl
  if (first && last) return "rounded-tl-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl";
  if (first) return "rounded-tl-sm rounded-tr-2xl rounded-br-sm rounded-bl-sm";
  if (last) return "rounded-tl-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl";
  return "rounded-tl-sm rounded-tr-2xl rounded-br-sm rounded-bl-sm";
});

// ── Media max-width (derived from CSS var) ──

const mediaMaxWidth = computed(() => ({
  maxWidth: "calc(var(--chat-width, 600px) * 0.8)",
}));

// ── Time formatting ──

const formattedTime = computed(() => {
  const d = props.message.timeSent.date;
  if (tsFormat() === "12h") {
    const h = d.getHours() % 12 || 12;
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
  }
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
});

const formattedFullTime = useDateFormat(props.message.timeSent.date, "YYYY-MM-DD HH:mm:ss");

// ── Actions ──

function copyText() {
  navigator.clipboard.writeText(props.message.text);
}

function onImageClick(index: number) {
  emit("open-lightbox", imageAttachments.value, index, props.message.timeSent?.date ?? null);
}

function onPickReaction(emoji: string) {
  reactionPickerOpen.value = false;
  props.toggleReaction?.(props.message.messageId, emoji);
}

function onToggleReaction(emoji: string) {
  props.toggleReaction?.(props.message.messageId, emoji);
}
</script>
