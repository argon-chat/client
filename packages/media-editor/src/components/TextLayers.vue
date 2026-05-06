<template>
  <div class="absolute inset-0 pointer-events-none z-[4]">
    <div
      v-for="layer in store.mediaState.resizableLayers"
      :key="layer.id"
      class="absolute cursor-move pointer-events-auto select-none min-w-[40px] min-h-[24px] border-2 border-transparent rounded p-1 transition-[border-color] duration-150"
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
          class="whitespace-pre-wrap break-words pointer-events-none"
          :style="textContentStyle(layer)"
        >{{ layer.textInfo?.content || 'Text' }}</div>
        <textarea
          v-else
          ref="editInputRef"
          class="bg-transparent border-none outline-none resize-none w-full min-w-[100px] min-h-[40px] font-[inherit] whitespace-pre-wrap break-words"
          :style="textContentStyle(layer)"
          :value="layer.textInfo?.content || 'Text'"
          @input="(e) => updateContent(layer, (e.target as HTMLTextAreaElement).value)"
          @blur="stopEditing"
          @keydown.escape="stopEditing"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { FONT_REGISTRY } from '../constants';
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

  const fontInfo = FONT_REGISTRY[info.font];
  const style: Record<string, string> = {
    fontSize: info.size + 'px',
    color: info.color,
    textAlign: info.alignment,
    fontFamily: fontInfo?.fontFamily ?? 'sans-serif',
    fontWeight: String(fontInfo?.fontWeight ?? 400),
    lineHeight: '1.2'
  };

  if (info.style === 'outline') {
    style.color = 'transparent';
    style.webkitTextStroke = `2px ${info.color}`;
    style.paintOrder = 'stroke fill';
    style.textShadow = `0 0 0 transparent`;
  } else if (info.style === 'background') {
    style.backgroundColor = info.color;
    style.color = contrastingTextColor(info.color);
    style.padding = '4px 8px';
    style.borderRadius = '4px';
  }

  return style;
}

function startDrag(layer: EditorLayer, e: PointerEvent) {
  if (editingLayerId.value === layer.id) return;

  store.uiState.selectedResizableLayer = layer.id;
  const startX = e.clientX;
  const startY = e.clientY;
  const initPos = [...layer.position] as Vec2;

  function onMove(ev: PointerEvent) {
    layer.position = [
      initPos[0] + ev.clientX - startX,
      initPos[1] + ev.clientY - startY
    ];
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function startEditing(layer: EditorLayer) {
  editingLayerId.value = layer.id;
  store.uiState.selectedResizableLayer = layer.id;
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
}
</script>


