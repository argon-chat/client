<script setup lang="ts">
import { computed } from "vue";
import StickerView from "./StickerView.vue";
import EmojiText from "@/components/chats/EmojiText";
import { animationsEnabled } from "@/lib/expressions/settings";
import { statusIconView, type StatusIconSource } from "@/lib/statusIcon";

/**
 * A custom status's icon, drawn before its text: the custom emoji the profile carries, or a unicode
 * emoji from the sprite atlas as in messages. Nothing when the status has no icon.
 *
 * In a list (`animateOn: "hover"`) a custom emoji holds its first frame and plays only while its row
 * is `hovered`; a single one (a profile card) plays whenever animations are on.
 */
const props = withDefaults(
  defineProps<{
    profile: StatusIconSource | null | undefined;
    /** CSS px. */
    size?: number;
    animateOn?: "always" | "hover";
    /** The row's hover or focus, which the row tracks: plays under `animateOn: "hover"`. */
    hovered?: boolean;
  }>(),
  { size: 16, animateOn: "hover", hovered: false },
);

const view = computed(() => statusIconView(props.profile));
const alt = computed(() => (view.value?.type === "custom" ? `:${view.value.name}:` : undefined));
const box = computed(() => ({ "--emoji-size": `${props.size}px`, width: `${props.size}px`, height: `${props.size}px` }));
const autoplay = computed(() => animationsEnabled.value && (props.animateOn === "always" || props.hovered));
</script>

<template>
  <StickerView
    v-if="view?.type === 'custom'"
    class="status-emoji"
    :media="view.media"
    :size="size"
    :autoplay="autoplay"
    loop
    group="status"
    role="img"
    :aria-label="alt"
    :title="alt"
    data-status-emoji="custom"
  />
  <span v-else-if="view?.type === 'unicode'" class="status-emoji status-emoji--unicode" :style="box" data-status-emoji="unicode">
    <EmojiText :text="view.text" />
  </span>
</template>

<style scoped>
.status-emoji {
  flex: none;
}

/* A flex box, so the sprite's text-baseline offset (.msg-emoji) does not add to the line. */
.status-emoji--unicode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--emoji-size) * 0.85);
  font-style: normal;
  line-height: 1;
  overflow: hidden;
}
</style>
