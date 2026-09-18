import { defineFrameMotion } from "@/cosmetics/frameMotion";

/**
 * The same as bobbing, sideways. `amount` is pixels either side.
 *
 * Its own file rather than an axis argument on one movement: a row names a movement, and "bob with
 * axis x" is a second thing to get wrong for no gain over a second name.
 */
export default defineFrameMotion({
  key: "drift",

  keyframes: `@keyframes cosmetic-frame-drift {
  0%, 100% { transform: translateX(calc(var(--cf-amount) * -1px)); }
  50%      { transform: translateX(calc(var(--cf-amount) * 1px)); }
}`,

  animation: ({ periodMs, phaseMs }) =>
    `cosmetic-frame-drift ${periodMs}ms ease-in-out ${-phaseMs}ms infinite`,
});
