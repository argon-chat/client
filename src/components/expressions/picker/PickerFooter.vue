<script setup lang="ts">
import { computed } from "vue";
import { emojiRegistry, spriteResolver, type SkinTone } from "@argon-chat/emojix";
import StickerView from "@/components/expressions/StickerView.vue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import CustomEmojiOverlay from "@/components/expressions/CustomEmojiOverlay.vue";
import { pickerMedia } from "./pickerMedia";
import { tonedEntry, type PickerCell } from "./pickerModel";

/** The pointed-at (or focused) cell, large, with its name and, for a space's own, "Pack · Space". */
const props = defineProps<{
  cell: PickerCell | null;
  tone: SkinTone;
  detail: string | null;
}>();

const SIZE = 32;

const name = computed(() => {
  const cell = props.cell;
  if (!cell) return "";
  if (cell.type === "unicode") return `:${cell.entry.shortcode}:`;
  return cell.type === "custom" ? `:${cell.item.name}:` : cell.item.name;
});

const sprite = computed(() =>
  props.cell?.type === "unicode"
    ? (spriteResolver.getStyle(tonedEntry(props.cell.entry, props.tone, (text) => emojiRegistry.getByText(text)), SIZE) ?? undefined)
    : undefined,
);
</script>

<template>
  <div class="xp-foot" data-picker-footer>
    <template v-if="cell">
      <span class="xp-foot__art">
        <span v-if="cell.type === 'unicode'" class="xp-foot__sprite" :style="sprite" aria-hidden="true" />
        <CustomEmojiOverlay v-else-if="cell.type === 'custom'" :key="cell.key" tag="span" group="picker">
          <CustomEmojiInline :media="pickerMedia(cell.item)" :size="SIZE" :alt="name" />
        </CustomEmojiOverlay>
        <StickerView v-else :key="cell.key" :media="pickerMedia(cell.item)" :size="SIZE" :autoplay="false" group="picker" />
      </span>
      <span class="xp-foot__text">
        <span class="xp-foot__name" data-footer-name>{{ name }}</span>
        <span v-if="detail" class="xp-foot__detail" data-footer-detail>{{ detail }}</span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.xp-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  flex: none;
  padding: 0 12px;
  border-top: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--muted) / 0.35);
  min-width: 0;
}

.xp-foot__art {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
}

.xp-foot__sprite {
  display: block;
  width: 32px;
  height: 32px;
  background-repeat: no-repeat;
}

.xp-foot__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.xp-foot__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 600;
  color: hsl(var(--foreground));
}

.xp-foot__detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}
</style>
