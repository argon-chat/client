import { defineFrameMotion } from "@/cosmetics/frameMotion";

/**
 * Catching the light and losing it. `amount` is how much brighter the peak is, so 0.4 is forty per
 * cent up.
 *
 * The other movement a band can wear, and the useful one on metal, frost and anything with a
 * highlight painted into it — it works on the picture rather than on where the picture is.
 *
 * Not the same as the name treatment called shimmer, which travels a gradient across glyphs. This
 * one has nothing to travel: a band's paint is a file, not a gradient we control.
 */
export default defineFrameMotion({
  key: "glimmer",

  keyframes: `@keyframes cosmetic-frame-glimmer {
  0%, 100% { filter: brightness(1); }
  50%      { filter: brightness(calc(1 + var(--cf-amount))); }
}`,

  animation: ({ periodMs, phaseMs }) =>
    `cosmetic-frame-glimmer ${periodMs}ms ease-in-out ${-phaseMs}ms infinite`,
});
