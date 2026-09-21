import { defineFrameMotion } from "@/cosmetics/frameMotion";

/**
 * Rising and settling in place. `amount` is pixels either side of where the part was put.
 *
 * Eased at both ends rather than linear, because a thing that turns round at constant speed reads as
 * a thing being moved rather than a thing floating.
 */
export default defineFrameMotion({
  key: "bob",

  keyframes: `@keyframes cosmetic-frame-bob {
  0%, 100% { transform: translateY(calc(var(--cf-amount) * -1px)); }
  50%      { transform: translateY(calc(var(--cf-amount) * 1px)); }
}`,

  animation: ({ periodMs, phaseMs }) =>
    `cosmetic-frame-bob ${periodMs}ms ease-in-out ${-phaseMs}ms infinite`,
});
