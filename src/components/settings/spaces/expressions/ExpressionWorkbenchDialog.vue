<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { ExpressionFormat, type ExpressionKind } from "@argon/glue";
import { MediaEditor, type MediaEditorFinalResult } from "@argon/media-editor";
import { useConfigStore } from "@/store/ui/configStore";
import { maxBytes } from "@/lib/expressions/limits";
import { editedFileName, workbenchModeFor } from "@/lib/expressions/workbench/entry";
import { createBackgroundRemovalClient, type BackgroundRemovalClient } from "@/lib/expressions/workbench/bgRemovalClient";

/**
 * The sticker workbench: the media editor in sticker or emoji mode (by the pack's kind) over one
 * image, with background removal and an outline. Saving hands back a new File, WEBP or PNG at the
 * preset size and under the kind's byte cap.
 */
const props = defineProps<{
  open: boolean;
  file: File | null;
  kind: ExpressionKind;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  done: [file: File];
  cancel: [];
  error: [error: unknown];
}>();

const configStore = useConfigStore();

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit("update:open", v),
});

const src = ref("");
// A fresh editor per session: its mode is fixed when it is created.
const session = ref(0);
const remover = shallowRef<BackgroundRemovalClient | null>(null);
let settled = false;

watch(
  () => [props.open, props.file] as const,
  ([open, file]) => {
    if (open && file) {
      if (src.value) URL.revokeObjectURL(src.value);
      src.value = URL.createObjectURL(file);
      session.value++;
      settled = false;
      remover.value ??= createBackgroundRemovalClient();
    } else if (!open) {
      remover.value?.dispose();
      remover.value = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  remover.value?.dispose();
  if (src.value) URL.revokeObjectURL(src.value);
});

const mode = computed(() => workbenchModeFor(props.kind));
const byteCap = computed(() => maxBytes(props.kind, ExpressionFormat.Static));

// The editor calls this with its own image; the client is replaced per session.
function removeBackground(...args: Parameters<BackgroundRemovalClient["remove"]>) {
  if (!remover.value) return Promise.reject(new Error("The workbench is closed"));
  return remover.value.remove(...args);
}

async function onDone(result: MediaEditorFinalResult) {
  if (!result || !props.file) return;
  settled = true;
  try {
    const { blob } = await result.getResult();
    emit("done", new File([blob], editedFileName(props.file.name, blob.type), { type: blob.type }));
  } catch (e) {
    emit("error", e);
  }
}

function onCancel() {
  if (settled) return;
  settled = true;
  emit("cancel");
}
</script>

<template>
  <MediaEditor
    v-if="src"
    :key="session"
    v-model="isOpen"
    :src="src"
    media-type="image"
    :mode="mode"
    :dev-mode="configStore.devModeEnabled"
    :background-remover="removeBackground"
    export-format="auto"
    :max-bytes="byteCap"
    @done="onDone"
    @cancel="onCancel"
    @error="emit('error', $event)"
  />
</template>
