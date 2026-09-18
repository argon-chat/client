import { defineFrameMotion } from "@/cosmetics/frameMotion";

/**
 * Turning all the way round, over and over. `amount` is turns per period, so 1 is one revolution and
 * -1 is one the other way.
 *
 * The only movement here that is linear, because a spin that eases is a spin that keeps stopping.
 */
export default defineFrameMotion({
  key: "spin",

  keyframes: `@keyframes cosmetic-frame-spin {
  from { transform: rotate(0turn); }
  to   { transform: rotate(calc(var(--cf-amount) * 1turn)); }
}`,

  animation: ({ periodMs, phaseMs }) =>
    `cosmetic-frame-spin ${periodMs}ms linear ${-phaseMs}ms infinite`,
});
