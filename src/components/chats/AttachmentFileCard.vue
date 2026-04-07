<template>
  <div class="file-card">
    <div class="file-icon">
      <FileTextIcon v-if="isPdf" class="w-5 h-5" />
      <ArchiveIcon v-else-if="isArchive" class="w-5 h-5" />
      <FileIcon v-else class="w-5 h-5" />
    </div>
    <div class="file-info">
      <span class="file-name" :title="fileName">{{ fileName }}</span>
      <span class="file-size">{{ formattedSize }}</span>
    </div>
    <button class="download-btn" @click="download" :disabled="downloading">
      <Loader2Icon v-if="downloading" class="w-4 h-4 animate-spin" />
      <DownloadIcon v-else class="w-4 h-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import {
  FileIcon,
  FileTextIcon,
  ArchiveIcon,
  DownloadIcon,
  Loader2Icon,
} from "lucide-vue-next";
import { cdnUrl } from "@/store/system/fileStorage";

const props = defineProps<{
  fileId: string;
  fileName: string;
  fileSize: bigint | number;
  contentType: string;
}>();

const downloading = ref(false);

const PLACEHOLDER_FILE_ID = "00000000-0000-0000-0000-000000000000";
const isPlaceholder = computed(() => props.fileId === PLACEHOLDER_FILE_ID);

const isPdf = computed(() => props.contentType === "application/pdf");
const isArchive = computed(() =>
  [
    "application/zip",
    "application/x-rar-compressed",
    "application/gzip",
    "application/x-7z-compressed",
    "application/x-tar",
  ].includes(props.contentType),
);

const formattedSize = computed(() => {
  const bytes = Number(props.fileSize);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

async function download() {
  if (isPlaceholder.value) return;
  downloading.value = true;
  try {
    const url = cdnUrl(props.fileId);

    const resp = await fetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = props.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } finally {
    downloading.value = false;
  }
}
</script>

<style scoped>
.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.5);
  max-width: 320px;
}

.file-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}

.download-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
}

.download-btn:hover {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

.download-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
