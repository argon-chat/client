<template>
  <Dialog :open="open" @update:open="(v) => { if (!v) $emit('close') }">
    <DialogContent
      class="max-w-lg p-0 gap-0 attachment-dialog-content"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- Named for screen readers only: this dialog draws no heading of its own. -->
      <VisuallyHidden>
        <DialogTitle>{{ t("attachments") }}</DialogTitle>
      </VisuallyHidden>
      <!-- Drag overlay -->
      <div v-if="isDragging" class="dialog-drag-overlay">
        <div class="dialog-drag-content">
          <PlusIcon class="w-8 h-8" />
          <span class="text-sm font-medium">{{ t('drop_to_add') }}</span>
        </div>
      </div>

      <!-- Preview area -->
      <div class="preview-area">
        <!-- Image preview -->
        <div v-if="selectedFile && isImage(selectedFile)" class="image-preview">
          <img :src="selectedFile.previewUrl!" alt="" class="preview-img" />
          <!-- Edit button -->
          <button class="edit-btn icon-motion icon-motion--pop" @click="openEditor" :title="t('edit')">
            <PencilIcon class="w-4 h-4" />
          </button>
        </div>
        <!-- Video preview -->
        <div v-else-if="selectedFile && isVideo(selectedFile)" class="image-preview" data-testid="attachment-video-preview">
          <img v-if="selectedFile.previewUrl" :src="selectedFile.previewUrl" alt="" class="preview-img" />
          <FilmIcon v-else class="w-12 h-12 text-muted-foreground" />

          <span v-if="selectedVideo" class="video-chip video-chip--duration" data-testid="video-duration">{{ durationText }}</span>

          <div class="video-play-badge">
            <PlayIcon class="w-5 h-5 fill-current" />
          </div>

          <!-- Edit button -->
          <button
            class="edit-btn icon-motion icon-motion--pop"
            :class="{ 'edit-btn--blocked': !!editBlockText }"
            :disabled="!!editBlockText"
            :aria-disabled="!!editBlockText"
            :title="editBlockText || t('edit')"
            data-testid="video-edit"
            @click="openEditor"
          >
            <PencilIcon class="w-4 h-4" />
          </button>
        </div>
        <!-- File preview -->
        <div v-else-if="selectedFile" class="file-preview">
          <div class="file-preview-icon">
            <FileTextIcon v-if="selectedFile.file.type === 'application/pdf'" class="w-12 h-12 icon-appear" />
            <FileIcon v-else class="w-12 h-12 icon-appear" />
          </div>
          <div class="file-preview-name">{{ selectedFile.file.name }}</div>
          <div class="file-preview-size">{{ formatSize(selectedFile.file.size) }}</div>
        </div>
        <!-- Empty state -->
        <div v-else class="empty-preview">
          <ImageIcon class="w-12 h-12 text-muted-foreground" />
        </div>
      </div>

      <!-- How the selected video is sent -->
      <div v-if="selectedVideo" class="video-options" data-testid="video-options">
        <Select :model-value="qualityValue" :disabled="!!selectedVideo.fileReason || selectedVideo.prefs.sendAsFile" @update:model-value="onQuality">
          <SelectTrigger size="sm" class="video-quality" :aria-label="t('video_send_quality')" data-testid="video-quality">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="option in qualityOptions" :key="option.value" :value="option.value" :data-testid="`video-quality-${option.value}`">
                {{ option.label }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <button
          v-if="selectedVideo.probe.hasAudio"
          type="button"
          class="video-toggle"
          :class="{ active: selectedVideo.prefs.mute }"
          :aria-pressed="selectedVideo.prefs.mute"
          :disabled="selectedVideo.prefs.sendAsFile"
          data-testid="video-mute"
          @click="$emit('video-prefs', selectedIndex, { mute: !selectedVideo.prefs.mute })"
        >
          <VolumeXIcon v-if="selectedVideo.prefs.mute" class="w-4 h-4" />
          <Volume2Icon v-else class="w-4 h-4" />
          {{ t('video_send_mute') }}
        </button>

        <button
          type="button"
          class="video-toggle"
          :class="{ active: selectedVideo.prefs.sendAsFile }"
          :aria-pressed="selectedVideo.prefs.sendAsFile"
          :disabled="!!selectedVideo.fileReason"
          data-testid="video-send-as-file"
          @click="$emit('video-prefs', selectedIndex, { sendAsFile: !selectedVideo.prefs.sendAsFile })"
        >
          <FileIcon class="w-4 h-4" />
          {{ t('video_send_as_file') }}
        </button>

        <span class="video-size" data-testid="video-size">{{ sizeText }}</span>
      </div>
      <p v-if="selectedVideo && reasonText" class="video-reason" data-testid="video-reason">{{ reasonText }}</p>

      <!-- Thumbnails strip -->
      <div v-if="files.length > 1" class="thumb-strip">
        <button
          v-for="(file, i) in files"
          :key="i"
          class="strip-thumb"
          :class="{ active: selectedIndex === i }"
          @click="selectedIndex = i"
        >
          <img v-if="(isImage(file) || isVideo(file)) && file.previewUrl" :src="file.previewUrl" alt="" class="strip-thumb-img" />
          <FilmIcon v-else-if="isVideo(file)" class="w-4 h-4 text-muted-foreground" />
          <FileIcon v-else class="w-4 h-4 text-muted-foreground" />
          <div role="button" class="strip-remove" @click.stop="$emit('remove', i)">
            <XIcon class="w-2.5 h-2.5" />
          </div>
        </button>
        <button class="strip-add icon-motion icon-motion--pop" @click="$emit('add-more')">
          <PlusIcon class="w-4 h-4" />
        </button>
      </div>

      <!-- Caption + actions -->
      <div class="dialog-footer">
        <EnterText
          ref="captionInputRef"
          :reply-to="null"
          :space-id="spaceId"
          :receiver-id="receiverId"
          caption-mode
          @submit="send"
        />
        <div class="footer-actions">
          <span class="file-count text-xs text-muted-foreground">
            {{ files.length }} {{ files.length === 1 ? 'file' : 'files' }}
          </span>
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" @click="$emit('close')">
              {{ t('cancel') }}
            </Button>
            <Button size="sm" @click="send">
              <SendHorizonalIcon class="w-4 h-4 mr-1" />
              {{ t('send') }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, shallowRef } from "vue";
import { Button } from "@argon/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@argon/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@argon/ui/select";
import { VisuallyHidden } from "@argon/ui/visually-hidden";
import {
  FileIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  XIcon,
  PlusIcon,
  SendHorizonalIcon,
  PencilIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-vue-next";
import { checkCapabilities, videoEditBlock, type PlatformCapabilities } from "@argon/media-editor";
import type { PendingAttachment, PendingVideo, PendingVideoPrefs } from "@/composables/useAttachmentUpload";
import { estimateOutputBytes, VIDEO_LADDER, type VideoQuality } from "@/lib/video/plan";
import { DEFAULT_UPLOAD_LIMITS, formatLimitBytes, formatLimitDuration } from "@/lib/attachments/uploadLimits";
import type { IMessageEntity } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/system/localeStore";
import EnterText from "./EnterText.vue";

const { t } = useLocale();

const props = defineProps<{
  files: PendingAttachment[];
  open: boolean;
  /** The space of a channel composer; absent in a direct chat. */
  spaceId?: Guid;
  /** The peer of a direct chat, so the caption composer knows it needs no permissions. */
  receiverId?: Guid;
}>();

const emit = defineEmits<{
  (e: "send", text: string, entities: IMessageEntity[]): void;
  (e: "close"): void;
  (e: "add-more"): void;
  (e: "remove", index: number): void;
  (e: "add-files", files: FileList): void;
  (e: "replace-file", index: number, file: File, previewUrl: string): void;
  (e: "open-editor", index: number, src: string, mediaType: "image" | "video"): void;
  (e: "video-prefs", index: number, patch: Partial<Pick<PendingVideoPrefs, "quality" | "mute" | "sendAsFile">>): void;
}>();

const captionInputRef = ref<InstanceType<typeof EnterText> | null>(null);
const selectedIndex = ref(0);
const isDragging = ref(false);

const selectedFile = computed(() => props.files[selectedIndex.value] ?? null);
/** The selected file's video state (a video the probe could read); nothing is compressed before Send. */
const selectedVideo = computed<PendingVideo | null>(() => selectedFile.value?.video ?? null);

watch(() => props.open, (v) => {
  if (v) {
    selectedIndex.value = 0;
    nextTick(() => {
      captionInputRef.value?.clear();
      captionInputRef.value?.focus();
    });
  }
});

watch(() => props.files.length, (len) => {
  if (selectedIndex.value >= len) {
    selectedIndex.value = Math.max(0, len - 1);
  }
});

function isImage(file: PendingAttachment): boolean {
  return file.file.type.startsWith("image/") && !!file.previewUrl;
}

function isVideo(file: PendingAttachment): boolean {
  return !!file.video || (file.file.type.startsWith("video/") && !!file.previewUrl);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// --- Video ---

const durationText = computed(() => {
  const v = selectedVideo.value;
  if (!v) return "";
  return formatDuration(v.plan?.durationMs ?? (v.prefs.trim ? v.prefs.trim.endMs - v.prefs.trim.startMs : v.probe.durationMs));
});

/** Rungs the source reaches (the cropped frame's short side), never above it: nothing is upscaled. */
const qualityOptions = computed(() => {
  const v = selectedVideo.value;
  if (!v) return [];
  const crop = v.prefs.crop;
  const shortSide = crop ? Math.min(crop.width, crop.height) : Math.min(v.probe.width, v.probe.height);
  const rungs = VIDEO_LADDER.filter((rung, i) => rung <= shortSide || i === 0);
  return [
    { value: "auto", label: t("video_send_quality_auto") },
    ...rungs.map((rung) => ({ value: String(rung), label: t("video_send_quality_rung", { height: rung }) })),
    { value: "original", label: t("video_send_quality_original") },
  ];
});

const qualityValue = computed(() => {
  const quality = selectedVideo.value?.prefs.quality ?? "auto";
  const value = String(quality);
  return qualityOptions.value.some((o) => o.value === value) ? value : "auto";
});

function onQuality(value: unknown) {
  const quality: VideoQuality = value === "auto" || value === "original" ? value : (Number(value) as VideoQuality);
  if (String(quality) === qualityValue.value) return;
  emit("video-prefs", selectedIndex.value, { quality });
}

const sizeText = computed(() => {
  const v = selectedVideo.value;
  const file = selectedFile.value;
  if (!v || !file) return "";
  if (v.prefs.sendAsFile && !(v.prefs.trim || v.prefs.crop || v.prefs.rotate || v.prefs.flip)) return formatSize(file.file.size);
  if (v.plan) return t("video_send_estimated_size", { size: formatSize(estimateOutputBytes(v.plan)) });
  return "";
});

const REASON_KEYS: Record<string, string> = {
  "no-encoder": "video_send_reason_no_encoder",
  undecodable: "video_send_reason_undecodable",
  "too-large": "video_send_reason_too_large",
  "user-original": "video_send_reason_original",
  "too-long": "video_send_reason_too_long",
};

const reasonText = computed(() => {
  const v = selectedVideo.value;
  if (!v) return "";
  const limits = v.limits ?? { maxBytes: DEFAULT_UPLOAD_LIMITS.videoMaxBytes, maxDurationMs: DEFAULT_UPLOAD_LIMITS.videoMaxDurationMs };
  const params = { limit: formatLimitBytes(limits.maxBytes), duration: formatLimitDuration(limits.maxDurationMs) };
  if (v.fileReason) return t(REASON_KEYS[v.fileReason] ?? "video_send_reason_too_large", params);
  if (v.error === "invalid-trim") return t("video_send_reason_invalid_trim");
  // Planned a rung lower to fit the target's size limit.
  if (v.plan?.downscaledToFit && !v.prefs.sendAsFile) return t("video_send_downscaled", { height: Math.min(v.plan.width, v.plan.height) });
  return "";
});

// The editor needs WebGPU and an H.264 encoder, and takes videos up to 100 MB.
const capabilities = shallowRef<PlatformCapabilities | null>(null);
onMounted(() => {
  void checkCapabilities().then((caps) => (capabilities.value = caps)).catch(() => {});
});

const EDIT_BLOCK_KEYS = {
  "no-gpu": "video_send_edit_no_gpu",
  "no-encoder": "video_send_edit_no_encoder",
  "too-large": "video_send_edit_too_large",
} as const;

const editBlockText = computed(() => {
  const file = selectedFile.value;
  if (!file || !isVideo(file)) return "";
  const caps = capabilities.value;
  if (!caps) return t("video_send_edit_checking");
  const block = videoEditBlock((file.video?.source ?? file.file).size, caps);
  return block ? t(EDIT_BLOCK_KEYS[block]) : "";
});

function send() {
  const parsed = captionInputRef.value?.getParsedContent();
  const text = parsed?.text ?? "";
  const entities = parsed?.entities ?? [];
  emit("send", text, entities);
}

// --- Media Editor ---
function openEditor() {
  if (!selectedFile.value) return;
  if (isImage(selectedFile.value)) {
    emit("open-editor", selectedIndex.value, selectedFile.value.previewUrl!, "image");
  } else if (isVideo(selectedFile.value)) {
    if (editBlockText.value) return;
    // The editor always works on the file as picked; an earlier edit is reopened from its state.
    const videoSrc = URL.createObjectURL(selectedFile.value.video?.source ?? selectedFile.value.file);
    emit("open-editor", selectedIndex.value, videoSrc, "video");
  }
}

// --- Drag-and-drop ---
function onDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes("Files")) {
    isDragging.value = true;
  }
}

function onDragLeave(e: DragEvent) {
  const el = e.currentTarget as HTMLElement;
  if (!el.contains(e.relatedTarget as Node)) {
    isDragging.value = false;
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  if (e.dataTransfer?.files?.length) {
    emit("add-files", e.dataTransfer.files);
  }
}
</script>

<style scoped>
.attachment-dialog-content {
  overflow: hidden;
  position: relative;
}

.dialog-drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: hsl(var(--primary) / 0.15);
  border: 2px dashed hsl(var(--primary));
  border-radius: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.dialog-drag-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: hsl(var(--primary));
}

.preview-area {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  max-height: 400px;
  background: hsl(var(--muted) / 0.3);
  overflow: hidden;
}

.image-preview {
  width: 100%;
  height: 100%;
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.edit-btn {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: hsl(var(--background) / 0.8);
  border: 1px solid hsl(var(--border));
  color: hsl(var(--foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  backdrop-filter: blur(4px);
}

.image-preview:hover .edit-btn,
.edit-btn:focus-visible {
  opacity: 1;
}

.edit-btn:hover:not(:disabled) {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}

.edit-btn--blocked {
  cursor: not-allowed;
  color: hsl(var(--muted-foreground));
}

.image-preview:hover .edit-btn--blocked {
  opacity: 0.6;
}

.preview-img {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
}

.video-play-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: hsl(var(--background) / 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--foreground));
  pointer-events: none;
  backdrop-filter: blur(4px);
}

/* Telegram's chips over media: white on a dark pill in both themes. */
.video-chip {
  position: absolute;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  background: rgb(0 0 0 / 0.5);
  color: #fff;
  font-size: 12px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.video-chip--duration {
  top: 10px;
  left: 10px;
}

.video-options {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid hsl(var(--border));
  flex-wrap: wrap;
}

.video-quality {
  min-width: 104px;
}

.video-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.video-toggle:hover:not(:disabled) {
  background: hsl(var(--muted));
}

.video-toggle.active {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary));
}

.video-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.video-toggle:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 1px;
}

.video-size {
  margin-left: auto;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  font-variant-numeric: tabular-nums;
}

.video-reason {
  margin: 0;
  padding: 0 12px 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.file-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  color: hsl(var(--muted-foreground));
}

.file-preview-icon {
  color: hsl(var(--primary));
}

.file-preview-name {
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-preview-size {
  font-size: 12px;
}

.empty-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
}

.thumb-strip {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
  border-top: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  scrollbar-width: thin;
}

.strip-thumb {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid transparent;
  background: hsl(var(--muted));
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s;
}

.strip-thumb.active {
  border-color: hsl(var(--primary));
}

.strip-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.strip-remove {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: hsl(var(--background) / 0.85);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
  color: hsl(var(--foreground));
}

.strip-thumb:hover .strip-remove {
  opacity: 1;
}

.strip-add {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  border: 2px dashed hsl(var(--border));
  background: transparent;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: hsl(var(--muted-foreground));
  transition: border-color 0.15s, color 0.15s;
}

.strip-add:hover {
  border-color: hsl(var(--primary));
  color: hsl(var(--primary));
}

.dialog-footer {
  padding: 12px;
  border-top: 1px solid hsl(var(--border));
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.footer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
