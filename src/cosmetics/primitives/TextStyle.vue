<script setup lang="ts">
import { computed, onMounted } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import { argbToRgb } from "@/lib/profileCustomization";
import { installTextEffectKeyframes, useFontOption } from "@/cosmetics/primitives/textComposition";
import { textEffect } from "@/cosmetics/kinds/option-text-effect";
import { optionOn, type ResolvedCosmetic } from "@/cosmetics/types";
import type { GradientShape, NicknameStylePayload, NicknameStyleTuning } from "@/cosmetics/kinds/nickname-style";
import type { FontOptionPayload } from "@/cosmetics/kinds/option-font";
import type { SwatchOptionPayload } from "@/cosmetics/kinds/option-swatch";

/**
 * Draws a name in whatever face, colour and treatment it is wearing.
 *
 * <b>It knows no face and no treatment by name.</b> Both arrive as options composed onto the equipped
 * row, and a treatment brings its own CSS from its own file — so this file does not change when one
 * is added or withdrawn, which is what makes the count of them a matter of catalogue rows rather
 * than a switch statement here.
 */
const props = defineProps<{ item: ResolvedCosmetic; fallbackColor?: string }>();

const payload = computed(() => props.item.payload as NicknameStylePayload);

onMounted(installTextEffectKeyframes);

const face = computed(() => optionOn(props.item, "font"));

/** An uploaded face has to be registered with the document before any rule can name it. */
useFontOption(face);

/** The wearer's swatch, else the role colour the surface passes, else nothing. */
const tint = computed(() => {
  const swatch = optionOn(props.item, "color");

  return (swatch?.payload as SwatchOptionPayload | undefined)?.hex ?? props.fallbackColor ?? null;
});

const effect = computed(() => {
  const chosen = optionOn(props.item, "effect");

  return chosen ? textEffect(chosen.slug) : undefined;
});

/** What the wearer decided about their own name, where they decided anything. */
const own = computed(() => props.item.content as NicknameStyleTuning | null);

/**
 * Every colour in play, most specific first.
 *
 * The wearer's own come before the row's because they are the latest and most particular thing
 * said: the row's stops are what a style looks like out of the box, the axis is a list to choose
 * from, and this is somebody having gone and picked.
 */
const colours = computed<string[]>(() => {
  const mine = own.value?.stops ?? null;

  if (mine && mine.length > 0) return [...mine];

  const authored = payload.value.gradientStops;

  if (authored && authored.length > 0) return authored.map(argbToRgb);

  return tint.value ? [tint.value] : [];
});

/** How the wearer aimed them. The defaults are what a style looks like before anybody touches it. */
const aim = computed(() => ({
  angle: own.value?.angle ?? 90,
  shape: own.value?.shape ?? "linear",
  animate: own.value?.animate === true,
}));

/**
 * <b>The treatment is always asked, whatever the colours are.</b> It used to be skipped outright as
 * soon as somebody had two or more of their own — the renderer painted the list and never consulted
 * it — so for exactly the people who had bothered to choose colours, the whole axis did nothing and
 * looked broken from the outside.
 *
 * What is left here is the order: colours from the most particular source that has any, painted the
 * way the wearer aimed them, by the treatment they chose.
 */
const style = computed(() => {
  const value = payload.value;
  const css: Record<string, string> = {};
  const family = (face.value?.payload as FontOptionPayload | undefined)?.cssFamily;

  if (family) css.fontFamily = family;
  if (value.weight) css.fontWeight = String(value.weight);
  if (value.letterSpacingEm !== null) css.letterSpacing = `${value.letterSpacingEm}em`;

  const stops = colours.value;
  const paint = (...list: string[]) => gradient(aim.value.angle, aim.value.shape, aim.value.animate, ...list);

  const painted = stops.length > 0
    ? effect.value?.style({ stops, tint: stops[0], lighten, shade, gradient: paint })
    : null;

  if (painted) Object.assign(css, painted);
  else if (stops.length > 1) Object.assign(css, paint(...stops));
  else if (stops.length === 1) css.color = stops[0];

  // Motion is the treatment's, but whether it runs is the viewer's.
  if (reduceMotion.value) css.animation = "none";

  return css;
});

/**
 * Paints the colours across the letters.
 *
 * <b>Conic and radial close their own loop.</b> A sweep or a ring whose first and last colours differ
 * has a seam where they meet, which reads as a mistake rather than a choice, so the first colour is
 * repeated at the end.
 *
 * Travelling is a wide background moved across the text rather than the colours being recomputed:
 * the stops are laid out twice and the whole thing slides by exactly one copy, which loops with no
 * jump and costs the compositor alone.
 */
function gradient(angle: number, shape: GradientShape, animate: boolean, ...stops: string[]): Record<string, string> {
  const closed = shape === "linear" ? stops : [...stops, stops[0]];
  const laid = animate ? [...closed, ...closed] : closed;
  const list = laid.join(", ");

  const image = shape === "radial"
    ? `radial-gradient(circle at center, ${list})`
    : shape === "conic"
      ? `conic-gradient(from ${angle}deg at center, ${list})`
      : `linear-gradient(${angle}deg, ${list})`;

  const css: Record<string, string> = {
    backgroundImage: image,
    backgroundClip: "text",
    webkitBackgroundClip: "text",
    color: "transparent",
  };

  // Only a linear gradient can travel: the other two are laid out from the centre, so sliding the
  // box moves the middle off the word rather than moving the colours along it.
  if (animate && shape === "linear" && !reduceMotion.value) {
    css.backgroundSize = "200% 100%";
    css.animation = "cosmetic-name-drift 6s linear infinite";
  }

  return css;
}

/**
 * Mixes a colour towards white or black, so one swatch can carry a multi-stop treatment.
 *
 * It reads `rgb()` as well as hex, and that is not a nicety: a role colour arrives as `rgb(…)`, and
 * a version that only understood hex handed every treatment back the colour it was given — three
 * identical stops, which paints as flat. The treatment did nothing and said nothing.
 */
function mix(colour: string, towards: number, amount: number): string {
  const channels = channelsOf(colour);

  if (!channels) return colour;

  const blended = channels.map(channel => Math.round(channel + (towards - channel) * amount));

  return `#${blended.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function channelsOf(colour: string): number[] | null {
  if (colour.startsWith("#") && colour.length === 7) {
    const value = Number.parseInt(colour.slice(1), 16);

    return Number.isFinite(value) ? [value >> 16 & 0xff, value >> 8 & 0xff, value & 0xff] : null;
  }

  const parsed = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(colour);

  return parsed ? [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])] : null;
}

function lighten(hex: string, amount: number): string {
  return mix(hex, 255, amount);
}

function shade(hex: string, amount: number): string {
  return mix(hex, 0, amount);
}
</script>

<template>
  <span class="cosmetic-text-style" :style="style">
    <slot />
  </span>
</template>

<style scoped>
.cosmetic-text-style {
  display: inline-block;
}
</style>

<!--
  Unscoped, because the rule that names these keyframes is an inline style and an inline style
  belongs to no component's scope. One copy for every name on screen, which is what a keyframe set
  costs either way.
-->
<style>
@keyframes cosmetic-name-drift {
  to {
    background-position: -200% 0;
  }
}
</style>
