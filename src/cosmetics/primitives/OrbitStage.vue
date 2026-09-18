<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import { cdnUrl } from "@/store/system/fileStorage";
import { drawSatellite, installOrbitKeyframes, stageOf, type DrawnSatellite } from "@/cosmetics/primitives/orbitGeometry";
import type { AvatarOrbitPayload, OrbitSatellite } from "@/cosmetics/kinds/avatar-orbit";
import type { ResolvedCosmetic } from "@/cosmetics/types";

/**
 * Figures travelling a ring around a face, hidden by it as they pass behind.
 *
 * <b>It is four nested boxes per drawing and no JavaScript once mounted.</b> Where a figure is, how
 * big it is at that moment, how much light it has lost and which way it is facing are all one
 * sampled keyframe track multiplying numbers the row carries — so this costs a member list a handful
 * of style objects rather than an animation frame per face.
 *
 * The four boxes are four things that move independently and cannot share a transform: the circuit,
 * the rise and fall on its own period, the turn, and the strip of drawings. Collapsing any two of
 * them means one of them wins and the other silently stops.
 */
const props = defineProps<{
  item: ResolvedCosmetic;

  /**
   * Draw the figure where it stands rather than sending it round.
   *
   * <b>For a place that is a list rather than a face.</b> A line in somebody's wardrobe names
   * one orbit among several and has to say which at a glance; a figure that is only visible for
   * part of its lap makes that a matter of waiting. The same still frame reduced motion asks
   * for, asked for by the host instead of by the reader.
   */
  still?: boolean;
}>();

const root = ref<HTMLElement | null>(null);

/**
 * How big the face under this is, in pixels.
 *
 * <b>Measured rather than passed in, because almost nothing passes it.</b> An avatar takes its size
 * from a class as often as from a prop, so the only honest answer comes from the box itself — and
 * the answer decides whether anything moves at all. A member list draws hundreds of faces at 22
 * pixels, where a figure orbiting one is four pixels of noise and four pixels of noise times a
 * window of people is a list that never settles.
 */
const faceSize = ref(0);

let observer: ResizeObserver | null = null;

// The sampled circle and the square waves that go with it, put on the page once. Here rather than
// in this component's stylesheet because the rules naming them are inline styles, and an inline
// style cannot see a scoped one.
onMounted(() => {
  installOrbitKeyframes();
  measure();

  if (typeof ResizeObserver === "undefined" || root.value === null) return;

  observer = new ResizeObserver(measure);
  observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

function measure(): void {
  if (root.value !== null) faceSize.value = root.value.clientWidth;
}

const payload = computed(() => props.item.payload as AvatarOrbitPayload);

/**
 * Whether the arrangement runs, or stands in the pose its author chose for it.
 *
 * The two reasons are deliberately the same switch: a face too small to read an orbit on and a
 * person who asked for less movement both want the still frame, and a renderer with two ways of
 * standing still would eventually have one of them that nobody tested.
 */
const moving = computed(() =>
  props.still !== true && !reduceMotion.value && faceSize.value >= payload.value.minSizePx);

const drawn = computed<DrawnSatellite[]>(() => {
  const stage = stageOf(payload.value);
  const satellites: DrawnSatellite[] = [];

  for (let index = 0; index < payload.value.satellites.length; index++) {
    const satellite = payload.value.satellites[index];
    const figure = drawSatellite(satellite, index, stage, urlFor(satellite), moving.value, props.still === true);

    // A figure with nothing to draw draws nothing. The ordinary case is an operator midway through
    // authoring: the row names a slot and the upload into it has not happened yet.
    if (figure !== null) satellites.push(figure);
  }

  return satellites;
});

function urlFor(satellite: OrbitSatellite): string | null {
  const fileId = props.item.assets[satellite.slot];

  return fileId ? cdnUrl(fileId) : null;
}
</script>

<template>
  <div ref="root" class="cosmetic-orbit-stage" aria-hidden="true">
    <template v-for="figure in drawn" :key="figure.index">
      <div
        v-for="copy in figure.copies"
        :key="`${figure.index}:${copy.behind}`"
        class="cosmetic-orbit-part"
        :style="copy.gate"
      >
        <div class="cosmetic-orbit-part" :style="copy.rocker">
          <div class="cosmetic-orbit-part" :style="copy.mover">
            <div class="cosmetic-orbit-part" :style="copy.bobber">
              <div class="cosmetic-orbit-part" :style="copy.sprite" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cosmetic-orbit-stage {
  position: absolute;
  inset: 0;

  /*
   * Over the face. Everything that belongs behind it is cut to the face's own shape instead, which
   * is what makes the head solid without this component knowing anything about how the avatar
   * draws itself.
   */
  z-index: 2;

  pointer-events: none;
  user-select: none;
}

.cosmetic-orbit-part {
  /* A figure is meant to leave the face — that is the whole of it — so nothing here may clip. */
  overflow: visible;
  pointer-events: none;

  /* The base stylesheet clamps things to their container; a figure drawn deliberately outside one
     is exactly what that rule is aimed at, and exactly what has to survive it. */
  max-width: none;
  max-height: none;
}
</style>
