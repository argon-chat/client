<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { emojiRegistry, spriteResolver, type EmojiEntry, type SkinTone } from "@argon-chat/emojix";
import { useLocale } from "@/store/system/localeStore";
import { emojiWithTone, SKIN_TONES, tonedEntry } from "./pickerModel";

/** The six tones of one emoji, drawn from the atlases, over the cell (or button) that asked for them. */
const props = defineProps<{
  entry: EmojiEntry;
  anchor: HTMLElement;
  tone: SkinTone;
}>();

const emit = defineEmits<{ select: [tone: SkinTone]; close: [] }>();

const { t } = useLocale();

const root = ref<HTMLElement | null>(null);
const position = ref({ left: "0px", top: "0px", visibility: "hidden" as "hidden" | "visible" });

const MARGIN = 8;
const SIZE = 28;

const byText = (text: string) => emojiRegistry.getByText(text);
const spriteOf = (tone: SkinTone) => spriteResolver.getStyle(tonedEntry(props.entry, tone, byText), SIZE) ?? undefined;

function place() {
  const menu = root.value;
  if (!menu) return;
  const target = props.anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const left = Math.min(Math.max(MARGIN, target.left + target.width / 2 - box.width / 2), Math.max(MARGIN, innerWidth - box.width - MARGIN));
  const above = target.top - box.height - MARGIN;
  const top = above >= MARGIN ? above : Math.min(target.bottom + MARGIN, innerHeight - box.height - MARGIN);
  position.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, visibility: "visible" };
}

function onOutside(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    emit("close");
    return;
  }
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const buttons = [...(root.value?.querySelectorAll<HTMLElement>("button") ?? [])];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  const next = buttons[(at + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
  next?.focus();
}

onMounted(async () => {
  await nextTick();
  place();
  root.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  document.addEventListener("pointerdown", onOutside, true);
});

onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutside, true));
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="xp-tones"
      role="menu"
      :aria-label="t('expression_picker_skin_tone')"
      :style="position"
      @keydown="onKeydown"
    >
      <button
        v-for="tone in SKIN_TONES"
        :key="tone"
        type="button"
        role="menuitemradio"
        class="xp-tones__item"
        :class="{ 'is-selected': tone === props.tone }"
        :aria-checked="tone === props.tone ? 'true' : 'false'"
        :data-tone="tone"
        :aria-label="tonedEntry(entry, tone, byText).name"
        @click="emit('select', tone)"
      >
        <span v-if="spriteOf(tone)" class="xp-tones__sprite" :style="spriteOf(tone)" aria-hidden="true" />
        <span v-else class="xp-tones__emoji">{{ emojiWithTone(entry, tone) }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.xp-tones {
  position: fixed;
  z-index: 70;
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius);
  border: 1px solid hsl(var(--border));
  background: hsl(var(--popover));
  color: hsl(var(--popover-foreground));
  box-shadow: 0 8px 24px hsl(var(--background) / 0.5);
}

.xp-tones__item {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--radius) - 2px);
}

.xp-tones__item:hover,
.xp-tones__item:focus-visible {
  background: hsl(var(--accent));
  outline: none;
}

.xp-tones__item.is-selected {
  box-shadow: inset 0 0 0 2px hsl(var(--primary));
}

.xp-tones__sprite {
  display: block;
  width: 28px;
  height: 28px;
  background-repeat: no-repeat;
}

.xp-tones__emoji {
  font-size: 26px;
  line-height: 1;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}
</style>
