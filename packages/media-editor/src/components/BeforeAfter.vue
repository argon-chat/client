<template>
  <div
    v-if="visible"
    class="absolute inset-0 z-[10] cursor-col-resize touch-none"
    @pointerdown.prevent="startDrag"
  >
    <!-- Clip the canvas to show original on the left -->
    <canvas
      ref="originalCanvas"
      class="absolute inset-0"
      :style="{ clipPath: `inset(0 ${100 - position}% 0 0)` }"
    />
    <!-- Divider line -->
    <div
      class="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg pointer-events-none"
      :style="{ left: position + '%' }"
    >
      <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-md">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M5 3L2 8L5 13M11 3L14 8L11 13" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
    <!-- Labels -->
    <div class="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
      {{ t('media_editor_before') }}
    </div>
    <div class="absolute top-3 right-3 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
      {{ t('media_editor_after') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';

const { t } = useI18n();
const { store } = useMediaEditorContext();

const props = defineProps<{ visible: boolean }>();
const originalCanvas = ref<HTMLCanvasElement | null>(null);
const position = ref(50);

let dragging = false;

function startDrag(e: PointerEvent) {
  dragging = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  updatePosition(e);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', stopDrag);
}

function onMove(e: PointerEvent) {
  if (!dragging) return;
  updatePosition(e);
}

function stopDrag() {
  dragging = false;
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', stopDrag);
}

function updatePosition(e: PointerEvent) {
  const el = originalCanvas.value?.parentElement;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * 100;
  position.value = Math.max(0, Math.min(100, x));
}

// Draw original image onto canvas when visible
watch(() => props.visible, (v) => {
  if (v) drawOriginal();
});

function drawOriginal() {
  const canvas = originalCanvas.value;
  const payload = store.uiState.renderingPayload;
  if (!canvas || !payload?.media?.src) return;

  const img = new Image();
  img.onload = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = parent.clientWidth * (window.devicePixelRatio || 1);
    canvas.height = parent.clientHeight * (window.devicePixelRatio || 1);
    canvas.style.width = parent.clientWidth + 'px';
    canvas.style.height = parent.clientHeight + 'px';
    const ctx = canvas.getContext('2d')!;
    // Draw image cover-fit
    const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  };
  img.src = payload.media.src;
}

onBeforeUnmount(stopDrag);
</script>
