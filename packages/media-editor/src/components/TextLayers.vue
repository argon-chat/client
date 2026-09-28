<template>
  <div class="absolute inset-0 pointer-events-none z-[4]">
    <div
      v-for="layer in store.mediaState.resizableLayers"
      :key="layer.id"
      class="absolute w-max cursor-move pointer-events-auto select-none min-w-[40px] min-h-[24px] border-2 border-transparent rounded p-1 transition-[border-color] duration-150"
      :class="{ '!border-primary': store.uiState.selectedResizableLayer === layer.id }"
      :style="layerStyle(layer)"
      @pointerdown.stop="(e) => startDrag(layer, e)"
      @dblclick="layer.type === 'text' && startEditing(layer)"
    >
      <!-- Sticker layer -->
      <img
        v-if="layer.type === 'sticker'"
        :src="layer.stickerSrc"
        class="w-full h-full object-contain pointer-events-none select-none"
        draggable="false"
      />
      <!-- Text layer -->
      <template v-else>
        <div
          v-if="editingLayerId !== layer.id"
          class="whitespace-pre pointer-events-none"
          :style="textContentStyle(layer)"
        >{{ layerText(layer.textInfo) }}</div>
        <textarea
          v-else
          ref="editInputRef"
          class="bg-transparent border-none outline-none resize-none w-full min-w-[100px] min-h-[40px] font-[inherit] whitespace-pre-wrap break-words"
          :style="textContentStyle(layer)"
          :value="layerText(layer.textInfo)"
          @input="(e) => updateContent(layer, (e.target as HTMLTextAreaElement).value)"
          @blur="stopEditing"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import type { Gesture } from '../store/editorStore';
import { TEXT_BACKGROUND_PADDING, TEXT_BACKGROUND_RADIUS, TEXT_LINE_HEIGHT, TEXT_OUTLINE_WIDTH } from '../constants';
import { fontInfo, layerText } from '../fonts';
import { contrastingTextColor } from '../color';
import type { EditorLayer, Vec2 } from '../types';

const { store } = useMediaEditorContext();

const editingLayerId = ref<number | null>(null);
const editInputRef = ref<HTMLTextAreaElement[] | null>(null);

function layerStyle(layer: EditorLayer) {
  return {
    left: layer.position[0] + 'px',
    top: layer.position[1] + 'px',
    transform: `translate(-50%, -50%) rotate(${layer.rotation}rad) scale(${layer.scale})`
  };
}

function textContentStyle(layer: EditorLayer) {
  const info = layer.textInfo;
  if (!info) return {};

  const font = fontInfo(info.font);
  const style: Record<string, string> = {
    fontSize: info.size + 'px',
    color: info.color,
    textAlign: info.alignment,
    fontFamily: font.fontFamily,
    fontWeight: String(font.fontWeight),
    lineHeight: String(TEXT_LINE_HEIGHT)
  };

  if (info.style === 'outline') {
    style.color = 'transparent';
    style.webkitTextStroke = `${TEXT_OUTLINE_WIDTH}px ${info.color}`;
    style.paintOrder = 'stroke fill';
    style.textShadow = `0 0 0 transparent`;
  } else if (info.style === 'background') {
    style.backgroundColor = info.color;
    style.color = contrastingTextColor(info.color);
    style.padding = `${TEXT_BACKGROUND_PADDING[1]}px ${TEXT_BACKGROUND_PADDING[0]}px`;
    style.borderRadius = `${TEXT_BACKGROUND_RADIUS}px`;
  }

  return style;
}

const layerIndex = (id: number) => store.mediaState.resizableLayers.findIndex((l) => l.id === id);

function startDrag(layer: EditorLayer, e: PointerEvent) {
  if (editingLayerId.value === layer.id) return;

  store.uiState.selectedResizableLayer = layer.id;
  const startX = e.clientX;
  const startY = e.clientY;
  const initPos = [...layer.position] as Vec2;
  const detach = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  // The move is one history entry (nothing when the layer was only clicked); Esc puts it back.
  const gesture = store.beginGesture({ track: [['resizableLayers', layerIndex(layer.id), 'position']], onCancel: detach });

  function onMove(ev: PointerEvent) {
    layer.position = [
      initPos[0] + ev.clientX - startX,
      initPos[1] + ev.clientY - startY
    ];
  }

  function onUp() {
    detach();
    gesture.end();
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// Typing is one history entry, from opening the text to leaving it; Esc takes the typing back.
let editing: Gesture | null = null;

function startEditing(layer: EditorLayer) {
  editingLayerId.value = layer.id;
  store.uiState.selectedResizableLayer = layer.id;
  editing = store.beginGesture({
    track: [['resizableLayers', layerIndex(layer.id), 'textInfo', 'content']],
    onCancel: () => {
      editing = null;
      editingLayerId.value = null;
    }
  });
  nextTick(() => {
    if (editInputRef.value?.[0]) {
      editInputRef.value[0].focus();
      editInputRef.value[0].select();
    }
  });
}

function updateContent(layer: EditorLayer, content: string) {
  if (layer.textInfo) {
    layer.textInfo.content = content;
  }
}

function stopEditing() {
  editingLayerId.value = null;
  const gesture = editing;
  editing = null;
  gesture?.end();
}
</script>


