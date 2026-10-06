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
                  <span>{{ t('drop_files_here') }}</span>
                </div>
              </div>
            </Transition>

            <!-- Link preview of the draft (Telegram-style: the first link, dismissable per message) -->
            <LinkPreviewBar
              v-if="!captionMode"
              :visible="linkPreview.visible"
              :loading="linkPreview.loading"
              :url="linkPreview.url"
              :preview="linkPreview.preview"
              @dismiss="linkPreview.dismiss"
            />

            <p v-if="massMentionHint" class="px-1 pb-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="mass-mention-hint">
                {{ t('announcement_everyone_limit') }}
            </p>

            <ComposerPreview v-if="previewVisible" :content="previewContent" />

            <div :class="['flex items-end gap-1 px-2 py-1.5 border border-border rounded-lg bg-background transition-colors focus-within:border-ring overflow-hidden', captionMode && '!border-0 !p-1']">
                <!-- Attach file button -->
                <button v-if="!captionMode && canAttachFiles && !editing" class="icon-motion icon-motion--lift flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-transparent text-muted-foreground cursor-pointer transition-colors hover:bg-muted-foreground/[0.12] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" title="Attach file" @click="openFilePicker">
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
                <MessageInput
                    ref="editorRef"
                    :model-value="messageText"
                    @update:model-value="onModelValueUpdate"
                    @update:entities="(entities) => (composerEmoji = entities)"
                    class="flex-1 min-w-0 min-h-9 max-h-[200px] py-1.5 px-1 text-sm leading-relaxed text-foreground overflow-y-auto break-words [overflow-wrap:anywhere] [word-break:break-word] hide-scrollbar"
                    :disabled="!canSendMessages"
                    :placeholder="!canSendMessages ? t('no_send_permission') : captionMode ? t('add_caption') : t('enter_some_text')"
                    @input="onEditorInput"
                    @keydown="onEditorKeydown"
                    @paste="onPaste"
                    @focus="emojiSuggest.onFocus()"
                    @blur="onEditorBlur"
                    @custom-emoji-limit="onCustomEmojiLimit"
                />

                <!-- Preview of the message as it will be sent -->
                <button
                  v-if="!captionMode"
                  :class="['icon-motion icon-motion--pop flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-transparent cursor-pointer transition-colors hover:bg-muted-foreground/[0.12] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring', showPreview ? 'text-primary' : 'text-muted-foreground']"
                  :title="t('composer_preview_toggle')"
                  :aria-pressed="showPreview"
                  data-testid="composer-preview-toggle"
                  @click="showPreview = !showPreview"
                >
                    <EyeIcon class="w-5 h-5" />
                </button>

                <!-- Emoji, stickers and GIFs -->
                <Popover v-model:open="pickerOpen">
                    <PopoverTrigger as-child>
                        <button
                          type="button"
                          :disabled="!canSendMessages"
                          :aria-label="t('expression_picker_tab_emoji')"
                          :title="t('expression_picker_tab_emoji')"
                          data-testid="expression-picker-toggle"
                          ref="pickerTriggerRef"
                          class="icon-motion icon-motion--pop flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-transparent text-muted-foreground cursor-pointer transition-colors hover:bg-muted-foreground/[0.12] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                            <SmileIcon class="w-5 h-5" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="end"
                      :collision-padding="8"
                      class="w-auto max-w-none p-0"
                      data-testid="expression-picker-popover"
                      @open-auto-focus="onPickerOpenAutoFocus"
                      @close-auto-focus="onPickerCloseAutoFocus"
                      @focus-outside="onPickerFocusOutside"
                      @interact-outside="onPickerInteractOutside"
                      @escape-key-down="onPickerEscape"
                    >
                        <ExpressionPicker
                          ref="pickerRef"
                          :space-id="isDm ? null : (spaceId ?? null)"
                          :tabs="pickerTabs"
                          :can-manage="canManageExpressions"
                          @select-emoji="onPickerEmoji"
                          @select-custom-emoji="handleCustomEmojiSelect"
                          @select-sticker="onPickerSticker"
                          @select-gif="onPickerGif"
                          @select-saved-gif="onPickerSavedGif"
                          @open-settings="openExpressionSettings"
                          @close="pickerOpen = false"
                        />
                    </PopoverContent>
                </Popover>

                <ScheduleSendButton v-if="canSchedule" @schedule="handleSchedule" />

                <!-- Send button -->
                <Transition
                  enter-active-class="transition-all duration-150"
                  leave-active-class="transition-all duration-150"
                  enter-from-class="opacity-0 scale-50"
                  leave-to-class="opacity-0 scale-50"
                >
                    <button
                      v-if="hasContent"
                      class="icon-motion icon-motion--nudge flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-primary text-primary-foreground cursor-pointer transition-all hover:bg-primary/85 active:scale-[0.92] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                      @click="captionMode ? $emit('submit') : handleSend()"
                      :title="editing ? t('save') : t('send')"
                    >
                        <SendHorizonalIcon class="w-5 h-5" />
                    </button>
                </Transition>
            </div>

            <!-- Character counter (absolute, bottom-right of input area) -->
            <Transition
              enter-active-class="transition-opacity duration-150"
              leave-active-class="transition-opacity duration-100"
              enter-from-class="opacity-0"
              leave-to-class="opacity-0"
            >
              <span
                v-if="showCharCounter"
                :class="['absolute right-3 -top-6 text-[11px] font-medium tabular-nums select-none pointer-events-none transition-colors duration-150', charCounterColor, shakeCounter && 'animate-shake']" 
              >
                {{ graphemeCount }}/{{ charLimit }}
              </span>
            </Transition>
        </div>

        <!-- Mentions dropdown -->
        <Transition
          enter-active-class="transition duration-100 ease-out"
          leave-active-class="transition duration-100 ease-in"
          enter-from-class="opacity-0 translate-y-1.5"
          leave-to-class="opacity-0 translate-y-1.5"
        >
        <ul v-if="mention.show && mentionItems.length"
            class="absolute bottom-full left-0 right-0 max-w-[min(100%,340px)] max-h-[200px] mb-1 overflow-y-auto bg-popover text-popover-foreground border border-border rounded-lg shadow-lg z-50 list-none p-1 m-0">
            <li v-for="(user, i) in mentionItems" :key="user.id"
                :class="['flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors', i === mention.index ? 'bg-primary text-primary-foreground' : 'hover:bg-muted']"
                @mousedown.prevent="selectMention(user)"
                @mouseenter="mention.index = i">
                <div v-if="user.id === EVERYONE_ID" class="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-muted text-primary">
                    <UsersIcon class="w-4 h-4" />
                </div>
                <ArgonAvatar v-else :user-id="user.id" :overrided-size="28" class="shrink-0 rounded-full" />
                <div class="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
                    <span class="font-medium text-[13px] truncate">{{ user.displayName }}</span>
                    <span :class="['text-xs truncate', i === mention.index ? 'text-primary-foreground/70' : 'text-muted-foreground']">{{ user.id === EVERYONE_ID ? t('mention_everyone_hint') : '@' + user.username }}</span>
                </div>
            </li>
        </ul>
        </Transition>

        <!-- Emoji suggestions: `:query`, a lone word, an emoji just typed, a one-emoji message -->
        <EmojiSuggestStrip
          v-if="emojiSuggestionsEnabled"
          :open="emojiSuggest.visible.value"
          :items="emojiSuggest.state.items"
          :index="emojiSuggest.state.index"
          :anchor="editorRef?.el ?? null"
          @pick="emojiSuggest.pick"
          @hover="emojiSuggest.select"
        />

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
            <DialogContent described class="max-w-3xl" max-height="80vh">
                <DialogHeader>
                    <DialogTitle>{{ t('formatting_help') }}</DialogTitle>
                    <DialogDescription>
                        {{ t('formatting_help_desc') }}
                    </DialogDescription>
                </DialogHeader>

                <div class="space-y-4 py-4">
                    <!-- Text Styling -->
                    <div class="space-y-2">
                        <h3 class="font-semibold text-sm">{{ t('text_styling') }}</h3>
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
                        <h3 class="font-semibold text-sm">{{ t('special_formatting') }}</h3>
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
                        <h3 class="font-semibold text-sm">{{ t('links_mentions') }}</h3>
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
                        <h3 class="font-semibold text-sm">{{ t('tips') }}</h3>
                        <ul class="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                            <li>{{ t('tip_enter') }}</li>
                            <li>{{ t('tip_mention') }}</li>
                        </ul>
                    </div>
                </div>

                <DialogFooter>
                    <Button @click="showFormatHelp = false">{{ t('got_it') }}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <!-- Attachment Dialog -->
        <AttachmentDialog
            v-if="!captionMode"
            :files="attachments.pendingFiles.value"
            :open="showAttachmentDialog"
            :space-id="spaceId"
            :receiver-id="receiverId"
            @send="onAttachmentDialogSend"
            @close="showAttachmentDialog = false"
            @add-more="openFilePicker"
            @remove="attachments.removeFile"
            @add-files="onDialogAddFiles"
            @replace-file="onReplaceFile"
            @open-editor="onOpenAttachmentEditor"
            @video-prefs="attachments.setVideoPrefs"
        />

        <!-- Media Editor for attachment editing -->
        <MediaEditor
            ref="attachmentEditor"
            v-model="attachmentEditorOpen"
            :src="attachmentEditorSrc"
            :media-type="attachmentEditorMediaType"
            :dev-mode="configStore.devModeEnabled"
            :confirm-discard="confirmAttachmentDiscard"
            :initial-state="attachmentEditorState"
            :media-blob="attachmentEditorBlob"
            :video-bitrate="attachmentEditorBitrate"
            @done="onAttachmentEditorDone"
        />
        <MediaEditorCloseConfirm ref="attachmentCloseConfirm" />
    </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, shallowRef, toRaw, watch, nextTick, computed } from "vue";
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
import MessageInput from "./MessageInput.vue";
import EmojiSuggestStrip from "./EmojiSuggestStrip.vue";
import ExpressionPicker from "@/components/expressions/ExpressionPicker.vue";
import type { PickerTab } from "@/components/expressions/picker/pickerModel";
import { useWindow } from "@/store/ui/windowStore";
import type { MessageInputApi } from "./messageInput";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { onOpenExpressionPack, type ExpressionPackRef } from "@/lib/expressions/expressionInfo";
import { ExpressionKind } from "@argon/glue";
import { MAX_CUSTOM_EMOJI_PER_MESSAGE } from "@/lib/chat/customEmoji";
import { useEmojiSuggest } from "@/composables/useEmojiSuggest";
import { bumpUsage } from "@/lib/chat/emojiSuggest/usage";
import { baseHexcodeOf } from "@/lib/chat/emojiSuggest/emoji";
import { customKey, unicodeKey } from "@/lib/chat/emojiSuggest/rank";
import { emojiSuggestionsEnabled } from "@/lib/chat/emojiSuggest/settings";
import { logger } from "@argon/core";
import { metrics, errorKind } from "@/lib/telemetry/metrics";
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
import { SendHorizonalIcon, SmileIcon, PaperclipIcon, UsersIcon, EyeIcon } from "lucide-vue-next";
import { useApi } from "@/store/system/apiStore";
import { type MentionUser, usePoolStore } from "@/store/data/poolStore";
import { refDebounced } from "@vueuse/core";
import { ArgonMessage, EntityType, IMessageEntity, MessageEntityBold, MessageEntityCapitalized, MessageEntityHashTag, MessageEntityItalic, MessageEntityMonospace, MessageEntityOrdinal, MessageEntitySpoiler, MessageEntityStrikethrough, MessageEntityUnderline, MessageEntityGif, MessageEntitySticker } from "@argon/glue";
import type { ExpressionItem, GifItem, MessageEntityCustomEmoji, SavedGif } from "@argon/glue";
import { Guid, IonDateTime } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/system/localeStore";
import { useAttachmentUpload, type UploadTarget, type VideoSendPhase } from "@/composables/useAttachmentUpload";
import { readAttachmentRefs, type AttachmentRef } from "@/lib/attachments/clipboard";
import { useMe } from "@/store/auth/meStore";
import AttachmentDialog from "./AttachmentDialog.vue";
import { MediaEditor } from "@argon/media-editor";
import type { EditingMediaState, MediaEditorFinalResult, VideoBitrateFn } from "@argon/media-editor";
import { videoEditDecision } from "@/lib/attachments/videoEdit";
import { videoSendErrorKey } from "@/lib/attachments/videoSendErrors";
import { formatLimitBytes, formatLimitDuration, resolveUploadLimits } from "@/lib/attachments/uploadLimits";
import {
  clearAttachmentSendProgress,
  markSendUploaded,
  markSendUploading,
  setAttachmentSendProgress,
} from "@/lib/attachments/sendProgress";
import { videoBitrate } from "@/lib/video/plan";
import MediaEditorCloseConfirm from "@/components/common/MediaEditorCloseConfirm.vue";
import { useMediaEditorCloseGuard } from "@/components/common/mediaEditorCloseGuard";
import { usePexStore } from "@/store/data/permissionStore";
import type { ArgonEntitlementFlag } from "@/lib/rbac/ArgonEntitlement";
import { useSlashCommands } from "@/composables/useSlashCommands";
import { useBotInteraction } from "@/composables/useBotInteraction";
import type { SpaceCommand } from "@argon/glue";
import { useConfigStore } from "@/store/ui/configStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { storeToRefs } from "pinia";
import LinkPreviewBar from "./LinkPreviewBar.vue";
import { useLinkPreviewDraft } from "@/composables/useLinkPreviewDraft";
import { parseMessageContent as parseMessage, serializeMessageContent, type ParsedMessage } from "@/lib/chat/parseMessageContent";
import { useToast } from "@argon/ui/toast";
import { EditMessageError, SendMessageError } from "@argon/glue";
import { sendMessageErrorKey } from "@/lib/refusals";
import { sendLinkPreviews } from "@/lib/linkPreview/settings";
import { composerLimits } from "@/lib/chat/announcement";
import { editErrorKey } from "@/lib/chat/editErrors";
import ComposerPreview from "./ComposerPreview.vue";
import ScheduleSendButton from "./ScheduleSendButton.vue";
import { useChannelDraft } from "@/composables/useChannelDraft";
import { useDroppedMentions } from "@/lib/chat/composerMention";
import { useScheduledPosts } from "@/composables/useScheduledPosts";
const localeStore = useLocale();
const { t } = localeStore;

const configStore = useConfigStore();

const { gifsSelectorActive } = storeToRefs(useFeatureFlags());

// ── GIFs (gated behind af.chat.gifs-selector): a message of one GIF entity and no text ──
const canSendGifs = computed(
  () => gifsSelectorActive.value && canSendMessages.value && canAttachFiles.value && !props.editing && !props.captionMode,
);

const handleGifSelect = (gif: GifItem) => {
  if (!canSendMessages.value || !canAttachFiles.value) return;
  const resolvedChannelId = resolveTargetId();
  if (!resolvedChannelId) return;

  const randomId = crypto.getRandomValues(new BigUint64Array(1))[0] & 0x7FFFFFFFFFFFFFFFn;
  const spaceId = optimisticSpaceId();
  const replyTo = props.replyTo?.messageId ?? null;

  const gifEntity = new MessageEntityGif(
    EntityType.Gif, 0, 0, 1,
    gif.gifId, gif.hmac, null,
    gif.width, gif.height, null,
  );

  const optimisticGifEntity = new MessageEntityGif(
    EntityType.Gif, 0, 0, 1,
    gif.gifId, gif.hmac, null,
    gif.width, gif.height, gif.previewUrl,
  );

  const optimisticMsg = {
    messageId: randomId,
    replyId: replyTo,
    channelId: resolvedChannelId,
    spaceId,
    text: '',
    entities: [optimisticGifEntity],
    timeSent: IonDateTime.now(),
    sender: me.me!.userId,
    reactions: [],
    controls: [],
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    webhook: null,
  } as ArgonMessage;

  emit("add-optimistic", optimisticMsg, randomId);
  if (props.replyTo) emit("clear-reply");

  (async () => {
    const sendTimer = metrics.startTimer("message.send.duration", { kind: "gif" });
    try {
      const sent = await sendToTarget(resolvedChannelId, '', [gifEntity], randomId, replyTo);
      if (!sent.ok) {
        const error = refuseSend(randomId, sent.error);
        sendTimer.end({ result: "failed" });
        metrics.count("message.sent", { kind: "gif", reply: replyTo !== null, result: "failed", error });
        return;
      }
      emit("resolve-optimistic", randomId, sent.readback);
      sendTimer.end({ result: "ok" });
      metrics.count("message.sent", { kind: "gif", reply: replyTo !== null, result: "ok" });
    } catch (e: any) {
      logger.error("Failed to send GIF:", e);
      emit("mark-optimistic-failed", randomId, e?.message ?? "Send failed");
      sendTimer.end({ result: "failed" });
      metrics.count("message.sent", { kind: "gif", reply: replyTo !== null, result: "failed", error: errorKind(e) });
    }
  })();
};

const handleSavedGifSelect = (gif: SavedGif) => {
  if (!canSendMessages.value || !canAttachFiles.value) return;
  const resolvedChannelId = resolveTargetId();
  if (!resolvedChannelId) return;

  const randomId = crypto.getRandomValues(new BigUint64Array(1))[0] & 0x7FFFFFFFFFFFFFFFn;
  const spaceId = optimisticSpaceId();
  const replyTo = props.replyTo?.messageId ?? null;

  const gifEntity = new MessageEntityGif(
    EntityType.Gif, 0, 0, 1,
    gif.gifId ?? '', '', gif.fileId,
    gif.width, gif.height, gif.previewUrl,
  );

  const optimisticMsg = {
    messageId: randomId,
    replyId: replyTo,
    channelId: resolvedChannelId,
    spaceId,
    text: '',
    entities: [gifEntity],
    timeSent: IonDateTime.now(),
    sender: me.me!.userId,
    reactions: [],
    controls: [],
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    webhook: null,
  } as ArgonMessage;

  emit("add-optimistic", optimisticMsg, randomId);
  if (props.replyTo) emit("clear-reply");

  (async () => {
    const sendTimer = metrics.startTimer("message.send.duration", { kind: "gif" });
    try {
      const sent = await sendToTarget(resolvedChannelId, '', [gifEntity], randomId, replyTo);
      if (!sent.ok) {
        const error = refuseSend(randomId, sent.error);
        sendTimer.end({ result: "failed" });
        metrics.count("message.sent", { kind: "gif", reply: replyTo !== null, result: "failed", error });
        return;
      }
      emit("resolve-optimistic", randomId, sent.readback);
      sendTimer.end({ result: "ok" });
      metrics.count("message.sent", { kind: "gif", reply: replyTo !== null, result: "ok" });
    } catch (e: any) {
      logger.error("Failed to send GIF:", e);
      emit("mark-optimistic-failed", randomId, e?.message ?? "Send failed");
      sendTimer.end({ result: "failed" });
      metrics.count("message.sent", { kind: "gif", reply: replyTo !== null, result: "failed", error: errorKind(e) });
    }
  })();
};

// ── Stickers: a message of one sticker entity and no text ──
const canSendStickers = computed(() => canSendMessages.value && !props.editing && !props.captionMode);

/** Resolves to whether the server took the sticker. */
const handleStickerSelect = (item: ExpressionItem): Promise<boolean> => {
  if (!canSendStickers.value) return Promise.resolve(false);
  const resolvedChannelId = resolveTargetId();
  if (!resolvedChannelId) return Promise.resolve(false);

  const randomId = crypto.getRandomValues(new BigUint64Array(1))[0] & 0x7FFFFFFFFFFFFFFFn;
  const spaceId = optimisticSpaceId();
  const replyTo = props.replyTo?.messageId ?? null;

  const sticker = (downloadUrl: string | null, thumbUrl: string | null) => new MessageEntitySticker(
    EntityType.Sticker, 0, 0, 1,
    item.itemId, item.packId, item.spaceId, item.format, item.fileId, item.thumbFileId,
    item.width, item.height, item.outline, downloadUrl, thumbUrl,
  );
  const stickerEntity = sticker(null, null);

  const optimisticMsg = {
    messageId: randomId,
    replyId: replyTo,
    channelId: resolvedChannelId,
    spaceId,
    text: '',
    entities: [sticker(item.downloadUrl, item.thumbUrl)],
    timeSent: IonDateTime.now(),
    sender: me.me!.userId,
    reactions: [],
    controls: [],
    editedAt: null,
    crosspost: null,
    publishedAt: null,
    webhook: null,
  } as ArgonMessage;

  emit("add-optimistic", optimisticMsg, randomId);
  if (props.replyTo) emit("clear-reply");

  return (async () => {
    const sendTimer = metrics.startTimer("message.send.duration", { kind: "sticker" });
    try {
      const sent = await sendToTarget(resolvedChannelId, '', [stickerEntity], randomId, replyTo);
      if (!sent.ok) {
        const error = refuseSend(randomId, sent.error);
        sendTimer.end({ result: "failed" });
        metrics.count("message.sent", { kind: "sticker", reply: replyTo !== null, result: "failed", error });
        return false;
      }
      emit("resolve-optimistic", randomId, sent.readback);
      sendTimer.end({ result: "ok" });
      metrics.count("message.sent", { kind: "sticker", reply: replyTo !== null, result: "ok" });
      return true;
    } catch (e: any) {
      logger.error("Failed to send sticker:", e);
      emit("mark-optimistic-failed", randomId, e?.message ?? "Send failed");
      sendTimer.end({ result: "failed" });
      metrics.count("message.sent", { kind: "sticker", reply: replyTo !== null, result: "failed", error: errorKind(e) });
      return false;
    }
  })();
};

const pex = usePexStore();
const windows = useWindow();

// ── The expressions picker: emoji, the space's custom emoji and stickers, GIFs ──
const pickerOpen = ref(false);
const pickerTriggerRef = ref<HTMLButtonElement | null>(null);
/** Closed by a click or focus elsewhere: focus stays where the user put it. */
let pickerLeftOutside = false;

const pickerTabs = computed<PickerTab[]>(() => [
  "emoji",
  ...(canSendStickers.value ? (["stickers"] as const) : []),
  ...(canSendGifs.value ? (["gifs"] as const) : []),
]);

const canManageExpressions = computed(
  () => !isDm.value && !!props.spaceId
    && (pex.hasInSpace(props.spaceId, "CreateExpressions") || pex.hasInSpace(props.spaceId, "ManageExpressions")),
);

watch(pickerOpen, (open) => {
  if (open) pickerLeftOutside = false;
});

// The picker focuses its own search (not on touch screens).
function onPickerOpenAutoFocus(e: Event) {
  e.preventDefault();
}

function onPickerCloseAutoFocus(e: Event) {
  e.preventDefault();
  if (!pickerLeftOutside) editorRef.value?.focus();
}

/** A pick puts the caret back in the input; the picker stays open for the next one. */
function onPickerFocusOutside(e: Event) {
  const root = editorRef.value?.el;
  if (root && e.target instanceof Node && root.contains(e.target)) e.preventDefault();
}

function onPickerInteractOutside(e: Event) {
  const onTrigger = e.target instanceof Node && !!pickerTriggerRef.value?.contains(e.target);
  if (!e.defaultPrevented && !onTrigger) pickerLeftOutside = true;
}

// Closes the picker only: not the reply or the edit (see handleKeyDown).
function onPickerEscape(e: KeyboardEvent) {
  e.preventDefault();
  pickerOpen.value = false;
}

function onPickerEmoji(unicode: string) {
  if (!canSendMessages.value || !editorRef.value) return;
  emojiSuggest.markPicker();
  editorRef.value.insertEmoji(unicode);
  bumpUsage(unicodeKey(baseHexcodeOf(unicode)));
}

function onPickerSticker(item: ExpressionItem) {
  void handleStickerSelect(item);
  pickerOpen.value = false;
}

function onPickerGif(gif: GifItem) {
  handleGifSelect(gif);
  pickerOpen.value = false;
}

function onPickerSavedGif(gif: SavedGif) {
  handleSavedGifSelect(gif);
  pickerOpen.value = false;
}

function openExpressionSettings() {
  pickerLeftOutside = true;
  pickerOpen.value = false;
  windows.openServerSettings("expressions");
}

// ── "Open pack" on a custom emoji or sticker in the chat: the pack, in this composer's picker ──
const pickerRef = ref<InstanceType<typeof ExpressionPicker> | null>(null);
const expressions = useExpressionsStore();

/** Whether this picker shows the pack: a direct chat's has every loaded space's, a channel's only its space's. */
function pickerHasPack(packId: string, spaceId: string): boolean {
  if (!canSendMessages.value || (!isDm.value && spaceId !== props.spaceId)) return false;
  const pack = expressions.bySpace.get(spaceId)?.packs.find((p) => p.packId === packId);
  if (!pack) return false;
  const tab: PickerTab = pack.kind === ExpressionKind.Sticker ? "stickers" : "emoji";
  return pickerTabs.value.includes(tab);
}

/** False for a pack this picker does not offer. */
function openPackInPicker(pack: ExpressionPackRef): boolean {
  if (!pickerHasPack(pack.packId, pack.spaceId)) return false;
  pickerOpen.value = true;
  void (async () => {
    for (let i = 0; i < 5 && !pickerRef.value; i++) await nextTick();
    await pickerRef.value?.openPack(pack.packId);
  })();
  return true;
}

let stopOpeningPacks: (() => void) | null = null;

// ── Character limit ──

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Count graphemes in one pass. O(n), no allocations beyond the iterator. */
function countGraphemes(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/**
 * Counted once per input event inside onModelValueUpdate.
 * NOT a computed — avoids redundant re-iteration of the segmenter.
 */
const graphemeCount = ref(0);
// Announcement channels take long posts (the server's MaxAnnouncementTextLength).
const limits = computed(() => composerLimits(me.isPremium));
const charLimit = computed(() => limits.value.limit);
const charWarnThreshold = computed(() => limits.value.warn);
const charDangerThreshold = computed(() => limits.value.danger);
const showCharCounter = computed(() => graphemeCount.value > limits.value.counterFrom);
const isOverLimit = computed(() => graphemeCount.value > charLimit.value);
const charCounterColor = computed(() => {
  if (graphemeCount.value >= charLimit.value) return "text-red-500";
  if (graphemeCount.value >= charDangerThreshold.value) return "text-red-400";
  if (graphemeCount.value >= charWarnThreshold.value) return "text-orange-400";
  return "text-muted-foreground";
});

const shakeCounter = ref(false);
let shakeTimeout: ReturnType<typeof setTimeout> | undefined;

function triggerShake() {
  shakeCounter.value = false;
  // Force reflow so re-adding the class restarts the animation
  void document.body.offsetHeight;
  shakeCounter.value = true;
  clearTimeout(shakeTimeout);
  shakeTimeout = setTimeout(() => { shakeCounter.value = false; }, 400);
}

const editorRef = ref<MessageInputApi | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const messageText = ref("");
/** The custom emoji in the composer, over `messageText` (MessageInput keeps them in step). */
const composerEmoji = shallowRef<MessageEntityCustomEmoji[]>([]);
const showFormatHelp = ref(false);
const showAttachmentDialog = ref(false);
const isDragging = ref(false);
const api = useApi();
const pool = usePoolStore();
const me = useMe();
const attachments = useAttachmentUpload({
  // A video's upload limits (size and length) are the target's own.
  uploadTarget: () => {
    const targetId = resolveTargetId();
    return targetId ? uploadTarget(targetId) : null;
  },
});

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

// Emoji suggestions and the instant replacements (`:)`, `:joy:`, `--`).
const emojiSuggest = useEmojiSuggest({
  editor: () => editorRef.value,
  text: () => messageText.value,
  placed: () => composerEmoji.value,
  spaceId: () => (isDm.value ? null : (props.spaceId ?? null)),
  canSendStickers: () => canSendStickers.value,
  blocked: () => mention.show || slashCmd.show || pickerOpen.value,
  uiLocale: () => localeStore.currentLocale ?? "en",
  sendSticker: (item) => void sendSuggestedSticker(item),
});

function onEditorBlur() {
  draft.blurred();
  emojiSuggest.hide();
}

/** A sticker from the strip: sent as the picker sends it; the emoji it was found by goes once it is. */
async function sendSuggestedSticker(item: ExpressionItem) {
  const typed = messageText.value;
  if (!(await handleStickerSelect(item)) || messageText.value !== typed) return;
  messageText.value = "";
  graphemeCount.value = 0;
  editorRef.value?.clear();
  void draft.clear();
}

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
  /** The space of a channel composer. Absent in a direct chat. */
  spaceId?: Guid;
  channelId?: Guid;
  /** Set for a direct chat: the message goes to this person instead of a channel. */
  receiverId?: Guid;
  captionMode?: boolean;
  /** A sent message of the user's own being edited in this composer, or null. Channels only. */
  editing?: ArgonMessage | null;
  /** An announcement channel: say what @everyone costs here. */
  announcement?: boolean;
}>();

// ── Where the message goes ──
// One composer for channels and direct chats. What differs: which call sends the message, which
// endpoint takes its files, and that a direct chat has no permissions to check and no bot
// commands to offer. Everything else — formatting, mentions, emoji, GIFs, attachments, link
// previews, the character limit — is the same in both.
const isDm = computed(() => !!props.receiverId);

// Checked in the channel itself: overwrites can take any of these away in one channel only.
const allowsHere = (flag: ArgonEntitlementFlag) =>
  isDm.value || pex.hasIn(props.channelId ?? pool.selectedTextChannel ?? null, flag, props.spaceId);

const canSendMessages = computed(() => allowsHere("SendMessages"));
const canAttachFiles = computed(() => allowsHere("AttachFiles"));
const canUseCommands = computed(() => !isDm.value && allowsHere("UseCommands"));
const canMentionEveryone = computed(() => !isDm.value && allowsHere("MentionEveryone"));

/** The id the message is filed under: the channel, or the peer in a direct chat. */
function resolveTargetId(): Guid | null {
  if (props.receiverId) return props.receiverId;
  return props.channelId ?? pool.selectedTextChannel ?? null;
}

/** The space an optimistic row carries: none in a direct chat. */
function optimisticSpaceId(): Guid {
  return props.receiverId ? ("" as Guid) : props.spaceId!;
}

/** Where this composer's files are uploaded. */
function uploadTarget(targetId: Guid): UploadTarget {
  return props.receiverId
    ? { kind: "dm", peerId: props.receiverId }
    : { kind: "channel", spaceId: props.spaceId!, channelId: targetId };
}

/**
 * Sends to the channel or the peer and returns what the list needs to replace the optimistic row,
 * or why the server refused the message. A direct send answers with the message id only; the rest
 * is filled in so both paths look alike to the caller.
 */
async function sendToTarget(
  targetId: Guid,
  text: string,
  entities: IMessageEntity[],
  randomId: bigint,
  replyTo: bigint | null,
): Promise<{ ok: true; readback: { messageId: bigint; channelId: Guid; spaceId: Guid } } | { ok: false; error: SendMessageError }> {
  if (props.receiverId) {
    const messageId = await api.userChatInteractions.SendDirectMessage(props.receiverId, text, entities, randomId, replyTo);
    return { ok: true, readback: { messageId, channelId: props.receiverId, spaceId: "" as Guid } };
  }
  const result = await api.channelInteraction.SendMessage(props.spaceId!, targetId, text, entities, randomId, replyTo);
  if (result.isSuccessSendMessage()) return { ok: true, readback: result.readback };
  return { ok: false, error: result.isFailedSendMessage() ? result.error : SendMessageError.NONE };
}

/** Marks the optimistic row failed with the server's reason, as a thrown send would; returns it as a metric label. */
function refuseSend(randomId: bigint, error: SendMessageError): string {
  const label = metrics.enumName(SendMessageError, error);
  logger.warn("Message refused:", label);
  emit("mark-optimistic-failed", randomId, t(sendMessageErrorKey(error)));
  return label;
}

const emit = defineEmits<{
  (e: "clear-reply"): void;
  (e: "send", html: string, rawText: string): void;
  (e: "typing"): void;
  (e: "stop_typing"): void;
  (e: "add-optimistic", msg: ArgonMessage, randomId: bigint): void;
  (e: "resolve-optimistic", randomId: bigint, readback: { messageId: bigint; channelId: Guid; spaceId: Guid }): void;
  (e: "mark-optimistic-failed", randomId: bigint, error: string): void;
  (e: "submit"): void;
  (e: "cancel-edit"): void;
  (e: "edit-last"): void;
  (e: "edited", message: ArgonMessage): void;
}>();

// ── Link preview of the draft ──
// Off for captions (a picture already is the preview), for members without PostEmbeddedLinks (the
// server would drop the stub anyway) and when the user turned it off in settings.
const canEmbedLinks = computed(() => allowsHere("PostEmbeddedLinks"));
const linkPreview = useLinkPreviewDraft({
  text: () => messageText.value,
  enabled: () => !props.captionMode && !props.editing && canEmbedLinks.value && sendLinkPreviews.value,
});

const handleKeyDown = (e: KeyboardEvent) => {
  // Taken by something on top (the expressions picker).
  if (e.defaultPrevented) return;
  if (e.key === "Escape" && props.editing) {
    emit("cancel-edit");
  } else if (e.key === "Escape" && props.replyTo) {
    emit("clear-reply");
  }
};

let typingTimeout: ReturnType<typeof setTimeout> | undefined;
let lastTypingSent = 0;

function onModelValueUpdate(val: string) {
  // Single segmenter pass: count graphemes and find truncation point together
  const limit = charLimit.value;
  let count = 0;
  let truncEnd = 0; // byte index where the limit-th grapheme ends
  let hitLimit = false;

  for (const seg of segmenter.segment(val)) {
    count++;
    if (!hitLimit) {
      if (count <= limit) {
        truncEnd = seg.index + seg.segment.length;
      } else {
        hitLimit = true;
      }
    }
  }

  if (hitLimit) {
    messageText.value = val.slice(0, truncEnd);
    graphemeCount.value = limit;
    triggerShake();
    nextTick(() => {
      if (editorRef.value) {
        const truncated = messageText.value;
        if (editorRef.value.getText() !== truncated) {
          editorRef.value.clear();
          editorRef.value.insertTextAtCursor(truncated);
          editorRef.value.setCursorOffset(limit);
        }
      }
    });
    return;
  }

  graphemeCount.value = count;
  messageText.value = val;
}

function onEditorInput(previous: string) {
  const now = Date.now();

  if (!props.editing && now - lastTypingSent > 3000) {
    emit("typing");
    lastTypingSent = now;
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    emit("stop_typing");
  }, 3000);

  // Instant replacements (`:)`, `:joy:`, `--`), or the strip's own edit: nothing else to look at.
  if (emojiSuggest.onInput(previous)) return;

  const cursorPos = editorRef.value?.getCursorOffset() ?? 0;
  const text = messageText.value;

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
      emojiSuggest.hide();
      return;
    }
  }

  mention.show = false;

  emojiSuggest.update();
  if (emojiSuggest.visible.value) {
    slashCmd.show = false;
    return;
  }

  // Check for slash command trigger: "/" at start of line (bots live in spaces, not in direct chats,
  // and only for members with UseCommands there)
  if (canUseCommands.value && text.startsWith("/") && cursorPos > 0) {
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
  // Nothing to pick from: the keys belong to the composer.
  if (mention.show && !mentionItems.value.length) mention.show = false;

  // Backspace takes back a replacement; the strip's keys: Left/Right, Enter/Tab, Esc (the strip only).
  if (!mention.show && emojiSuggest.onKeydown(e)) return;

  if (!mention.show && !slashCmd.show) {
    if (e.key === "ArrowUp" && !messageText.value && !props.editing && !props.captionMode && !isDm.value) {
      e.preventDefault();
      emit("edit-last");
      return;
    }
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

  const items = mentionItems.value;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    mention.index = (mention.index + 1) % items.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    mention.index = (mention.index - 1 + items.length) % items.length;
  } else if (e.key === "Enter") {
    e.preventDefault();
    selectMention(items[mention.index]);
  } else if (e.key === "Escape") {
    mention.show = false;
  }
}

function selectMention(user: MentionUser) {
  if (!editorRef.value) return;

  const cursorPos = editorRef.value.getCursorOffset();
  const text = messageText.value;
  
  // Replace @query with @displayName; @everyone is found by the parser, not the registry.
  const isEveryone = user.id === EVERYONE_ID;
  const mentionText = isEveryone ? "@everyone" : `@${user.displayName}`;
  const beforeMention = text.slice(0, mention.startOffset);
  const afterCursor = text.slice(cursorPos);
  
  messageText.value = beforeMention + mentionText + " " + afterCursor;
  
  // Register mention for post-parsing
  if (!isEveryone) mentionRegistry.set(mentionText, user.id);

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

/** A custom emoji picked in the expressions picker: in at the caret. */
function handleCustomEmojiSelect(item: ExpressionItem) {
  if (!canSendMessages.value || !editorRef.value) return;
  emojiSuggest.markPicker();
  if (editorRef.value.insertCustomEmoji(item)) bumpUsage(customKey(item.itemId));
  editorRef.value.focus();
}

function onCustomEmojiLimit() {
  toast({ title: t("custom_emoji_limit", { max: MAX_CUSTOM_EMOJI_PER_MESSAGE }), variant: "destructive" });
}

function selectSlashCommand(cmd: SpaceCommand) {
  slashCmd.show = false;
  if (!canUseCommands.value) return;
  messageText.value = "";

  const spaceId = props.spaceId;
  if (!spaceId) return;

  // If command has no options, invoke immediately
  if (!cmd.options || cmd.options.length === 0) {
    const resolvedChannelId = props.channelId ?? pool.selectedTextChannel;
    if (resolvedChannelId) {
      botInteraction.invokeSlashCommand(spaceId, resolvedChannelId, cmd.commandId, []);
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
    stopOpeningPacks = onOpenExpressionPack(openPackInPicker, pickerHasPack);
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
  stopOpeningPacks?.();
  stopOpeningPacks = null;
});

/** What the composer would send right now: the typed text, markers turned into entities. */
function parseMessageContent(): ParsedMessage {
  return parseMessage(messageText.value, mentionRegistry, {
    everyone: canMentionEveryone.value,
    customEmoji: composerEmoji.value,
  });
}

/** Puts a text with its custom emoji into the composer (a draft, a message being edited). */
function setComposer(raw: string, customEmoji: MessageEntityCustomEmoji[]) {
  messageText.value = raw;
  composerEmoji.value = customEmoji;
  graphemeCount.value = countGraphemes(raw);
  editorRef.value?.setValue({ text: raw, entities: customEmoji });
}

// ── Author tools: preview, scheduled send, the server-side draft ──

const showPreview = ref(false);
const previewVisible = computed(() => showPreview.value && !props.captionMode && messageText.value.trim().length > 0);
const previewContent = computed(() => parseMessageContent());

/** Drafts and scheduled posts belong to a channel composer: not a direct chat, not a caption. */
const channelTarget = () =>
  !isDm.value && !props.captionMode && props.spaceId && props.channelId
    ? { spaceId: props.spaceId, channelId: props.channelId }
    : null;

const scheduling = useScheduledPosts(channelTarget, { load: false });
// A scheduled post carries text and entities only: no reply, and files are sent, not scheduled.
const canSchedule = computed(
  () => !!channelTarget() && canSendMessages.value && !props.editing && !props.replyTo
    && !attachments.hasFiles.value && messageText.value.trim().length > 0,
);

const draft = useChannelDraft({
  target: channelTarget,
  text: () => messageText.value,
  parse: parseMessageContent,
  restore: (d) => {
    const { raw, mentions, customEmoji } = serializeMessageContent(d.text, d.entities ?? []);
    mentionRegistry.clear();
    for (const [text, userId] of mentions) mentionRegistry.set(text, userId);
    setComposer(raw, customEmoji);
  },
  editing: () => !!props.editing,
});

// ── A voice member dropped on this channel: their mention goes in at the end ──

async function appendMention(userId: string) {
  const user = await pool.getUser(userId);
  if (!user || !editorRef.value) return;

  const mentionText = `@${user.displayName}`;
  mentionRegistry.set(mentionText, user.userId);
  const text = messageText.value;
  const next = `${text}${text && !/\s$/.test(text) ? " " : ""}${mentionText} `;
  messageText.value = next;
  graphemeCount.value = countGraphemes(next);
  nextTick(() => {
    editorRef.value?.focus();
    editorRef.value?.setCursorOffset(next.length);
  });
}

useDroppedMentions(
  () => (props.captionMode || props.editing || !canSendMessages.value || !editorRef.value ? null : props.channelId ?? null),
  draft.ready,
  (userId) => void appendMention(userId),
);

async function handleSchedule(at: Date) {
  const content = parseMessageContent();
  const stub = linkPreview.takeStub(content.text);
  if (stub) content.entities.push(stub);
  if (!(await scheduling.schedule(content, at))) return;
  emit("stop_typing");
  void draft.clear();
  messageText.value = "";
  editorRef.value?.clear();
  mentionRegistry.clear();
}

// ── @everyone ──

const EVERYONE_ID = "@everyone";

/** The people found for the typed @query, with @everyone first for those who may ping it. */
const mentionItems = computed<MentionUser[]>(() => {
  const offerEveryone = canMentionEveryone.value && "everyone".startsWith(mention.query.toLowerCase());
  return offerEveryone
    ? [{ id: EVERYONE_ID, displayName: "@everyone", username: "everyone" }, ...mention.candidates]
    : mention.candidates;
});

const massMentionHint = computed(
  () => !!props.announcement && canMentionEveryone.value && /(?<![\w@])@everyone(?!\w)/.test(messageText.value),
);

// ── Editing a sent message ──
// The composer holds the message as it was typed: markers and mentions go back in, and the same
// parser that sends turns it into text and entities again. Files and link cards stay as they are.

const { toast } = useToast();
let editBaseline = "";
let editBaselineEmoji = "";
/** What the user was typing before the edit took the composer; it comes back afterwards. */
let draftBeforeEdit: { text: string; mentions: Map<string, string>; customEmoji: MessageEntityCustomEmoji[] } | null = null;

const emojiKey = (entities: readonly MessageEntityCustomEmoji[]) => entities.map((e) => `${e.offset}:${e.itemId}`).join(",");

watch(
  () => props.editing,
  (message, previous) => {
    if (message) {
      if (!previous) {
        void draft.flush();
        draftBeforeEdit = { text: messageText.value, mentions: new Map(mentionRegistry), customEmoji: composerEmoji.value };
      }
      const { raw, mentions, customEmoji } = serializeMessageContent(message.text, message.entities ?? []);
      mentionRegistry.clear();
      for (const [text, userId] of mentions) mentionRegistry.set(text, userId);
      editBaseline = raw;
      editBaselineEmoji = emojiKey(customEmoji);
      setComposer(raw, customEmoji);
      nextTick(() => {
        editorRef.value?.focus();
        editorRef.value?.setCursorOffset(raw.length);
      });
    } else if (previous) {
      const draft = draftBeforeEdit;
      draftBeforeEdit = null;
      editBaseline = "";
      editBaselineEmoji = "";
      mentionRegistry.clear();
      for (const [text, userId] of draft?.mentions ?? []) mentionRegistry.set(text, userId);
      setComposer(draft?.text ?? "", draft?.customEmoji ?? []);
    }
  },
);

async function submitEdit(message: ArgonMessage) {
  if (messageText.value === editBaseline && emojiKey(composerEmoji.value) === editBaselineEmoji) {
    emit("cancel-edit");
    return;
  }

  const { text, entities } = parseMessageContent();
  const hasFiles = (message.entities ?? []).some((e) => e.type === EntityType.Attachment || e.type === EntityType.Gif);
  if (!text && !hasFiles) {
    triggerShake();
    return;
  }

  try {
    const result = await api.channelInteraction.EditMessage(message.spaceId, message.channelId, message.messageId, text, entities);
    if (result.isSuccessEditMessage()) {
      metrics.count("message.edited", { result: "ok" });
      emit("edited", result.message);
      emit("cancel-edit");
      return;
    }
    const error = result.isFailedEditMessage() ? result.error : EditMessageError.NONE;
    metrics.count("message.edited", { result: "failed", error: metrics.enumName(EditMessageError, error) });
    toast({ title: t("edit_failed"), description: t(editErrorKey(error)), variant: "destructive" });
  } catch (e) {
    metrics.count("message.edited", { result: "failed", error: errorKind(e) });
    logger.error("Failed to edit message:", e);
    toast({ title: t("edit_failed"), description: t("edit_error_unknown"), variant: "destructive" });
  }
}

// --- Attachment handlers ---

function openFilePicker() {
  if (!canAttachFiles.value) return;
  fileInputRef.value?.click();
}

async function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length && canAttachFiles.value) {
    const errors = await attachments.addFiles(input.files);
    for (const err of errors) logger.warn(err);
    if (attachments.hasFiles.value) {
      showAttachmentDialog.value = true;
    }
  }
  input.value = "";
}

function onDragOver() {
  if (canAttachFiles.value && !props.editing) isDragging.value = true;
}

function onDragLeave() {
  isDragging.value = false;
}

/** Files or references queued into the composer; the dialog opens over whatever landed. */
async function stage(added: Promise<string[]>) {
  const errors = await added;
  for (const err of errors) logger.warn(err);
  if (attachments.hasFiles.value) {
    showAttachmentDialog.value = true;
  }
}

async function onDrop(e: DragEvent) {
  isDragging.value = false;
  if (!canAttachFiles.value || props.editing) return;
  // A file dragged out of a chat — ours or the browser's own drag of its picture — is a reference
  // to what the server already has, and goes in as a copy rather than as bytes.
  const refs = readAttachmentRefs(e.dataTransfer, true);
  if (refs.length) {
    await stage(attachments.addReferences(refs, null, "drag"));
    return;
  }
  if (e.dataTransfer?.files?.length) {
    await stage(attachments.addFiles(e.dataTransfer.files));
  }
}

async function onPaste(e: ClipboardEvent) {
  emojiSuggest.markPaste();
  // `types` is a list the event already carries; `files` is not — reading it makes Chromium
  // materialise every file on the clipboard, and for a bitmap that is a synchronous PNG encode in
  // the browser process, which stalls every window of the app. Only ask when there is a file, and
  // let text win when the clipboard holds both (copies from Office and browsers often do).
  const types = e.clipboardData?.types ?? [];
  // A copy of a file out of a chat: the clipboard names the file (our own type, or the `<img src>`
  // every "Copy image" writes), so the paste sends a copy of it instead of the bitmap.
  const refs = readAttachmentRefs(e.clipboardData, !types.includes("text/plain"));
  if (!refs.length && (!types.includes("Files") || types.includes("text/plain"))) return;
  // Without AttachFiles a pasted image goes nowhere; let the paste fall through to the editor.
  if (!canAttachFiles.value || props.editing) return;
  if (refs.length) {
    e.preventDefault();
    const bitmaps = types.includes("Files") ? e.clipboardData?.files : null;
    await stage(attachments.addReferences(refs, bitmaps, "clipboard"));
    return;
  }
  const files = e.clipboardData?.files;
  if (files?.length) {
    e.preventDefault();
    await stage(attachments.addFiles(files));
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

/** Other bytes in an attachment's place: described again from scratch (hash, link, size, video state). */
function onReplaceFile(index: number, file: File, previewUrl?: string | null, size?: { width: number; height: number }) {
  void attachments.replaceFile(index, file, { previewUrl, width: size?.width, height: size?.height });
}

/** The editor's still as a preview URL, or null. */
const stillUrl = (still: Blob | undefined) => (still ? URL.createObjectURL(still) : null);

const mp4Name = (name: string) => `${name.replace(/\.[^./\\]+$/, "").trim() || "video"}.mp4`;

// --- Attachment Media Editor ---
const attachmentEditorOpen = ref(false);
// Unsaved edits: the editor asks before it closes.
const {
  editor: attachmentEditor,
  closeConfirm: attachmentCloseConfirm,
  confirmDiscard: confirmAttachmentDiscard,
} = useMediaEditorCloseGuard();
const attachmentEditorSrc = ref("");
const attachmentEditorMediaType = ref<"image" | "video">("image");
let attachmentEditingIndex = -1;
// A video reopens where its last edit left it, with the file as picked (its audio goes into a
// render) and a bitrate the preparation will copy rather than encode again.
const attachmentEditorState = shallowRef<Partial<EditingMediaState> | undefined>(undefined);
const attachmentEditorBlob = shallowRef<Blob | undefined>(undefined);
const attachmentEditorBitrate = shallowRef<VideoBitrateFn | undefined>(undefined);

// A video handed to the editor is a fresh object URL over the pending file, which pins the whole
// file until it is revoked — and it never was. Released once the editor is done with it: after
// the export has read it, or on cancel. (Images reuse the attachment's own preview URL.)
let attachmentEditorFinalizing = false;
function releaseAttachmentEditorSrc() {
  const src = attachmentEditorSrc.value;
  if (attachmentEditorMediaType.value === "video" && src.startsWith("blob:")) URL.revokeObjectURL(src);
  attachmentEditorSrc.value = "";
}
watch(attachmentEditorOpen, (open) => {
  if (open) return;
  // Closing and `done` can arrive in either order; give a pending export the tick it needs to claim the URL.
  setTimeout(() => {
    if (attachmentEditorFinalizing) return;
    releaseAttachmentEditorSrc();
    attachmentEditorState.value = undefined;
    attachmentEditorBlob.value = undefined;
    attachmentEditorBitrate.value = undefined;
  }, 0);
});

function onOpenAttachmentEditor(index: number, src: string, mediaType: "image" | "video") {
  const entry = attachments.pendingFiles.value[index];
  const video = entry?.video;
  attachmentEditingIndex = index;
  attachmentEditorSrc.value = src;
  attachmentEditorMediaType.value = mediaType;
  attachmentEditorState.value = video ? (video.editorState ?? { videoMuted: video.prefs.mute }) : undefined;
  attachmentEditorBlob.value = mediaType === "video" && entry ? toRaw(video?.source ?? entry.file) : undefined;
  if (video) {
    const source = { width: video.sourceProbe.width, height: video.sourceProbe.height, bitrate: video.sourceProbe.bitrate };
    attachmentEditorBitrate.value = (width, height) => videoBitrate(source, { width, height });
  } else {
    attachmentEditorBitrate.value = undefined;
  }
  showAttachmentDialog.value = false;
  attachmentEditorOpen.value = true;
}

/** Takes the editor's source URL out of the editor's hands, for a render that reads it after the editor closed. */
function claimAttachmentEditorSrc(): () => void {
  const src = attachmentEditorSrc.value;
  attachmentEditorSrc.value = "";
  let released = false;
  return () => {
    if (released || !src.startsWith("blob:")) return;
    released = true;
    URL.revokeObjectURL(src);
  };
}

async function onAttachmentEditorDone(result: MediaEditorFinalResult) {
  attachmentEditorFinalizing = true;
  try {
    const index = attachmentEditingIndex;
    const entry = index >= 0 ? attachments.pendingFiles.value[index] : undefined;
    if (result && entry) {
      if (result.isVideo && entry.video && result.videoEdit) {
        const decision = videoEditDecision(result.editingMediaState, result.videoEdit, entry.video.sourceProbe.durationMs);
        metrics.count("video.edit", { path: decision.path, reason: decision.path === "render" ? decision.reason : undefined });
        if (decision.path === "convert") {
          // Trim, crop, turns, mirror, sound, quality: the converter applies them to the source; nothing is rendered.
          result.cancel?.();
          attachments.applyVideoEdit(index, decision.prefs, { still: result.preview, editorState: result.editingMediaState });
        } else {
          const releaseSrc = claimAttachmentEditorSrc();
          attachments.renderVideoEdit(
            index,
            {
              getResult: async () => {
                try {
                  return await result.getResult();
                } finally {
                  releaseSrc();
                }
              },
              cancel: () => {
                result.cancel?.();
                releaseSrc();
              },
              creationProgress: result.creationProgress,
              preview: result.preview,
            },
            { editorState: result.editingMediaState },
          );
        }
      } else if (result.isVideo) {
        // A video sent as a plain attachment: the editor's render takes the file's place.
        const payload = await result.getResult();
        const file = new File([payload.blob], mp4Name(entry.file.name), { type: "video/mp4" });
        onReplaceFile(index, file, stillUrl(result.preview), { width: result.width, height: result.height });
      } else {
        const payload = await result.getResult();
        const file = new File([payload.blob], entry.file.name || "edited.png", { type: "image/png" });
        onReplaceFile(index, file, URL.createObjectURL(payload.blob), { width: result.width, height: result.height });
      }
    }
    attachmentEditingIndex = -1;
    showAttachmentDialog.value = true;
  } finally {
    attachmentEditorFinalizing = false;
    releaseAttachmentEditorSrc();
    attachmentEditorState.value = undefined;
    attachmentEditorBlob.value = undefined;
    attachmentEditorBitrate.value = undefined;
  }
}

// --- Send handler ---

const handleSend = async (captionContent?: { text: string; entities: IMessageEntity[] }) => {
  if (props.editing && !captionContent) {
    await submitEdit(props.editing);
    return;
  }
  if (!canSendMessages.value) return;
  const resolvedChannelId = resolveTargetId();
  if (!resolvedChannelId) {
    logger.warn("selected text channel is not defined");
    return;
  }

  // Handle slash command invocation
  if (selectedSlashCommand.value && props.spaceId && messageText.value.startsWith("/")) {
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

  // The card for the first link, unless dismissed. What the composer already fetched rides along
  // so the optimistic message shows it at once; the server fills (or drops) it for everyone.
  const previewStub = captionContent ? null : linkPreview.takeStub(plainText);
  if (previewStub) entities.push(previewStub);

  if (entities.length === 0 && plainText.length === 0 && !hasAttachments) return;

  // Step 3: Crypto-grade random ID — no collisions even at rapid sends
  // Mask top bit: server expects signed Int64 (max 2^63-1)
  const randomId = crypto.getRandomValues(new BigUint64Array(1))[0] & 0x7FFFFFFFFFFFFFFFn;
  const channelId = resolvedChannelId;
  const spaceId = optimisticSpaceId();
  const replyTo = props.replyTo?.messageId ?? null;

  // Build optimistic attachment entities (with placeholder fileId + real thumbHash)
  const optimisticAttachEntities = hasAttachments
    ? attachments.buildOptimisticEntities()
    : [];

  // Detach files from composable BEFORE creating optimistic message
  // This gives us a standalone uploader snapshot and frees the composable for new files
  const detachedUploader = hasAttachments ? attachments.detach() : null;
  // Until its files are up the message is not on its way: it neither times out nor is it what an
  // echo of one of our messages stands for. A video can take minutes to compress and upload.
  if (detachedUploader) markSendUploading(randomId);

  // Create optimistic message — appears in chat immediately
  const optimisticMsg = {
    messageId: randomId,
    replyId: replyTo,
    channelId,
    spaceId,
    text: plainText,
    entities: [...entities, ...optimisticAttachEntities],
    timeSent: IonDateTime.now(),
    sender: me.me!.userId,
  } as ArgonMessage;

  emit("add-optimistic", optimisticMsg, randomId);

  // Clear UI immediately
  void draft.clear();
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
    const kind = detachedUploader?.hasVideo ? "video" : detachedUploader ? "attachments" : "text";
    const sendAttrs = { kind, reply: replyTo !== null };
    const sendTimer = metrics.startTimer("message.send.duration", sendAttrs);
    metrics.distribution("message.text.length", plainText.length, "none", { kind });
    const uploaded = () => {
      markSendUploaded(randomId);
      for (const entity of detachedUploader?.optimisticEntities() ?? []) clearAttachmentSendProgress(entity);
    };
    try {
      let finalEntities = [...entities];

      // Upload attachments if any
      if (detachedUploader) {
        const realAttachEntities = await detachedUploader.uploadAll(uploadTarget(channelId), (entity, phase, fraction) => {
          if (entity) setAttachmentSendProgress(entity, fraction, videoSendStage(phase, fraction));
        });
        uploaded();

        if (detachedUploader.hasErrors()) {
          const failure = detachedUploader.videoFailure();
          // A refusal names the target's limits, asked afresh (a refusal drops the ones known here).
          const limits = failure ? await resolveUploadLimits(api, uploadTarget(channelId)) : null;
          const params = limits ? { limit: formatLimitBytes(limits.videoMaxBytes), duration: formatLimitDuration(limits.videoMaxDurationMs) } : {};
          emit("mark-optimistic-failed", randomId, t(failure ? videoSendErrorKey(failure) : "video_upload_attachments_failed", params));
          detachedUploader.cleanup();
          sendTimer.end({ result: "failed", error: "upload" });
          metrics.count("message.sent", { ...sendAttrs, result: "failed", error: "upload" });
          return;
        }

        finalEntities.push(...realAttachEntities);
      }

      // Send to server
      const sent = await sendToTarget(channelId, plainText, finalEntities, randomId, replyTo);
      if (!sent.ok) {
        const error = refuseSend(randomId, sent.error);
        detachedUploader?.cleanup();
        sendTimer.end({ result: "failed", error });
        metrics.count("message.sent", { ...sendAttrs, result: "failed", error });
        return;
      }

      // Step 1: Resolve optimistic → replace placeholder with real messageId
      emit("resolve-optimistic", randomId, sent.readback);

      // The bubble shows the local poster until the server's copy of the message replaces it.
      detachedUploader?.cleanup(OPTIMISTIC_PREVIEW_HOLD_MS);
      sendTimer.end({ result: "ok" });
      metrics.count("message.sent", { ...sendAttrs, result: "ok" });
    } catch (e: any) {
      logger.error("Failed to send message:", e);
      uploaded();
      emit("mark-optimistic-failed", randomId, e?.message ?? "Send failed");
      detachedUploader?.cleanup();
      sendTimer.end({ result: "failed", error: errorKind(e) });
      metrics.count("message.sent", { ...sendAttrs, result: "failed", error: errorKind(e) });
    }
  })();
};

/** How long the local previews of a sent message outlive the send (the server's copy arrives by then). */
const OPTIMISTIC_PREVIEW_HOLD_MS = 15_000;

/**
 * What a video in the optimistic bubble is doing, in the user's language. The percent is the send's
 * combined progress (compressing and uploading), the same value the ring shows.
 */
function videoSendStage(phase: VideoSendPhase, fraction: number | null): string {
  const percent = Math.round((fraction ?? 0) * 100);
  if (phase === "render") return t("video_send_processing", { percent });
  if (phase === "prepare") return t("video_send_compressing", { percent });
  return t("video_send_uploading", { percent });
}

async function handleExternalFiles(files: FileList) {
  if (!canAttachFiles.value || props.editing) return;
  await stage(attachments.addFiles(files));
}

/** References dropped on the view around the composer: files the server already has. */
async function handleExternalRefs(refs: AttachmentRef[]) {
  if (!canAttachFiles.value || props.editing) return;
  await stage(attachments.addReferences(refs, null, "drag"));
}

defineExpose({
  handleExternalFiles,
  handleExternalRefs,
  getParsedContent: parseMessageContent,
  focus: () => editorRef.value?.focus(),
  clear: () => { messageText.value = ''; mentionRegistry.clear(); },
});
</script>

<style scoped>
.animate-shake {
  animation: shake 0.35s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-3px); }
  30% { transform: translateX(3px); }
  45% { transform: translateX(-2px); }
  60% { transform: translateX(2px); }
  75% { transform: translateX(-1px); }
  90% { transform: translateX(1px); }
}

.hide-scrollbar {
  scrollbar-width: none;
}
.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
