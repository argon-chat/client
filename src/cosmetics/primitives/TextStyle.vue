<script setup lang="ts">
import {
  computed,
  onMounted,
} from "vue";

import type {
  NicknameGradientShape,
  NicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import {
  installTextEffectKeyframes,
  useFontOption,
} from "@/cosmetics/primitives/textComposition";
import type { FontOptionPayload } from "@/cosmetics/kinds/option-font";
import { textEffect } from "@/cosmetics/kinds/option-text-effect";
import { optionOn } from "@/cosmetics/optionOn";
import type { ResolvedCosmetic } from "@/cosmetics/types";
import { reduceMotion } from "@/composables/useReducedMotion";
import { argbToRgba } from "@/lib/profileCustomization";

/**
 * Draws a name in whatever face, colour and treatment it is wearing.
 *
 * <b>It knows no face and no treatment by name.</b> Both arrive as options composed onto the equipped
 * row, and a treatment brings its own CSS from its own file — so this file does not change when one
 * is added or withdrawn, which is what makes the count of them a matter of catalogue rows rather
 * than a switch statement here.
 */
const props = defineProps<{ item: ResolvedCosmetic; fallbackColor?: string }>();

onMounted(installTextEffectKeyframes);

const face = computed(() => optionOn(props.item, "font"));

/** An uploaded face has to be registered with the document before any rule can name it. */
useFontOption(face);

/** The role colour the surface passes, else nothing. */
const tint = computed(() => props.fallbackColor ?? null);

/**
 * The colour every surface draws a name in when it names none itself.
 *
 * Not `currentColor`: a painted name sets its own colour to transparent, and a gradient resolves
 * `currentColor` against the very element it paints.
 */
const SURFACE_INK = "hsl(var(--foreground))";

const effect = computed(() => {
  const chosen = optionOn(props.item, "effect");

  return chosen ? textEffect(chosen.slug) : undefined;
});

/** What the wearer decided about their own name, where they decided anything. */
const own = computed(() => props.item.payload as NicknameStyleTuning | null);

/**
 * Every colour in play, most specific first.
 *
 * The wearer's own come before the surface's because they are the latest and most particular thing
 * said: this is somebody having gone and picked.
 */
const colours = computed<string[]>(() => {
  const mine = own.value?.colors ?? null;

  if (mine && mine.length > 0) {
    return mine.map(argbToRgba);
  }

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
  const value = own.value;
  const css: Record<string, string> = {};
  const family = (face.value?.payload as FontOptionPayload | undefined)?.cssFamily;

  // The row holds a bare family, so the rule quotes it and names a generic face behind it.
  if (family) {
    css.fontFamily = `"${family}", sans-serif`;
  }

  if (value?.weight) {
    css.fontWeight = String(value.weight);
  }

  if (value && value.letterSpacingCentiEm !== null) {
    css.letterSpacing = `${value.letterSpacingCentiEm / 100}em`;
  }

  const stops = colours.value;
  const paint = (...list: string[]) => gradient(aim.value.angle, aim.value.shape, aim.value.animate, ...list);

  // A surface that names no colour still paints the name in its own ink, so the treatment is handed
  // that rather than skipped: the same look comes out the same in a member list and on a card.
  const offered = stops.length > 0 ? stops : [SURFACE_INK];
  const painted = effect.value?.style({ stops: offered, tint: offered[0], lighten, shade, gradient: paint });

  if (painted) {
    Object.assign(css, painted);
  } else if (stops.length > 1) {
    Object.assign(css, paint(...stops));
  } else if (stops.length === 1) {
    css.color = stops[0];
  }

  // Motion is the treatment's, but whether it runs is the viewer's.
  if (reduceMotion.value) {
    css.animation = "none";
  }

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
 * the stops are laid out twice and the whole thing slides by exactly one tile. The tile is closed
 * too, ending on the colour it starts with, so where one tile meets the next there is no seam.
 *
 * Only a linear gradient can travel: the other two are laid out from the centre, so sliding the box
 * moves the middle off the word rather than moving the colours along it. Whatever does not travel is
 * laid once — a sweep laid twice is two sweeps standing still.
 */
function gradient(angle: number, shape: NicknameGradientShape, animate: boolean, ...stops: string[]): Record<string, string> {
  const travels = animate && shape === "linear" && !reduceMotion.value;
  const closed = shape === "linear" && !travels ? stops : [...stops, stops[0]];
  const laid = travels ? [...stops, ...closed] : closed;
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

  // The position rides a custom property rather than background-position itself, so a treatment
  // that lays its own layer over this one can move that layer without stopping this one.
  if (travels) {
    css.backgroundSize = "200% 100%";
    css.backgroundPosition = "var(--cosmetic-name-drift) 0";
    css.animation = "cosmetic-name-drift 6s linear infinite";
  }

  return css;
}

/**
 * Mixes a colour towards white or black, so one swatch can carry a multi-stop treatment.
 *
 * <b>The browser mixes it, as the glow does.</b> A version that parsed the colour itself understood
 * hex and `rgb()` and handed anything else back unchanged — and a role colour in a chat arrives as
 * `hsl(…)`, so every treatment there got three identical stops and painted flat.
 */
function mix(colour: string, towards: string, amount: number): string {
  return `color-mix(in srgb, ${colour}, ${towards} ${Math.round(amount * 100)}%)`;
}

function lighten(colour: string, amount: number): string {
  return mix(colour, "white", amount);
}

function shade(colour: string, amount: number): string {
  return mix(colour, "black", amount);
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

  /*
   * A painted name is drawn by its background, clipped to the letters, and a background stops at
   * the box. A host that sets the line tight (a message author is `leading-none`) gets a box shorter
   * than the glyphs, which took the tails off g, y and p. The padding is the room; the margin hands
   * it back, so nothing around the name moves.
   */
  padding-block: 0.25em;
  margin-block: -0.25em;

  /* Room for a halo past the box, for a host that truncates the name with `overflow: clip`. */
  overflow-clip-margin: 1em;
}
</style>

<!--
  Unscoped, because the rule that names these keyframes is an inline style and an inline style
  belongs to no component's scope. One copy for every name on screen, which is what a keyframe set
  costs either way.
-->
<style>
/* Registered, so the position interpolates rather than jumping from one end to the other. */
@property --cosmetic-name-drift {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 0%;
}

@keyframes cosmetic-name-drift {
  to {
    --cosmetic-name-drift: -200%;
  }
}
</style>
