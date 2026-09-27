<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { UploadCloudIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";

/**
 * Where files for a pack come in: a slim strip to click, the whole area it wraps (the pack's grid)
 * to drop on, or a paste anywhere while the settings are open (not into a text field). Several at
 * once.
 */
const props = defineProps<{
  disabled?: boolean;
  hint: string;
  /** Why it is disabled, shown in place of the prompt. */
  disabledReason?: string | null;
}>();

const emit = defineEmits<{ files: [files: File[]] }>();

const { t } = useLocale();

const ACCEPT = ".png,.webp,.tgs,.json,.webm,image/png,image/webp,video/webm,application/json,application/x-tgsticker";

const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const over = ref(false);
let depth = 0;

function take(list: FileList | File[] | null | undefined) {
  if (props.disabled || !list) return;
  const files = Array.from(list).filter((f) => f.size > 0);
  if (files.length) emit("files", files);
}

const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

function onDragEnter(e: DragEvent) {
  if (props.disabled || !carriesFiles(e)) return;
  depth++;
  over.value = true;
}

function onDragLeave() {
  depth = Math.max(0, depth - 1);
  if (!depth) over.value = false;
}

function onDragOver(e: DragEvent) {
  if (props.disabled || !carriesFiles(e)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = "copy";
  over.value = true;
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  depth = 0;
  over.value = false;
  take(e.dataTransfer?.files);
}

function onChange() {
  take(input.value?.files);
  if (input.value) input.value.value = "";
}

function onPaste(e: ClipboardEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;
  // A dialog over the settings (an item being edited) keeps its pastes; the settings' own drawer does not.
  const dialog = target?.closest("[role='dialog']");
  if (dialog && root.value && !dialog.contains(root.value)) return;
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
    ref="root"
    class="upload-area"
    :class="{ 'upload-area--over': over }"
    data-upload-zone
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <button
      type="button"
      class="upload-strip"
      :class="{ 'upload-strip--over': over }"
      :disabled="disabled"
      data-upload-strip
      @click="input?.click()"
    >
      <UploadCloudIcon class="w-4 h-4 shrink-0" aria-hidden="true" />
      <span class="upload-strip__prompt">{{ disabled && disabledReason ? disabledReason : t("expression_settings_upload_title") }}</span>
      <span class="upload-strip__hint" :title="hint">{{ hint }}</span>
    </button>
    <input ref="input" type="file" class="hidden" multiple :accept="ACCEPT" :disabled="disabled" @change="onChange" />
    <slot />
  </div>
</template>

<style scoped>
.upload-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  border-radius: var(--radius);
  outline: 2px dashed transparent;
  outline-offset: 4px;
  transition: outline-color 0.12s ease;
}

.upload-area--over {
  outline-color: hsl(var(--primary) / 0.6);
}

.upload-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 6px 12px;
  text-align: left;
  color: hsl(var(--muted-foreground));
  border: 1.5px dashed hsl(var(--border));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--muted) / 0.25);
  transition: border-color 0.12s ease, background-color 0.12s ease, color 0.12s ease;
}

.upload-strip:hover:not(:disabled),
.upload-strip--over {
  color: hsl(var(--foreground));
  border-color: hsl(var(--primary) / 0.7);
  background: hsl(var(--primary) / 0.06);
}

.upload-strip:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.upload-strip__prompt {
  flex: none;
  max-width: 100%;
  font-size: 0.8125rem;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.upload-strip__hint {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
}

@media (max-width: 560px) {
  .upload-strip {
    flex-wrap: wrap;
  }

  .upload-strip__hint {
    flex-basis: 100%;
  }
}
</style>
