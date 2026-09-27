<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FileIcon, RotateCwIcon, TriangleAlertIcon, WandSparklesIcon, XIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import type { UploadRow } from "./useExpressionUploads";

/**
 * A file on its way into the pack, in the pack's grid where the item will be: its local picture
 * under a progress ring while it is checked and sent; a red badge with the reason when it was
 * refused, with retry / edit / remove.
 */
const props = defineProps<{
  row: UploadRow;
  /** The grid's media box, css px. */
  size: number;
  /** "Edit" in the sticker workbench is offered. */
  canEdit: boolean;
}>();

const emit = defineEmits<{ retry: []; remove: []; edit: [] }>();

const { t } = useLocale();

const R = 15;
const CIRCUMFERENCE = 2 * Math.PI * R;

const active = computed(() => props.row.status === "queued" || props.row.status === "checking" || props.row.status === "uploading");
const determinate = computed(() => props.row.status === "uploading");
const percent = computed(() => Math.round(props.row.progress * 100));
const refused = computed(() => !!props.row.error && (props.row.status === "failed" || props.row.status === "pending"));
const waiting = computed(() => props.row.status === "failed" || props.row.status === "pending");
const ringSize = computed(() => Math.min(40, props.size - 4));

const previewBroken = ref(false);
watch(
  () => props.row.preview,
  () => (previewBroken.value = false),
);

const reason = computed(() => (props.row.error ? t(props.row.error.key, props.row.error.params ?? {}) : ""));
const label = computed(() => {
  if (refused.value) return reason.value;
  if (props.row.status === "pending") return t("expression_workbench_pending");
  return props.row.fileName;
});
const statusLabel = computed(() =>
  refused.value ? `${props.row.fileName}: ${reason.value}` : t("expression_settings_upload_progress", { name: props.row.fileName, percent: percent.value }),
);
</script>

<template>
  <li
    class="upload-cell"
    :class="{ 'upload-cell--refused': refused, 'upload-cell--waiting': waiting }"
    :data-upload-row="row.id"
    :data-status="row.status"
    :title="statusLabel"
  >
    <div class="upload-cell__media" :style="{ width: `${size}px`, height: `${size}px` }">
      <img
        v-if="row.preview && !previewBroken"
        class="upload-cell__preview"
        :class="{ 'upload-cell__preview--dim': active }"
        :src="row.preview"
        alt=""
        draggable="false"
        data-upload-preview
        @error="previewBroken = true"
      />
      <FileIcon v-else class="upload-cell__file" aria-hidden="true" />
      <svg
        v-if="active"
        class="progress-ring"
        :class="{ 'progress-ring--spin': !determinate }"
        :style="{ width: `${ringSize}px`, height: `${ringSize}px` }"
        viewBox="0 0 36 36"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="determinate ? percent : undefined"
        :aria-label="statusLabel"
        :data-progress="percent"
      >
        <circle class="progress-ring__track" cx="18" cy="18" :r="R" />
        <circle
          class="progress-ring__fill"
          cx="18"
          cy="18"
          :r="R"
          :stroke-dasharray="CIRCUMFERENCE"
          :stroke-dashoffset="determinate ? CIRCUMFERENCE * (1 - row.progress) : CIRCUMFERENCE * 0.72"
        />
      </svg>
      <span v-if="refused" class="upload-cell__badge" data-refusal :data-refusal-key="row.error?.key">
        <TriangleAlertIcon class="w-3 h-3" aria-hidden="true" />
      </span>
    </div>
    <span class="upload-cell__label" :class="{ 'upload-cell__label--refused': refused }">{{ label }}</span>
    <div v-if="!active || canEdit" class="upload-cell__actions" :class="{ 'upload-cell__actions--shown': waiting }">
      <button v-if="canEdit" type="button" :aria-label="t('expression_workbench_edit')" :title="t('expression_workbench_edit')" data-edit-upload @click="emit('edit')">
        <WandSparklesIcon class="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      <button
        v-if="row.status === 'failed' && row.retryable"
        type="button"
        :aria-label="t('expression_settings_upload_retry')"
        :title="t('expression_settings_upload_retry')"
        data-retry-upload
        @click="emit('retry')"
      >
        <RotateCwIcon class="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      <button
        v-if="row.status !== 'checking' && row.status !== 'uploading'"
        type="button"
        :aria-label="t('expression_workbench_discard')"
        :title="t('expression_workbench_discard')"
        data-discard-upload
        @click="emit('remove')"
      >
        <XIcon class="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  </li>
</template>

<style scoped>
.upload-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 10px 6px 8px;
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.35);
  box-shadow: inset 0 0 0 1px hsl(var(--border) / 0.6);
}

.upload-cell--refused {
  background: hsl(var(--destructive) / 0.08);
  box-shadow: inset 0 0 0 1px hsl(var(--destructive) / 0.55);
}

.upload-cell__media {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.upload-cell__preview {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: opacity 0.2s ease;
}

.upload-cell__preview--dim {
  opacity: 0.45;
}

.upload-cell__file {
  width: 45%;
  height: 45%;
  color: hsl(var(--muted-foreground) / 0.6);
}

.progress-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  translate: -50% -50%;
  rotate: -90deg;
}

.progress-ring--spin {
  animation: progress-ring-spin 0.9s linear infinite;
}

@keyframes progress-ring-spin {
  to {
    rotate: 270deg;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-ring--spin {
    animation-duration: 2.4s;
  }
}

.progress-ring circle {
  fill: none;
  stroke-width: 3.5;
}

.progress-ring__track {
  stroke: hsl(var(--foreground) / 0.12);
}

.progress-ring__fill {
  stroke: hsl(var(--primary));
  stroke-linecap: round;
  transition: stroke-dashoffset 0.15s linear;
}

.upload-cell__badge {
  position: absolute;
  top: -6px;
  right: -8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  color: hsl(var(--destructive-foreground));
  background: hsl(var(--destructive));
  box-shadow: 0 0 0 2px hsl(var(--background));
}

.upload-cell__label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.upload-cell__label--refused {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  font-size: 0.6875rem;
  line-height: 1.25;
  color: hsl(var(--destructive));
}

.upload-cell__actions {
  position: absolute;
  top: 2px;
  left: 2px;
  display: flex;
  gap: 1px;
  padding: 1px;
  border-radius: calc(var(--radius) - 4px);
  background: hsl(var(--background) / 0.85);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.upload-cell:hover .upload-cell__actions,
.upload-cell:focus-within .upload-cell__actions,
.upload-cell__actions--shown {
  opacity: 1;
}

.upload-cell__actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: calc(var(--radius) - 5px);
  color: hsl(var(--muted-foreground));
}

.upload-cell__actions button:hover {
  color: hsl(var(--foreground));
  background: hsl(var(--accent));
}
</style>
