import { defineFrameMotion } from "@/cosmetics/frameMotion";

/**
 * Fading in and out on the spot. `amount` is how far down it dips, so 0.3 falls to seven tenths.
 *
 * One of the two movements a band can honestly wear: it changes nothing about where the part is, so
 * a band glued to the card's edge stays glued to it.
 *
 * It multiplies with the part's own opacity rather than replacing it — the renderer keeps the two on
 * different elements for exactly that.
 */
export default defineFrameMotion({
  key: "flicker",

  keyframes: `@keyframes cosmetic-frame-flicker {
  0%, 100% { opacity: calc(1 - var(--cf-amount)); }
  50%      { opacity: 1; }
}`,

  animation: ({ periodMs, phaseMs }) =>
    `cosmetic-frame-flicker ${periodMs}ms ease-in-out ${-phaseMs}ms infinite`,
});
