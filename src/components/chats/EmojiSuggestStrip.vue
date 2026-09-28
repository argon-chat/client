<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { autoUpdate, flip, offset, shift, useFloating, type VirtualElement } from "@floating-ui/vue";
import { EmojiSprite } from "@argon-chat/emojix";
import type { ExpressionItem } from "@argon/glue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import CustomEmojiOverlay from "@/components/expressions/CustomEmojiOverlay.vue";
import StickerView from "@/components/expressions/StickerView.vue";
import { pickerMedia } from "@/components/expressions/picker/pickerMedia";
import type { Suggestion } from "@/lib/chat/emojiSuggest/rank";
import { useLocale } from "@/store/system/localeStore";

/**
 * The emoji suggestions over the composer, Telegram-style: one row at the caret, the selected cell
 * kept in view. Clicks never take focus from the input.
 */
const props = defineProps<{
  open: boolean;
  items: readonly Suggestion[];
  index: number;
  /** The editor: the strip sits at its caret, or at its top-left when the caret has no box. */
  anchor: HTMLElement | null;
}>();

const emit = defineEmits<{ pick: [index: number]; hover: [index: number] }>();

const { t } = useLocale();

const VISIBLE_CELLS = 7;
const GAP = 2;
const EMOJI_CELL = 36;
const STICKER_CELL = 72;

const floating = ref<HTMLElement | null>(null);
const shown = computed(() => props.open && props.items.length > 0);
const hasStickers = computed(() => props.items.some((s) => s.type === "sticker"));
const maxWidth = computed(() => {
  const cell = hasStickers.value ? STICKER_CELL : EMOJI_CELL;
  return `${VISIBLE_CELLS * cell + (VISIBLE_CELLS - 1) * GAP + 10}px`;
});

function caretRect(): DOMRect {
  const el = props.anchor;
  const box = el?.getBoundingClientRect() ?? new DOMRect();
  const sel = window.getSelection();
  if (el && sel?.rangeCount) {
    const range = sel.getRangeAt(0);
    if (el.contains(range.startContainer)) {
      const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (r && (r.width || r.height)) {
        const x = Math.min(Math.max(r.left, box.left), box.right);
        const top = Math.min(Math.max(r.top, box.top), box.bottom);
        const bottom = Math.min(Math.max(r.bottom, top), box.bottom);
        return new DOMRect(x, top, 0, bottom - top);
      }
    }
  }
  return new DOMRect(box.left, box.top, 0, 0);
}

const reference = computed<VirtualElement | null>(() =>
  props.anchor ? { getBoundingClientRect: caretRect, contextElement: props.anchor } : null,
);

const { floatingStyles, update } = useFloating(reference, floating, {
  placement: "top-start",
  strategy: "fixed",
  middleware: [offset(6), flip(), shift({ padding: 8 })],
  whileElementsMounted: autoUpdate,
});

// Each keystroke moves the caret: the strip follows it.
watch(
  () => [props.items, props.open] as const,
  () => void nextTick(update),
);

function keepInView(i: number) {
  const root = floating.value;
  const cell = root?.querySelectorAll<HTMLElement>("[data-testid=emoji-suggest-item]")[i];
  if (!root || !cell) return;
  const view = root.getBoundingClientRect();
  const box = cell.getBoundingClientRect();
  const pad = 4;
  if (box.left < view.left + pad) root.scrollLeft -= view.left + pad - box.left;
  else if (box.right > view.right - pad) root.scrollLeft += box.right - (view.right - pad);
}

watch(
  () => [props.index, props.items] as const,
  ([i]) => void nextTick(() => (i >= 0 ? keepInView(i) : floating.value?.scrollTo({ left: 0 }))),
);

function onWheel(e: WheelEvent) {
  const root = floating.value;
  if (!root || root.scrollWidth <= root.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  e.preventDefault();
  root.scrollLeft += e.deltaY;
}

const media = (item: ExpressionItem) => pickerMedia(item);
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-100 ease-out"
      leave-active-class="transition duration-100 ease-in"
      enter-from-class="opacity-0 translate-y-1.5"
      leave-to-class="opacity-0 translate-y-1.5"
    >
      <div
        v-if="shown"
        ref="floating"
        role="listbox"
        :aria-label="t('emoji_suggest_label')"
        data-testid="emoji-suggest"
        class="emoji-suggest z-50 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-1"
        :style="[floatingStyles, { maxWidth }]"
        @mousedown.prevent
        @wheel="onWheel"
      >
        <CustomEmojiOverlay tag="div" group="suggest" class="emoji-suggest__row">
          <div
            v-for="(s, i) in items"
            :key="s.key"
            role="option"
            :aria-selected="i === index"
            :title="s.label"
            data-testid="emoji-suggest-item"
            :data-type="s.type"
            :class="[
              'emoji-suggest__cell rounded-md cursor-pointer transition-colors',
              s.type === 'sticker' ? 'emoji-suggest__cell--sticker' : '',
              i === index ? 'bg-primary/15 ring-1 ring-inset ring-primary/50' : 'hover:bg-muted',
            ]"
            @mouseenter="emit('hover', i)"
            @click="emit('pick', i)"
          >
            <EmojiSprite v-if="s.type === 'unicode'" :emoji="s.entry" :size="28" render-mode="atlas" />
            <CustomEmojiInline v-else-if="s.type === 'custom'" :media="media(s.item)" :size="28" :alt="s.label" />
            <StickerView v-else :media="media(s.item)" :size="64" group="suggest" />
          </div>
        </CustomEmojiOverlay>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.emoji-suggest {
  top: 0;
  left: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.emoji-suggest::-webkit-scrollbar {
  display: none;
}

.emoji-suggest__row {
  display: flex;
  gap: 2px;
  width: max-content;
}

.emoji-suggest__cell {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
}

.emoji-suggest__cell--sticker {
  width: 72px;
  height: 72px;
}

.emoji-suggest__cell :deep(.ce) {
  --ce-size: 28px;
}
</style>
