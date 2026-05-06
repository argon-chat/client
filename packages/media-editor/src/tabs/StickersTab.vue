<template>
  <div class="p-4">
    <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 px-2">{{ t('media_editor_stickers') }}</div>
    <div class="grid grid-cols-5 gap-2">
      <button
        v-for="sticker in stickers"
        :key="sticker"
        class="aspect-square rounded-lg border border-transparent hover:border-primary/50 hover:bg-accent/30 flex items-center justify-center text-3xl cursor-pointer transition-all"
        @click="addSticker(sticker)"
      >{{ sticker }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';

const { t } = useI18n();
const { store } = useMediaEditorContext();

const stickers = [
  '😀', '😂', '🥰', '😎', '🤩',
  '🔥', '❤️', '💯', '⭐', '✨',
  '🎉', '🎊', '👑', '💎', '🌈',
  '🦋', '🌸', '🍀', '☀️', '🌙',
  '👍', '👎', '✌️', '🤘', '👋',
  '💀', '👻', '🎃', '🤖', '👾',
  '🎵', '🎶', '💬', '💭', '❗',
  '❓', '💢', '💥', '🔴', '🔵',
];

function addSticker(emoji: string) {
  // Create a small canvas with the emoji, convert to data URL
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '96px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 72);
  const src = canvas.toDataURL();

  const id = Date.now();
  store.mediaState.resizableLayers.push({
    id,
    type: 'sticker',
    position: [0.5, 0.5],
    rotation: 0,
    scale: 0.15,
    stickerSrc: src,
  });
  store.uiState.selectedResizableLayer = id;
}
</script>
