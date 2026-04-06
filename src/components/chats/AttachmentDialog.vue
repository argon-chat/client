<template>
  <Dialog :open="open" @update:open="(v) => { if (!v) $emit('close') }">
    <DialogContent
      class="max-w-lg p-0 gap-0 attachment-dialog-content"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- Drag overlay -->
      <div v-if="isDragging" class="dialog-drag-overlay">
        <div class="dialog-drag-content">
          <PlusIcon class="w-8 h-8" />
          <span class="text-sm font-medium">{{ t('drop_to_add') || 'Drop to add files' }}</span>
        </div>
      </div>

      <!-- Preview area -->
      <div class="preview-area">
        <!-- Image preview -->
        <div v-if="selectedFile && isImage(selectedFile)" class="image-preview">
          <img :src="selectedFile.previewUrl!" alt="" class="preview-img" />
        </div>
        <!-- File preview -->
        <div v-else-if="selectedFile" class="file-preview">
          <div class="file-preview-icon">
            <FileTextIcon v-if="selectedFile.file.type === 'application/pdf'" class="w-12 h-12" />
            <FileIcon v-else class="w-12 h-12" />
          </div>
          <div class="file-preview-name">{{ selectedFile.file.name }}</div>
          <div class="file-preview-size">{{ formatSize(selectedFile.file.size) }}</div>
        </div>
        <!-- Empty state -->
        <div v-else class="empty-preview">
          <ImageIcon class="w-12 h-12 text-muted-foreground" />
        </div>
      </div>

      <!-- Thumbnails strip -->
      <div v-if="files.length > 1" class="thumb-strip">
        <button
          v-for="(file, i) in files"
          :key="i"
          class="strip-thumb"
          :class="{ active: selectedIndex === i }"
          @click="selectedIndex = i"
        >
          <img v-if="isImage(file)" :src="file.previewUrl!" alt="" class="strip-thumb-img" />
          <FileIcon v-else class="w-4 h-4 text-muted-foreground" />
          <div role="button" class="strip-remove" @click.stop="$emit('remove', i)">
            <XIcon class="w-2.5 h-2.5" />
          </div>
        </button>
        <button class="strip-add" @click="$emit('add-more')">
          <PlusIcon class="w-4 h-4" />
        </button>
      </div>

      <!-- Caption + actions -->
      <div class="dialog-footer">
        <EnterText
          ref="captionInputRef"
          :reply-to="null"
          :space-id="spaceId"
          caption-mode
          @submit="send"
        />
        <div class="footer-actions">
          <span class="file-count text-xs text-muted-foreground">
            {{ files.length }} {{ files.length === 1 ? 'file' : 'files' }}
          </span>
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" @click="$emit('close')">
              {{ t('cancel') || 'Cancel' }}
            </Button>
            <Button size="sm" @click="send">
              <SendHorizonalIcon class="w-4 h-4 mr-1" />
              {{ t('send') || 'Send' }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import { Button } from "@argon/ui/button";
import {
  Dialog,
  DialogContent,
} from "@argon/ui/dialog";
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  XIcon,
  PlusIcon,
  SendHorizonalIcon,
} from "lucide-vue-next";
import type { PendingAttachment } from "@/composables/useAttachmentUpload";
import type { IMessageEntity } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { useLocale } from "@/store/system/localeStore";
import EnterText from "./EnterText.vue";

const { t } = useLocale();

const props = defineProps<{
  files: PendingAttachment[];
  open: boolean;
  spaceId: Guid;
}>();

const emit = defineEmits<{
  (e: "send", text: string, entities: IMessageEntity[]): void;
  (e: "close"): void;
  (e: "add-more"): void;
  (e: "remove", index: number): void;
  (e: "add-files", files: FileList): void;
}>();

const captionInputRef = ref<InstanceType<typeof EnterText> | null>(null);
const selectedIndex = ref(0);
const isDragging = ref(false);

const selectedFile = computed(() => props.files[selectedIndex.value] ?? null);

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function send() {
  const parsed = captionInputRef.value?.getParsedContent();
  const text = parsed?.text ?? "";
  const entities = parsed?.entities ?? [];
  emit("send", text, entities);
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
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-img {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
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
