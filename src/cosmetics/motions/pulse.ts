import { defineFrameMotion } from "@/cosmetics/frameMotion";

/**
 * Breathing: growing and shrinking about the attachment point. `amount` is a fraction, so 0.06 is
 * six per cent either way.
 *
 * Wrong on a band, and deliberately not stopped from being put on one. A band is glued to the card's
 * edge and scaling it opens a gap — but what a frame should look like is the author's judgement, and
 * a renderer that refused arrangements it disapproved of would be the thing every future frame had
 * to be argued past.
 */
export default defineFrameMotion({
  key: "pulse",

  keyframes: `@keyframes cosmetic-frame-pulse {
  0%, 100% { transform: scale(calc(1 - var(--cf-amount))); }
  50%      { transform: scale(calc(1 + var(--cf-amount))); }
}`,

  animation: ({ periodMs, phaseMs }) =>
    `cosmetic-frame-pulse ${periodMs}ms ease-in-out ${-phaseMs}ms infinite`,
});
