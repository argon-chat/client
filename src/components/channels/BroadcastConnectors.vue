<template>
  <svg
    v-if="paths.length > 0"
    class="broadcast-connectors text-muted-foreground"
    aria-hidden="true"
    :style="{ height: `${height}px` }"
    data-testid="broadcast-connectors"
  >
    <path v-for="p in paths" :key="p.from" :d="p.d" :data-from="p.from" />
  </svg>
</template>

<script setup lang="ts">
/**
 * The faint "rope" from a broadcast channel to the channels that hear it.
 *
 * An overlay laid over the channel list's scroll content: a thin vertical line in the gutter
 * left of the rows, from the broadcast channel's row to each visible target row, with a short
 * tick into every row it touches. It is drawn in the content's own coordinates, so it scrolls
 * with the rows; everything that moves a row (a member joining, a group folding, a reorder, a
 * resize) re-measures it. A target that is not rendered — its group is collapsed — has no row
 * to reach and is left out; a broadcast channel with no visible row draws nothing.
 *
 * It never takes the pointer, and it does not animate: rows may slide, the line just follows.
 */
import { onMounted, onUnmounted, ref, watch } from "vue";

export interface BroadcastLink {
  /** The broadcast channel. */
  from: string;
  /** Its targets. */
  to: readonly string[];
}

const props = defineProps<{
  /** The scroll container holding the `.channel-item[data-channel-id]` rows. */
  container: HTMLElement | null;
  links: readonly BroadcastLink[];
  /** Bumped by the parent when the list or the group state changed. */
  revision?: number;
}>();

/** Gutter x of the rope; a second broadcast channel gets its own lane. */
const LANE_X = [3.5, 6.5];
const TICK = 4;

const paths = ref<{ from: string; d: string }[]>([]);
const height = ref(0);

const escape = (id: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"'));

function rowCenter(container: HTMLElement, base: DOMRect, channelId: string): number | null {
  const row = container.querySelector<HTMLElement>(`.channel-item[data-channel-id="${escape(channelId)}"] .channel-inner`);
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  if (rect.height === 0) return null;
  return Math.round(rect.top + rect.height / 2 - base.top + container.scrollTop) + 0.5;
}

function measure() {
  const container = props.container;
  if (!container || props.links.length === 0) {
    paths.value = [];
    return;
  }
  const base = container.getBoundingClientRect();
  const next: { from: string; d: string }[] = [];

  props.links.forEach((link, index) => {
    const hq = rowCenter(container, base, link.from);
    if (hq === null) return;
    const targets = link.to.map((id) => rowCenter(container, base, id)).filter((y): y is number => y !== null);
    if (targets.length === 0) return;

    const x = LANE_X[index % LANE_X.length];
    const ys = [hq, ...targets];
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    let d = `M${x} ${top} V${bottom}`;
    for (const y of ys) d += ` M${x} ${y} h${TICK}`;
    next.push({ from: link.from, d });
  });

  height.value = container.scrollHeight;
  paths.value = next;
}

// One measure per frame, and one more once the list's transitions have settled.
let frame = 0;
let settle: ReturnType<typeof setTimeout> | null = null;
function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    measure();
  });
  if (settle) clearTimeout(settle);
  settle = setTimeout(() => {
    settle = null;
    measure();
  }, 320);
}

let resize: ResizeObserver | null = null;
let mutations: MutationObserver | null = null;
let observed: HTMLElement | null = null;

function observe(container: HTMLElement | null) {
  if (observed) {
    observed.removeEventListener("scroll", schedule);
    resize?.disconnect();
    mutations?.disconnect();
  }
  observed = container;
  if (!container) {
    paths.value = [];
    return;
  }
  container.addEventListener("scroll", schedule, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver(schedule);
    resize.observe(container);
  }
  if (typeof MutationObserver !== "undefined") {
    mutations = new MutationObserver(schedule);
    mutations.observe(container, { childList: true, subtree: true });
  }
  schedule();
}

watch(() => props.container, observe);
watch(() => [props.links, props.revision] as const, schedule, { deep: true });

onMounted(() => observe(props.container));
onUnmounted(() => {
  observe(null);
  if (frame) cancelAnimationFrame(frame);
  if (settle) clearTimeout(settle);
});
</script>

<style scoped>
.broadcast-connectors {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  overflow: visible;
  pointer-events: none;
  fill: none;
  stroke: currentColor;
  stroke-opacity: 0.28;
  stroke-width: 1;
  shape-rendering: crispEdges;
}
</style>
