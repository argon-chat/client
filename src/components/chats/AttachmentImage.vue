<template>
  <div
    class="attachment-image"
    :style="containerStyle"
  >
    <!-- ThumbHash placeholder -->
    <canvas
      v-if="thumbHash && !loaded"
      ref="placeholderCanvas"
      class="placeholder"
    />

    <!-- Actual image -->
    <img
      v-if="imageSrc"
      :src="imageSrc"
      :alt="fileName"
      class="actual-image"
      :class="{ visible: loaded }"
      @load="loaded = true"
    />

    <!-- Loading spinner -->
    <div v-if="!imageSrc && !thumbHash" class="loading-spinner">
      <Loader2Icon class="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed } from "vue";
import { Loader2Icon } from "lucide-vue-next";
import { thumbHashToRGBA } from "thumbhash";
import { useFileStorage } from "@/store/system/fileStorage";

const props = defineProps<{
  fileId: string;
  fileName: string;
  width: number | null;
  height: number | null;
  thumbHash: string | null;
}>();

const fileStorage = useFileStorage();
const placeholderCanvas = ref<HTMLCanvasElement | null>(null);
const imageSrc = ref<string | null>(null);
const loaded = ref(false);

const aspectRatio = computed(() => {
  if (props.width && props.height) {
    return props.width / props.height;
  }
  return 16 / 9;
});

const containerStyle = computed(() => ({
  aspectRatio: `${aspectRatio.value}`,
}));

function renderThumbHash() {
  if (!props.thumbHash || !placeholderCanvas.value) return;

  try {
    const hashBytes = Uint8Array.from(atob(props.thumbHash), (c) =>
      c.charCodeAt(0),
    );
    const { w, h, rgba } = thumbHashToRGBA(hashBytes);

    const canvas = placeholderCanvas.value;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageData = new ImageData(new Uint8ClampedArray(rgba), w, h);
    ctx.putImageData(imageData, 0, 0);
  } catch {
    // Invalid thumbhash — ignore
  }
}

const PLACEHOLDER_FILE_ID = "00000000-0000-0000-0000-000000000000";

const isPlaceholder = computed(() => props.fileId === PLACEHOLDER_FILE_ID);

onMounted(async () => {
  await nextTick();
  renderThumbHash();

  // Don't fetch from CDN for optimistic placeholder attachments
  if (isPlaceholder.value) return;

  // Fetch the actual image
  const url = await fileStorage.fetchAttachmentByFileId(props.fileId);
  if (url && url !== fileStorage.FAILED_ADDRESS) {
    imageSrc.value = url;
  }
});

watch(
  () => props.thumbHash,
  async () => {
    await nextTick();
    renderThumbHash();
  },
);
</script>

<style scoped>
.attachment-image {
  position: relative;
  overflow: hidden;
  background: hsl(var(--muted));
  min-height: 60px;
}

.placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(16px);
  transform: scale(1.1);
}

.actual-image {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.actual-image.visible {
  opacity: 1;
}

.loading-spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
