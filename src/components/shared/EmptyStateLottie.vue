<!--
  The native half of EmptyStateArt.vue: the same artwork, played as Lottie.

  vue-native draws an inline <svg> as one picture and runs no CSS animation inside it, so the SVGs
  stand still there. scripts/empty-states-lottie.ts converts each one into a Lottie file, which
  <lottie> plays on its worker thread. The palette still comes from the theme: the --es-… tokens are
  read off EmptyStateArt's .es-art wrapper and written into the file (lib/emptyStateLottie.ts), and
  a theme, accent or contrast change writes them again.

  Reduced motion holds the frame where the intro has finished; a window nobody is looking at, or
  power saving, pauses it where it is.
-->
<template>
  <div ref="host" class="es-lottie">
    <lottie
      v-if="src"
      class="es-lottie__player"
      :src="src"
      :autoplay="playing"
      loop
      :segment="reduceMotion || !played ? `${still},${still}` : undefined"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import { decorativeMotionPaused } from "@/lib/decorativeMotion";
import { emptyStateStillFrame, parseCssColor, substituteVars, themeEmptyState, type RGBA } from "@/lib/emptyStateLottie";
import type { EmptyStateArtName } from "./EmptyStateArt.vue";

const props = defineProps<{ name: EmptyStateArtName }>();

// Relative: vue-native's builder does not resolve an alias in a glob.
const FILES = import.meta.glob<string>("../../styles/empty-states/lottie/*.json", { query: "?raw", import: "default" });

const host = ref<HTMLElement | null>(null);
const src = ref<string | null>(null);
const still = ref(0);
/** The file as generated, markers and all. */
const doc = shallowRef<Record<string, unknown> | null>(null);

const playing = computed(() => !reduceMotion.value && !decorativeMotionPaused.value);
// Frame 0 is before the intro, where most of the artwork is not drawn yet. Until the animation
// has played once, a paused one (the window was in the background when it loaded) holds the
// frame after the intro instead, and starts from there.
const played = ref(playing.value);
watch(playing, (now) => {
  if (now) played.value = true;
});

/** The tokens' values, through the var()s they are written with (`hsl(var(--primary))`). */
function tokens(el: HTMLElement) {
  const style = getComputedStyle(el);
  const read = (name: string) => style.getPropertyValue(name);
  return (token: string) => substituteVars(read(`--${token}`), read);
}

/** What a palette change is told apart by: the tokens that follow the theme. */
const THEMED = ["es-accent", "es-accent-deep", "es-surface", "es-surface-2", "es-line", "es-line-strong", "es-paper", "es-paper-dim"];

let url: string | null = null;
let palette = "";

function render() {
  const el = host.value;
  const source = doc.value;
  if (!el || !source) return;
  const value = tokens(el);
  palette = THEMED.map(value).join("|");
  const cache = new Map<string, RGBA | null>();
  const color = (token: string) => {
    if (!cache.has(token)) {
      const raw = value(token);
      cache.set(token, raw ? parseCssColor(raw) : null);
    }
    return cache.get(token)!;
  };
  const json = JSON.stringify(themeEmptyState(source, color));
  const previous = url;
  url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  src.value = url;
  if (previous) URL.revokeObjectURL(previous);
}

async function load(name: EmptyStateArtName) {
  const file = Object.entries(FILES).find(([path]) => path.endsWith(`/${name}.json`))?.[1];
  if (!file) return;
  const parsed = JSON.parse(await file()) as Record<string, unknown>;
  if (name !== props.name) return;
  still.value = emptyStateStillFrame(parsed);
  doc.value = parsed;
  render();
}

watch(() => props.name, load);

// Theme, accent and contrast land on <html> as classes and inline custom properties. The palette is
// read again on the frame after, once the cascade has them, and the file rewritten if it moved.
let observer: MutationObserver | null = null;
let pending = 0;

onMounted(() => {
  void load(props.name);
  observer = new MutationObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const el = host.value;
      if (el && THEMED.map(tokens(el)).join("|") !== palette) render();
    });
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
});

onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(pending);
  if (url) URL.revokeObjectURL(url);
  url = null;
});
</script>

<style scoped>
.es-lottie,
.es-lottie__player {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
