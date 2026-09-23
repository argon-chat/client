import { defineFrameMotion } from "@/cosmetics/frameMotion";

/**
 * Rocking about the point the part is attached at, like a thing hanging in a draught.
 *
 * The pivot is not this file's to choose: a piece sitting on the top edge rocks about its own base
 * and one hanging off the left rocks about its right — the renderer knows which edge a part is
 * pinned to and sets the origin from that.
 *
 * `amount` is degrees to either side. Small: two degrees on a piece 80px tall already moves its tip
 * by three pixels, and anything that reads as a wave here reads as a wobble on a card.
 */
export default defineFrameMotion({
  key: "sway",

  keyframes: `@keyframes cosmetic-frame-sway {
  0%, 100% { transform: rotate(calc(var(--cf-amount) * -1deg)); }
  50%      { transform: rotate(calc(var(--cf-amount) * 1deg)); }
}`,

  animation: ({ periodMs, phaseMs }) =>
    `cosmetic-frame-sway ${periodMs}ms ease-in-out ${-phaseMs}ms infinite`,
});
