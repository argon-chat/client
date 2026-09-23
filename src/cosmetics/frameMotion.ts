import { logger } from "@argon/core";

/**
 * A way a frame's part can move, declared in one file under `motions/`.
 *
 * <b>The vocabulary is code and the numbers are data.</b> A catalogue row naming a movement and
 * saying how far, how often and how far out of step it is, is data an operator types; a row carrying
 * keyframes would be CSS arriving from the database onto everybody who opens a profile. That is the
 * same line `textEffect.ts` draws for the treatments a name can wear, and for the same reason.
 *
 * Deleting the file removes the movement: rows asking for it stop moving and go on drawing, which is
 * how every unknown thing degrades here. It is also what makes an older client safe against a
 * movement released after it — the server does not police the set for exactly this reason.
 */
export interface FrameMotionModule {
  /** Must equal the `motion.kind` written in the payload. That is how the two halves find each other. */
  readonly key: string;

  /**
   * The keyframes this movement needs, installed with every other one's and gone when the file is.
   *
   * They read `--cf-amount` rather than baking a distance in, so one rule serves every row that asks
   * for this movement however far it wants to go.
   */
  readonly keyframes: string;

  /**
   * The whole `animation` shorthand for one part, delay included.
   *
   * A shorthand rather than a bag of properties because a part can be moving and running a sprite at
   * the same time, and the renderer joins the two with a comma — which only works if each side
   * brought a complete animation.
   */
  animation(params: FrameMotionParams): string;
}

export interface FrameMotionParams {
  /** How far it goes. Degrees, pixels or a fraction, depending on the movement. */
  readonly amount: number;

  readonly periodMs: number;

  /**
   * How far out of step this part starts, as a negative delay — the animation begins already
   * underway rather than waiting.
   */
  readonly phaseMs: number;
}

/**
 * Hands the movement back as it was given.
 *
 * It exists for the type: a file under `motions/` is checked against the contract where it is
 * written, rather than turning out to be the wrong shape when the registry finds it.
 */
export function defineFrameMotion(motion: FrameMotionModule): FrameMotionModule {
  return motion;
}

/**
 * Every movement this build ships, read from the files in `motions/`.
 *
 * The same arrangement the kind registry uses, for the same reason: the set is the directory
 * listing, so nothing lists them by hand and nothing can be out of date.
 */
const motionModules = import.meta.glob("./motions/*.ts", {
  eager: true,
  import: "default",
}) as Record<string, FrameMotionModule>;

const byKey = new Map<string, FrameMotionModule>();

for (const [path, motion] of Object.entries(motionModules)) {
  if (!motion?.key) {
    logger.error("Frame motion file exports no key", path);
    continue;
  }

  if (byKey.has(motion.key)) {
    logger.error("Two frame motions claim the same key", motion.key, path);
    continue;
  }

  byKey.set(motion.key, motion);
}

/** The movement a payload's `motion.kind` names, or undefined when this build has no file for it. */
export function resolveMotion(kind: string): FrameMotionModule | undefined {
  return byKey.get(kind);
}

let keyframesInstalled = false;

/**
 * Puts every movement's keyframes on the page, once.
 *
 * Here rather than in a component's stylesheet because the rule that names them is an inline style,
 * and an inline style cannot see a scoped one.
 */
export function installMotionKeyframes(): void {
  if (keyframesInstalled || typeof document === "undefined") return;

  keyframesInstalled = true;

  const rules: string[] = [];

  for (const motion of byKey.values()) {
    rules.push(motion.keyframes);
  }

  if (rules.length === 0) return;

  const style = document.createElement("style");

  style.dataset.cosmeticFrameMotions = "";
  style.textContent = rules.join("\n");

  document.head.appendChild(style);
}
