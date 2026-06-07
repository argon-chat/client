<template>
  <div ref="rootEl" class="draw-overlay" :class="{ 'draw-overlay--active': drawing }">
    <!-- Canvas is sized/positioned to the video CONTENT rect (letterbox-aware), so
         normalized [0,1] points map 1:1 to canvas pixels. -->
    <canvas
      ref="canvasEl"
      class="draw-overlay__canvas"
      :style="canvasStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerUp"
    ></canvas>

    <!-- Brush palette: only when the local user is allowed to draw on this stream. -->
    <div v-if="canDraw" class="draw-overlay__toolbar">
      <button :class="{ on: tool === 'arrow' }" title="Arrow" @click="tool = 'arrow'">↗</button>
      <button :class="{ on: tool === 'brush' }" title="Brush" @click="tool = 'brush'">✎</button>
      <span class="draw-overlay__sep"></span>
      <button
        v-for="c in palette"
        :key="c"
        class="draw-overlay__swatch"
        :class="{ on: color === c }"
        :style="{ background: c }"
        @click="color = c"
      ></button>
      <span class="draw-overlay__sep"></span>
      <button title="Clear my drawings" @click="clearMine">⌫</button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Drawing surface layered over a participant's screenshare <video>. Renders remote +
 * local strokes (with decay) via the shared StrokeCanvas and, when the local user is an
 * allowed drawer, captures pointer input as normalized stroke packets sent through the
 * drawingSession store (LiveKit + native forward happen there).
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useDrawingSession } from "@/store/features/drawingSessionStore";
import { StrokeCanvas } from "@/lib/screencast-draw/StrokeCanvas";
import { DEFAULT_WIDTH, type DrawPacket, type NormPoint, type StrokeTool } from "@/lib/screencast-draw/types";

const props = withDefaults(
  defineProps<{
    /** Streamer identity whose surface this draws on. */
    targetId: string;
    /** The screenshare <video> element to overlay (for content-rect mapping). */
    video: HTMLVideoElement | null;
    /** object-fit mode the video is displayed with. */
    fit?: "contain" | "cover";
  }>(),
  { fit: "contain" },
);

const draw = useDrawingSession();

const rootEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
let surface: StrokeCanvas | null = null;
let unregister: (() => void) | null = null;

const tool = ref<StrokeTool>("arrow");
const color = ref("#ff3b30");
const palette = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff"];

// Drawing is enabled only when allowed AND the toolbar is toggled on from MediaControls.
const canDraw = computed(() => draw.canIDrawOn(props.targetId) && draw.drawMode);

// ── Content-rect (letterbox) geometry ─────────────────────────────
const contentRect = ref({ left: 0, top: 0, width: 0, height: 0 });

const canvasStyle = computed(() => ({
  left: `${contentRect.value.left}px`,
  top: `${contentRect.value.top}px`,
  width: `${contentRect.value.width}px`,
  height: `${contentRect.value.height}px`,
  pointerEvents: canDraw.value ? ("auto" as const) : ("none" as const),
  cursor: canDraw.value ? ("crosshair" as const) : ("default" as const),
}));

function recomputeRect(): void {
  const root = rootEl.value;
  const v = props.video;
  if (!root) return;
  const boxW = root.clientWidth, boxH = root.clientHeight;
  const vw = v?.videoWidth || 0, vh = v?.videoHeight || 0;

  if (!vw || !vh) {
    contentRect.value = { left: 0, top: 0, width: boxW, height: boxH };
  } else {
    const ar = vw / vh, boxAr = boxW / boxH;
    let cw: number, ch: number;
    const wider = boxAr > ar;
    if (props.fit === "cover" ? !wider : wider) { ch = boxH; cw = boxH * ar; }
    else { cw = boxW; ch = boxW / ar; }
    contentRect.value = { left: (boxW - cw) / 2, top: (boxH - ch) / 2, width: cw, height: ch };
  }
  sizeCanvas();
}

function sizeCanvas(): void {
  if (!surface) return;
  const dpr = window.devicePixelRatio || 1;
  surface.resize(contentRect.value.width * dpr, contentRect.value.height * dpr);
  surface.kick();
}

// ── Pointer → normalized packets ──────────────────────────────────
const drawing = ref(false);
let strokeId: string | null = null;
let pending: NormPoint[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function toNorm(e: PointerEvent): NormPoint {
  const rect = canvasEl.value!.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
  const ny = (e.clientY - rect.top) / Math.max(1, rect.height);
  return [Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny))];
}

function onPointerDown(e: PointerEvent): void {
  if (!canDraw.value) return;
  e.preventDefault();
  canvasEl.value?.setPointerCapture(e.pointerId);
  drawing.value = true;
  strokeId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.round(performance.now())}`;
  const p = toNorm(e);
  pending = [];
  draw.publish(props.targetId, {
    kind: "begin",
    strokeId: strokeId!,
    tool: tool.value,
    color: color.value,
    width: DEFAULT_WIDTH,
    ttlMs: draw.sessionFor(props.targetId)?.defaultTtlMs ?? 6000,
    p: [p],
  });
  if (!flushTimer) flushTimer = setInterval(flush, 50);
}

function onPointerMove(e: PointerEvent): void {
  if (!drawing.value || !strokeId) return;
  pending.push(toNorm(e));
}

function flush(): void {
  if (!drawing.value || !strokeId || pending.length === 0) return;
  const p = pending;
  pending = [];
  draw.publish(props.targetId, { kind: "append", strokeId, p });
}

function onPointerUp(e: PointerEvent): void {
  if (!drawing.value || !strokeId) return;
  drawing.value = false;
  const tail = pending;
  pending = [];
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  draw.publish(props.targetId, { kind: "end", strokeId, p: tail.length ? tail : undefined });
  strokeId = null;
  try { canvasEl.value?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
}

function clearMine(): void {
  draw.clearOwn(props.targetId);
}

// ── Wiring ────────────────────────────────────────────────────────
let ro: ResizeObserver | null = null;

onMounted(() => {
  if (!canvasEl.value) return;
  surface = new StrokeCanvas(canvasEl.value);

  unregister = draw.registerConsumer(props.targetId, (packet: DrawPacket) => {
    if (!surface) return;
    if (surface.ingest(packet)) surface.kick();
  });

  recomputeRect();

  ro = new ResizeObserver(() => recomputeRect());
  if (rootEl.value) ro.observe(rootEl.value);
  props.video?.addEventListener("loadedmetadata", recomputeRect);
  props.video?.addEventListener("resize", recomputeRect);
});

watch(() => props.video, (v, old) => {
  old?.removeEventListener("loadedmetadata", recomputeRect);
  old?.removeEventListener("resize", recomputeRect);
  v?.addEventListener("loadedmetadata", recomputeRect);
  v?.addEventListener("resize", recomputeRect);
  recomputeRect();
});

onUnmounted(() => {
  if (flushTimer) clearInterval(flushTimer);
  ro?.disconnect();
  props.video?.removeEventListener("loadedmetadata", recomputeRect);
  props.video?.removeEventListener("resize", recomputeRect);
  unregister?.();
  surface?.dispose();
  surface = null;
});
</script>

<style scoped>
.draw-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* container is inert; canvas/toolbar opt back in */
  z-index: 5;
}
.draw-overlay__canvas {
  position: absolute;
  display: block;
}
.draw-overlay__toolbar {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-radius: 10px;
  background: rgba(20, 20, 22, 0.72);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}
.draw-overlay__toolbar button {
  min-width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.draw-overlay__toolbar button.on {
  background: rgba(255, 255, 255, 0.22);
}
.draw-overlay__swatch {
  width: 18px;
  height: 18px;
  border-radius: 50% !important;
  border: 2px solid transparent !important;
}
.draw-overlay__swatch.on {
  border-color: #fff !important;
}
.draw-overlay__sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 2px;
}
</style>
