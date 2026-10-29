<script lang="ts">
/** QRStyled keeps two codes on the page to cross-fade between them: each takes its own gradient. */
let instances = 0;
</script>

<script setup lang="ts">
/**
 * A QR drawn by qrDrawing.ts, as a template `<svg>` with the logo on top as an `<img>`.
 *
 * QRStyled.vue shows this under vue-native in place of qr-code-styling's canvas. Phase 2 item 8,
 * "QR on sign-in".
 *
 * vue-native paints an inline `<svg>` as a one-colour mask tinted by the element's CSS `color`
 * (crates/vn-tree/src/svg.rs, "svg-multicolor"), so there the gradient below reads as `from`: the
 * style's `color` is that tint. A browser ignores it, because every part has its own fill.
 */
import type { QrDrawing } from "./qrDrawing";

defineProps<{
  drawing: QrDrawing;
  /** The dots run `from` at the centre to `to` at the edge; the finder patterns are `corners`. */
  palette: { from: string; to: string; corners: string };
  /** The logo, over the modules the drawing left out for it. */
  image?: string;
}>();

const gradientId = `vn-qr-dots-${(instances += 1)}`;
</script>

<template>
  <div class="relative" :style="{ width: `${drawing.size}px`, height: `${drawing.size}px` }">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="block"
      :width="drawing.size"
      :height="drawing.size"
      :viewBox="`0 0 ${drawing.size} ${drawing.size}`"
      :style="{ width: `${drawing.size}px`, height: `${drawing.size}px`, color: palette.from }"
    >
      <defs>
        <radialGradient
          :id="gradientId"
          gradientUnits="userSpaceOnUse"
          :cx="drawing.gradient.cx"
          :cy="drawing.gradient.cy"
          :fx="drawing.gradient.cx"
          :fy="drawing.gradient.cy"
          :r="drawing.gradient.r"
        >
          <stop offset="0" :stop-color="palette.from" />
          <stop offset="1" :stop-color="palette.to" />
        </radialGradient>
      </defs>
      <path :d="drawing.dots" :fill="`url(#${gradientId})`" />
      <path :d="drawing.cornerSquares" fill-rule="evenodd" :fill="palette.corners" />
      <path :d="drawing.cornerDots" :fill="palette.corners" />
    </svg>
    <img
      v-if="image && drawing.image"
      :src="image"
      alt=""
      draggable="false"
      class="absolute pointer-events-none select-none"
      :style="{
        left: `${drawing.image.x}px`,
        top: `${drawing.image.y}px`,
        width: `${drawing.image.width}px`,
        height: `${drawing.image.height}px`,
      }"
    />
  </div>
</template>
