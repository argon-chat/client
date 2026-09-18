<script lang="ts">
/** Two dials on one page must not share a gradient definition, so each takes a number. */
let instances = 0;
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IconPlus, IconX } from "@tabler/icons-vue";
import { useLocale } from "@/store/system/localeStore";
import { reduceMotion } from "@/composables/useReducedMotion";
import type { GradientShape, NicknameStyleTuning } from "@/cosmetics/kinds/nickname-style";

/**
 * Your own colours on your own name.
 *
 * <b>Separate from the colour axis, and deliberately.</b> The axis is a list somebody else wrote and
 * priced — a swatch is a thing an operator published. This is the colour you picked because it is
 * yours, so it is stored on what you are wearing rather than chosen from a catalogue, and it wins
 * over the axis wherever both have something to say.
 *
 * One stop is a flat colour; two or more make a gradient, and the dial says which way it runs. The
 * cap is eight because past that a name is a smear.
 */
const props = defineProps<{ content: NicknameStyleTuning; disabled?: boolean }>();

const emit = defineEmits<{ "update:content": [value: NicknameStyleTuning] }>();

const { t } = useLocale();

const MAX_STOPS = 8;

const DEFAULT_STOP = "#f43f5e";

/** The same fifteen degrees the old slider stepped by: fine enough to aim, coarse enough to land. */
const STEP = 15;

const stops = computed(() => props.content.stops ?? []);

const angle = computed(() => props.content.angle ?? 90);

/** Two or more colours is a gradient; the dial has nothing to turn on a single one. */
const flows = computed(() => stops.value.length > 1);

const SHAPES: readonly GradientShape[] = ["linear", "radial", "conic"];

const shape = computed(() => props.content.shape ?? "linear");

const animate = computed(() => props.content.animate === true);

function write(next: Partial<NicknameStyleTuning>): void {
  emit("update:content", {
    stops: props.content.stops ?? null,
    angle: props.content.angle ?? null,
    shape: props.content.shape ?? null,
    animate: props.content.animate ?? null,
    ...next,
  });
}

function setStop(index: number, value: string): void {
  const next = [...stops.value];

  next[index] = value;
  write({ stops: next });
}

function addStop(): void {
  if (stops.value.length >= MAX_STOPS) return;

  write({ stops: [...stops.value, stops.value.at(-1) ?? DEFAULT_STOP] });
}

function removeStop(index: number): void {
  const next = stops.value.filter((_, at) => at !== index);

  // No colours at all is "as the style and the axis say", which is what clearing it has to mean —
  // an empty list would be a gradient of nothing.
  write({ stops: next.length > 0 ? next : null, angle: next.length > 1 ? props.content.angle ?? null : null });
}

/** The gradient as it will actually be painted, so the swatch row is the answer rather than a legend. */
const ribbon = computed(() => {
  if (stops.value.length === 0) return { background: "transparent" };

  if (stops.value.length === 1) return { background: stops.value[0] };

  // The same closing the text does, so the strip is not a different gradient from the name above it.
  const closed = shape.value === "linear" ? stops.value : [...stops.value, stops.value[0]];
  const list = closed.join(", ");

  if (shape.value === "radial") return { backgroundImage: `radial-gradient(circle at center, ${list})` };

  if (shape.value === "conic") return { backgroundImage: `conic-gradient(from ${angle.value}deg at center, ${list})` };

  return { backgroundImage: `linear-gradient(${angle.value}deg, ${list})` };
});

// ── Reordering ──────────────────────────────────────────────────────────────────────────────────

/**
 * The colours are read left to right, so their order is the gradient.
 *
 * <b>Dragged rather than deleted and re-added.</b> Putting the third colour second was, before this,
 * "drop two of them and pick them again" — which loses the exact shades somebody had settled on to
 * perform an operation that has nothing to do with what the colours are.
 *
 * A pointer drag rather than the HTML5 kind: the thing being dragged contains a colour input, which
 * has its own ideas about both dragging and clicking, and this way the two are told apart by how far
 * the pointer went rather than by which of them got the event first.
 */
const row = ref<HTMLElement | null>(null);

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  index: number;
  active: boolean;
}

const drag = ref<Drag | null>(null);

/** Whether the last press ended in a move, so the click it produces can be thrown away. */
const dragged = ref(false);

/** Far enough that nobody aiming at the colour picker gets a reorder instead. */
const THRESHOLD = 5;

/** How far outside the row the pointer may wander and still be aiming at a slot. */
const REACH = 28;

function take(event: PointerEvent, index: number): void {
  dragged.value = false;

  // A click on the little cross is a removal, and has to stay one.
  if (props.disabled || (event.target as HTMLElement).closest(".stop-drop")) return;

  drag.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, index, active: false };
}

function drift(event: PointerEvent): void {
  const held = drag.value;

  if (!held || event.pointerId !== held.pointerId) return;

  if (!held.active) {
    if (Math.hypot(event.clientX - held.startX, event.clientY - held.startY) < THRESHOLD) return;

    held.active = true;
    row.value?.setPointerCapture(event.pointerId);
  }

  const target = slotAt(event.clientX, event.clientY);

  if (target === null || target === held.index) return;

  const next = [...stops.value];
  const [taken] = next.splice(held.index, 1);

  next.splice(target, 0, taken);
  held.index = target;

  write({ stops: next });
}

function drop(event: PointerEvent): void {
  const held = drag.value;

  if (!held || event.pointerId !== held.pointerId) return;

  if (held.active) row.value?.releasePointerCapture(event.pointerId);

  // Left standing until the next press: the click that follows a release would otherwise open the
  // colour picker of whatever the pointer happened to finish over.
  dragged.value = held.active;
  drag.value = null;
}

function swallow(event: MouseEvent): void {
  if (!dragged.value) return;

  event.preventDefault();
  event.stopPropagation();
}

/** The slot the pointer is aiming at: the nearest one, while it is anywhere near the row. */
function slotAt(x: number, y: number): number | null {
  const strip = row.value;

  if (!strip) return null;

  const bounds = strip.getBoundingClientRect();

  if (x < bounds.left - REACH || x > bounds.right + REACH || y < bounds.top - REACH || y > bounds.bottom + REACH) {
    return null;
  }

  const wells = [...strip.querySelectorAll<HTMLElement>(".stop")];

  let nearest: number | null = null;
  let closest = Number.POSITIVE_INFINITY;

  for (let index = 0; index < wells.length; index += 1) {
    const box = wells[index].getBoundingClientRect();
    const away = Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2));

    if (away < closest) {
      closest = away;
      nearest = index;
    }
  }

  return nearest;
}

/** The same move from the keyboard, because a drag is not something everybody can perform. */
function shift(index: number, by: number): void {
  const to = index + by;

  if (props.disabled || to < 0 || to >= stops.value.length) return;

  const next = [...stops.value];
  const [taken] = next.splice(index, 1);

  next.splice(to, 0, taken);
  write({ stops: next });
}

// ── The dial ────────────────────────────────────────────────────────────────────────────────────

/**
 * A direction is a circle, and the old control was a line.
 *
 * <b>A slider makes you translate.</b> "One hundred and thirty-five" is a number you have to picture
 * before you know which way your name will run, and its two ends — 0 and 360 — are the same
 * direction sitting as far apart as the track allows. A dial is the thing itself: the handle points
 * where the gradient goes, and the wrap is just the way round.
 *
 * It reads the same way CSS does — zero at the top, clockwise — so what is drawn here and what
 * `linear-gradient` does with the number are one picture.
 */
const dial = ref<HTMLElement | null>(null);

const RADIUS = 42;

const TICKS = Array.from({ length: 360 / STEP }, (_, index) => index * STEP);

const gradientId = `nickname-dial-${(instances += 1)}`;

function pointOf(degrees: number, radius: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;

  return { x: 50 + radius * Math.sin(radians), y: 50 - radius * Math.cos(radians) };
}

const handle = computed(() => pointOf(angle.value, RADIUS));

const arc = computed(() => {
  const circumference = 2 * Math.PI * RADIUS;
  const drawn = (angle.value / 360) * circumference;

  return { strokeDasharray: `${drawn} ${circumference}` };
});

/** The wearer's own colours, so the dial is lit by the gradient it is aiming. */
const sweep = computed(() => {
  const colours = stops.value.length > 0 ? stops.value : [DEFAULT_STOP];

  return colours.map((colour, index) => ({
    colour,
    offset: colours.length === 1 ? 0 : (index / (colours.length - 1)) * 100,
  }));
});

const tip = computed(() => stops.value.at(-1) ?? DEFAULT_STOP);

function angleAt(event: PointerEvent): number {
  const box = dial.value?.getBoundingClientRect();

  if (!box) return angle.value;

  const dx = event.clientX - (box.left + box.width / 2);
  const dy = event.clientY - (box.top + box.height / 2);

  // atan2 of (x, -y) rather than the usual (y, x): that is what puts zero at the top and turns it
  // clockwise, which is the convention every gradient in CSS already uses.
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;

  return (Math.round(((degrees + 360) % 360) / STEP) * STEP) % 360;
}

function grab(event: PointerEvent): void {
  if (props.disabled) return;

  const held = event.currentTarget as HTMLElement;

  held.setPointerCapture(event.pointerId);

  // By hand, because the default was prevented to stop the drag selecting the panel's text — and
  // without it a dial you have just turned cannot then be nudged with the arrow keys.
  held.focus();

  write({ angle: angleAt(event) });
}

function turn(event: PointerEvent): void {
  if (props.disabled) return;

  // Only while held. A dial that followed the pointer across the panel would be a trap.
  if (!(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return;

  write({ angle: angleAt(event) });
}

function nudge(by: number): void {
  write({ angle: ((angle.value + by) % 360 + 360) % 360 });
}

function onKey(event: KeyboardEvent): void {
  if (props.disabled) return;

  const by = {
    ArrowRight: STEP,
    ArrowUp: STEP,
    ArrowLeft: -STEP,
    ArrowDown: -STEP,
    PageUp: 90,
    PageDown: -90,
  }[event.key];

  if (by !== undefined) {
    event.preventDefault();
    nudge(by);

    return;
  }

  if (event.key === "Home") {
    event.preventDefault();
    write({ angle: 0 });
  }
}
</script>

<template>
  <div class="tuning">
    <div class="tuning-head">
      <span class="tuning-title">{{ t("cosmetic_tuning_colors") }}</span>
      <span class="tuning-hint">{{ t("cosmetic_tuning_colors_hint") }}</span>
    </div>

    <!--
      The row owns the drag, not the chip: a pointer captured by the thing being moved stops
      reporting where the others are, and where the others are is the whole question.
    -->
    <div
      ref="row"
      class="tuning-stops"
      :class="{ 'tuning-stops--moving': drag?.active }"
      @pointermove="drift"
      @pointerup="drop"
      @pointercancel="drop"
    >
      <label
        v-for="(stop, index) in stops"
        :key="index"
        class="stop"
        :class="{ 'stop--held': drag?.active && drag.index === index }"
        :style="{ '--stop': stop }"
        :title="t('cosmetic_tuning_reorder')"
        @pointerdown="take($event, index)"
        @click.capture="swallow"
        @keydown.alt.arrow-left.prevent="shift(index, -1)"
        @keydown.alt.arrow-right.prevent="shift(index, 1)"
      >
        <input
          type="color"
          class="stop-well"
          :value="stop"
          :disabled="disabled"
          @input="setStop(index, ($event.target as HTMLInputElement).value)"
        />
        <button
          class="stop-drop"
          :disabled="disabled"
          :title="t('remove')"
          @click.prevent="removeStop(index)"
        >
          <IconX class="w-2.5 h-2.5" />
        </button>
      </label>

      <button
        v-if="stops.length < MAX_STOPS"
        class="stop-add"
        :disabled="disabled"
        :title="t('cosmetic_tuning_add_stop')"
        @click.prevent="addStop"
      >
        <IconPlus class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- The gradient as it will be painted, rather than a legend describing it. -->
    <div v-if="stops.length" class="ribbon" :style="ribbon">
      <span v-if="flows && animate && shape === 'linear' && !reduceMotion" class="ribbon-sheen" />
    </div>

    <div v-if="flows" class="deck">
      <!--
        Turning is only a direction along a line or around a circle. `radial` is laid out from the
        middle outwards, so there is nothing for a dial to aim.
      -->
      <div
        v-if="shape !== 'radial'"
        ref="dial"
        class="dial"
        :class="{ 'dial--off': disabled }"
        :style="{ '--tip': tip }"
        role="slider"
        :tabindex="disabled ? -1 : 0"
        :aria-label="t('cosmetic_tuning_angle', { angle })"
        aria-valuemin="0"
        aria-valuemax="360"
        :aria-valuenow="angle"
        :aria-valuetext="`${angle}°`"
        :aria-disabled="disabled || undefined"
        @pointerdown.prevent="grab"
        @pointermove="turn"
        @keydown="onKey"
      >
        <svg class="dial-face" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
              <stop v-for="(entry, index) in sweep" :key="index" :offset="`${entry.offset}%`" :stop-color="entry.colour" />
            </linearGradient>
          </defs>

          <!-- Every fifteen degrees, which is every place the handle can land. -->
          <line
            v-for="tick in TICKS"
            :key="tick"
            class="dial-tick"
            :class="{ 'dial-tick--cardinal': tick % 90 === 0 }"
            :x1="pointOf(tick, 47).x"
            :y1="pointOf(tick, 47).y"
            :x2="pointOf(tick, tick % 90 === 0 ? 40 : 43.5).x"
            :y2="pointOf(tick, tick % 90 === 0 ? 40 : 43.5).y"
          />

          <circle class="dial-track" cx="50" cy="50" :r="RADIUS" />

          <circle
            class="dial-arc"
            cx="50"
            cy="50"
            :r="RADIUS"
            :stroke="`url(#${gradientId})`"
            :style="arc"
            transform="rotate(-90 50 50)"
          />

          <line class="dial-needle" x1="50" y1="50" :x2="handle.x" :y2="handle.y" :stroke="tip" />
          <circle class="dial-grip" :cx="handle.x" :cy="handle.y" r="5.5" :fill="tip" />
        </svg>

        <span class="dial-read">{{ angle }}<i>°</i></span>
      </div>

      <div class="deck-side">
        <span class="micro">{{ t("cosmetic_tuning_shape") }}</span>

        <div class="seg" :style="{ '--at': SHAPES.indexOf(shape), '--keys': SHAPES.length }">
          <button
            v-for="option in SHAPES"
            :key="option"
            class="seg-key"
            :class="{ 'seg-key--on': shape === option }"
            :disabled="disabled"
            @click.prevent="write({ shape: option })"
          >{{ t(`cosmetic_tuning_shape_${option}`) }}</button>
        </div>

        <!-- Travelling only means something along a line; the other two are laid out from the
             middle, so sliding them moves the centre off the word. -->
        <button
          class="live"
          :class="{ 'live--on': animate && shape === 'linear' }"
          :disabled="disabled || shape !== 'linear'"
          @click.prevent="write({ animate: !animate })"
        >
          <span class="live-dot" />
          {{ t("cosmetic_tuning_animate") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * A small instrument panel rather than a form.
 *
 * What it is setting is a picture, so the controls are pictures of what they set: the strip is the
 * gradient, and the dial is the direction with the wearer's own colours burnt into it. Nothing here
 * asks anybody to read a number and imagine the result.
 */
.tuning {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 10px;
  padding: 11px 12px 12px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border) / 0.5);
  background:
    linear-gradient(180deg, hsl(var(--primary) / 0.05), transparent 60%),
    hsl(var(--background) / 0.35);
}

/* The hairline that reads as a seam rather than a box: bright in the middle, gone at the ends. */
.tuning::before {
  content: "";
  position: absolute;
  top: -1px;
  left: 12%;
  right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, hsl(var(--primary) / 0.55), transparent);
}

/*
 * The two lit corners that used to sit here — top left and bottom right — are gone.
 *
 * They were meant to say "instrument" with less ink than a full outline. What they actually said,
 * in the accent colour and on two opposite corners only, was that something was selected or in
 * error. The seam above is enough of a lid on the panel.
 */

.tuning-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.tuning-title {
  font-size: 0.64rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

/*
 * Allowed to wrap, because what it says now is a sentence rather than a label.
 *
 * It has to carry the division — these are the colours, the treatment above decides how they are
 * painted — and that was not a thing anybody could work out from the screen: both said "gradient".
 */
.tuning-hint {
  flex: 1;
  min-width: 0;
  font-size: 0.66rem;
  line-height: 1.35;
  color: hsl(var(--muted-foreground));
}

/* ── The colours ─────────────────────────────────────────────────────────────────────────────── */

.tuning-stops {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;

  /* So a drag begun on a chip moves the chip rather than scrolling the panel under it. */
  touch-action: none;
}

/* While one is being carried: nothing selects, and the cursor says what is happening. */
.tuning-stops--moving {
  cursor: grabbing;
  user-select: none;
}

.stop {
  position: relative;
  display: block;
  width: 30px;
  height: 30px;
  cursor: grab;
  transition: transform 0.16s ease;
}

/*
 * The one in hand, lifted off the row.
 *
 * The others snap rather than slide: a reorder here is three or four chips of thirty pixels, and the
 * cost of making that glide is a measure-and-replay pass over the whole row on every pointer move.
 */
.stop--held {
  z-index: 2;
  transform: scale(1.18);
  cursor: grabbing;
}

.stop--held .stop-well {
  border-color: hsl(var(--primary) / 0.8);
  box-shadow:
    0 0 0 1px hsl(var(--primary) / 0.5),
    0 6px 18px -4px color-mix(in srgb, var(--stop) 90%, transparent);
}

/*
 * The swatch is the control, lit by what it holds.
 *
 * A colour input draws its own chrome — a bevel, a border, padding around the colour — which at this
 * size is mostly chrome. Stripped back to the colour, with the colour itself throwing the light.
 */
.stop-well {
  width: 100%;
  height: 100%;
  padding: 0;
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: 8px;
  background: none;
  cursor: pointer;
  box-shadow: 0 0 12px -3px color-mix(in srgb, var(--stop) 85%, transparent);
  transition: box-shadow 0.18s ease, transform 0.18s ease;
}

.stop-well:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 18px -2px color-mix(in srgb, var(--stop) 95%, transparent);
}

.stop-well::-webkit-color-swatch-wrapper {
  padding: 2px;
}

.stop-well::-webkit-color-swatch {
  border: none;
  border-radius: 6px;
}

.stop-drop {
  position: absolute;
  top: -5px;
  right: -5px;
  display: none;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
}

.stop:hover .stop-drop {
  display: flex;
}

.stop-drop:hover {
  color: hsl(var(--destructive));
  border-color: hsl(var(--destructive));
}

.stop-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px dashed hsl(var(--border));
  color: hsl(var(--muted-foreground));
  transition: border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.stop-add:hover {
  border-color: hsl(var(--primary));
  color: hsl(var(--foreground));
  box-shadow: 0 0 14px -4px hsl(var(--primary));
}

/* ── The strip ───────────────────────────────────────────────────────────────────────────────── */

.ribbon {
  position: relative;
  height: 9px;
  border-radius: 999px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px hsl(var(--foreground) / 0.08);
}

/* What "travelling" does, shown doing it rather than named. */
.ribbon-sheen {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.55), transparent);
  background-size: 40% 100%;
  background-repeat: no-repeat;
  animation: nickname-sheen 2.4s linear infinite;
}

@keyframes nickname-sheen {
  from { background-position: -45% 0; }
  to   { background-position: 145% 0; }
}

/* ── The deck ────────────────────────────────────────────────────────────────────────────────── */

.deck {
  display: flex;
  align-items: center;
  gap: 14px;
}

.deck-side {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.micro {
  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, monospace;
  font-size: 0.56rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}

/* ── The dial ────────────────────────────────────────────────────────────────────────────────── */

.dial {
  position: relative;
  flex: 0 0 auto;
  width: 88px;
  height: 88px;
  border-radius: 999px;
  cursor: grab;
  touch-action: none;
  outline: none;

  /* Lit from inside by the colour the handle is carrying, so the instrument is part of the picture. */
  background: radial-gradient(circle at center, color-mix(in srgb, var(--tip) 22%, transparent), transparent 68%);
}

.dial:active {
  cursor: grabbing;
}

.dial:focus-visible {
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.6);
}

.dial--off {
  opacity: 0.45;
  cursor: default;
}

.dial-face {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.dial-tick {
  stroke: hsl(var(--muted-foreground) / 0.35);
  stroke-width: 1.4;
  stroke-linecap: round;
}

.dial-tick--cardinal {
  stroke: hsl(var(--muted-foreground) / 0.7);
  stroke-width: 1.8;
}

.dial-track {
  fill: none;
  stroke: hsl(var(--foreground) / 0.12);
  stroke-width: 4;
}

.dial-arc {
  fill: none;
  stroke-width: 4;
  stroke-linecap: round;

  /* Glowing in its own colours rather than the theme's: the arc is the gradient, seen end-on. */
  filter: drop-shadow(0 0 5px var(--tip));
  transition: stroke-dasharray 0.12s ease-out;
}

.dial-needle {
  stroke-width: 1.6;
  opacity: 0.5;
}

.dial-grip {
  stroke: hsl(var(--background));
  stroke-width: 2;
  filter: drop-shadow(0 0 6px hsl(var(--foreground) / 0.35));
  transition: cx 0.12s ease-out, cy 0.12s ease-out;
}

/*
 * The number sits in the middle of the thing it describes, which is the only place it is not a
 * riddle. Tabular figures so it does not jump between 90 and 105 while being dragged.
 */
.dial-read {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, monospace;
  font-size: 0.98rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  text-shadow: 0 0 10px color-mix(in srgb, var(--tip) 60%, transparent);
  pointer-events: none;
}

/*
 * Raised by a transform rather than by aligning it.
 *
 * The readout is stretched over the whole dial so it can sit in the middle, so `align-self` sent the
 * degree sign to the top of the circle instead of the top of the number.
 */
.dial-read i {
  font-style: normal;
  font-size: 0.66rem;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.55);
  margin-left: 1px;
  transform: translateY(-0.3em);
}

/* ── Shape ───────────────────────────────────────────────────────────────────────────────────── */

.seg {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  background: hsl(var(--background) / 0.5);
}

/* The lit key, as one piece that moves rather than three that take turns being coloured. */
.seg::after {
  content: "";
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc((100% - 4px) / var(--keys));
  border-radius: 6px;
  background: hsl(var(--primary) / 0.16);
  box-shadow: inset 0 0 0 1px hsl(var(--primary) / 0.55), 0 0 12px -4px hsl(var(--primary));
  transform: translateX(calc(var(--at) * 100%));
  transition: transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.seg-key {
  position: relative;
  z-index: 1;
  padding: 4px 10px;
  font-size: 0.66rem;
  white-space: nowrap;
  color: hsl(var(--muted-foreground));
  transition: color 0.18s ease;
}

.seg-key--on {
  color: hsl(var(--foreground));
}

.seg-key:disabled {
  opacity: 0.45;
}

/* ── Travelling ──────────────────────────────────────────────────────────────────────────────── */

.live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 8px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border) / 0.7);
  font-size: 0.66rem;
  color: hsl(var(--muted-foreground));
  transition: color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: hsl(var(--muted-foreground) / 0.6);
  transition: background 0.18s ease, box-shadow 0.18s ease;
}

.live--on {
  color: hsl(var(--foreground));
  border-color: hsl(var(--primary) / 0.6);
  box-shadow: 0 0 14px -5px hsl(var(--primary));
}

.live--on .live-dot {
  background: hsl(var(--primary));
  box-shadow: 0 0 8px hsl(var(--primary));
  animation: nickname-pulse 1.6s ease-in-out infinite;
}

@keyframes nickname-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

.live:disabled {
  opacity: 0.45;
}
</style>
