<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import type { ExpressionItem } from "@argon/glue";
import StickerView from "@/components/expressions/StickerView.vue";
import { toMedia } from "@/store/data/expressionsStore";
import { EXPRESSION_SIZES } from "@/lib/expressions/sizes";
import { getLottiePool } from "@/lib/expressions/lottie/LottiePool";

/**
 * A sticker shown large (360 px, looping) over everything, while it is held or hovered in the picker.
 * While it is up only the preview plays; whatever was the only playable group before comes back after.
 */
const props = withDefaults(defineProps<{ item: ExpressionItem | null; group?: string }>(), { group: "preview" });

const media = computed(() => (props.item ? toMedia(props.item) : null));
const size = computed(() =>
  Math.max(120, Math.min(EXPRESSION_SIZES.preview, Math.floor(Math.min(innerWidth, innerHeight) * 0.7))),
);

let previous: string | null | undefined;

function hold() {
  if (previous !== undefined) return;
  const pool = getLottiePool();
  previous = pool.intersector.onlyPlayableGroup;
  pool.setOnlyPlayableGroup(props.group);
}

function restore() {
  if (previous === undefined) return;
  getLottiePool().setOnlyPlayableGroup(previous);
  previous = undefined;
}

watch(
  () => !!props.item,
  (open) => (open ? hold() : restore()),
  { immediate: true },
);

onBeforeUnmount(restore);
</script>

<template>
  <Teleport to="body">
    <Transition name="xp-preview">
      <div v-if="item && media" class="xp-preview" data-sticker-preview aria-hidden="true">
        <div class="xp-preview__card">
          <StickerView :key="item.itemId" :media="media" :size="size" :loop="true" :autoplay="true" :group="group" />
          <div v-if="item.emoji.length" class="xp-preview__emoji">{{ item.emoji.join(" ") }}</div>
          <div class="xp-preview__name">{{ item.name }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.xp-preview {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: hsl(var(--background) / 0.55);
  backdrop-filter: blur(6px);
}

.xp-preview__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.xp-preview__emoji {
  font-size: 1.5rem;
  line-height: 1;
}

.xp-preview__name {
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
}

.xp-preview-enter-active,
.xp-preview-leave-active {
  transition: opacity 0.15s ease;
}

.xp-preview-enter-active .xp-preview__card,
.xp-preview-leave-active .xp-preview__card {
  transition: transform 0.15s ease;
}

.xp-preview-enter-from,
.xp-preview-leave-to {
  opacity: 0;
}

.xp-preview-enter-from .xp-preview__card,
.xp-preview-leave-to .xp-preview__card {
  transform: scale(0.9);
}

@media (prefers-reduced-motion: reduce) {
  .xp-preview-enter-active,
  .xp-preview-leave-active,
  .xp-preview-enter-active .xp-preview__card,
  .xp-preview-leave-active .xp-preview__card {
    transition: none;
  }
}
</style>
