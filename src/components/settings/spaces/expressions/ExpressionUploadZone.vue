<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { UploadCloudIcon, WandSparklesIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";

/**
 * Where files for a pack come in: dropped, chosen, or pasted anywhere while the settings are open
 * (not into a text field). Several at once. "Create from image" picks one picture for the sticker
 * workbench instead.
 */
const props = defineProps<{
  disabled?: boolean;
  hint: string;
  /** Why it is disabled, shown in place of the prompt. */
  disabledReason?: string | null;
  /** Offer "Create from image" (the workbench needs WebGPU). */
  canCreate?: boolean;
}>();

const emit = defineEmits<{ files: [files: File[]]; create: [file: File] }>();

const { t } = useLocale();

const ACCEPT = ".png,.webp,.tgs,.json,.webm,image/png,image/webp,video/webm,application/json,application/x-tgsticker";
const IMAGE_ACCEPT = "image/png,image/webp,image/jpeg,image/gif,image/avif,image/bmp";

const input = ref<HTMLInputElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const over = ref(false);

function onImageChange() {
  const file = imageInput.value?.files?.[0];
  if (imageInput.value) imageInput.value.value = "";
  if (file && file.size > 0 && !props.disabled) emit("create", file);
}

function take(list: FileList | File[] | null | undefined) {
  if (props.disabled || !list) return;
  const files = Array.from(list).filter((f) => f.size > 0);
  if (files.length) emit("files", files);
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  over.value = false;
  take(e.dataTransfer?.files);
}

function onDragOver(e: DragEvent) {
  if (props.disabled || !e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  over.value = true;
}

function onChange() {
  take(input.value?.files);
  if (input.value) input.value.value = "";
}

function onPaste(e: ClipboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;
  const files = Array.from(e.clipboardData?.files ?? []);
  if (!files.length) return;
  e.preventDefault();
  take(files);
}

onMounted(() => document.addEventListener("paste", onPaste));
onBeforeUnmount(() => document.removeEventListener("paste", onPaste));
</script>

<template>
  <div
    class="upload-zone"
    :class="{ 'upload-zone--over': over, 'upload-zone--disabled': disabled }"
    data-upload-zone
    @dragover="onDragOver"
    @dragleave="over = false"
    @drop="onDrop"
  >
    <UploadCloudIcon class="w-6 h-6 text-muted-foreground" aria-hidden="true" />
    <div class="text-sm font-medium">
      {{ disabled && disabledReason ? disabledReason : t("expression_settings_upload_title") }}
    </div>
    <div class="text-xs text-muted-foreground">{{ hint }}</div>
    <div class="flex flex-wrap items-center justify-center gap-2">
      <button type="button" class="upload-zone__choose" :disabled="disabled" @click="input?.click()">
        {{ t("expression_settings_upload_choose") }}
      </button>
      <button
        v-if="canCreate"
        type="button"
        class="upload-zone__choose upload-zone__create"
        :disabled="disabled"
        data-create-from-image
        @click="imageInput?.click()"
      >
        <WandSparklesIcon class="w-3.5 h-3.5" aria-hidden="true" />
        {{ t("expression_workbench_create_from_image") }}
      </button>
    </div>
    <input ref="input" type="file" class="hidden" multiple :accept="ACCEPT" :disabled="disabled" @change="onChange" />
    <input ref="imageInput" type="file" class="hidden" :accept="IMAGE_ACCEPT" :disabled="disabled" @change="onImageChange" />
  </div>
</template>

<style scoped>
.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 16px;
  text-align: center;
  border: 1.5px dashed hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.35);
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.upload-zone--over {
  border-color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.08);
}

.upload-zone--disabled {
  opacity: 0.6;
}

.upload-zone__choose {
  margin-top: 4px;
  padding: 4px 12px;
  font-size: 0.8rem;
  font-weight: 500;
  border-radius: calc(var(--radius) - 2px);
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
}

.upload-zone__choose:hover:not(:disabled) {
  background: hsl(var(--accent));
}

.upload-zone__choose:disabled {
  cursor: not-allowed;
}

.upload-zone__create {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
