<!--
  BorderTrace — two soft "comet" highlights (180° apart) sweep the parent's
  border in the same direction, chasing each other for two full turns (720°),
  then fade out. Built from a rotating conic-gradient masked to a thin ring,
  so the color softly trails off along each comet's tail.

  Drop inside a `position: relative` rounded container. Re-mount (via :key)
  to replay. Used as an error pulse on the auth cards.
  Motion auto-neutralizes under prefers-reduced-motion.
-->
<template>
  <div class="border-trace" aria-hidden="true"></div>
</template>

<style scoped>
@property --bt-angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: false;
}

.border-trace {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 20;

  /* Ring thickness. */
  padding: 1.5px;

  /* Two comets 180° apart: sharp head, long fading tail (~120°), same direction. */
  background: conic-gradient(
    from var(--bt-angle),
    rgb(239 68 68 / 0.95) 0deg,
    rgb(239 68 68 / 0) 120deg,
    rgb(239 68 68 / 0) 180deg,
    rgb(239 68 68 / 0.95) 180deg,
    rgb(239 68 68 / 0) 300deg,
    rgb(239 68 68 / 0) 360deg
  );

  /* Keep only the border ring (full box minus content box). */
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;

  opacity: 0;
  filter: drop-shadow(0 0 5px rgb(239 68 68 / 0.5));
  animation: bt-run 1.9s ease-in-out forwards;
}

@keyframes bt-run {
  0% {
    opacity: 0;
    --bt-angle: 0deg;
  }
  12% {
    opacity: 1;
  }
  85% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    --bt-angle: 720deg;
  }
}
</style>
