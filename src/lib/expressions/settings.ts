import { computed, ref, shallowRef, type WritableComputedRef } from "vue";
import { persisted } from "@argon/storage";
import { userScopedKey } from "@/lib/userScopedStorage";
import { reduceMotion } from "@/composables/useReducedMotion";
import { powerSaveActive } from "@/lib/powerSaver";
import { onSessionReset } from "@/store/system/sessionLifecycle";

/** Per user, like the recents: "animate stickers and emoji". Unset until the user flips it. */
export const EXPRESSION_ANIMATIONS_KEY = "argon_expression_animations";
/** Per user: stickers and custom emoji in the picker grid play on their own. */
export const PICKER_AUTOPLAY_KEY = "argon_expression_picker_autoplay";

function osReducedMotionNow(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const osReducedMotion = ref(osReducedMotionNow());
try {
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
    osReducedMotion.value = e.matches;
  });
} catch {
  /* no matchMedia: the value read above stands */
}

const openChoice = (key: string) => persisted<boolean | null>(userScopedKey(key), null);
const choices = shallowRef({
  animations: openChoice(EXPRESSION_ANIMATIONS_KEY),
  pickerAutoplay: openChoice(PICKER_AUTOPLAY_KEY),
});
// A seamless account switch (no reload): read the next account's choices.
onSessionReset(() => {
  choices.value = { animations: openChoice(EXPRESSION_ANIMATIONS_KEY), pickerAutoplay: openChoice(PICKER_AUTOPLAY_KEY) };
});

/** Until the user chooses: on, unless the OS or the app's own "reduce motion" asks for less. */
export const animationsDefault = computed(() => !(osReducedMotion.value || reduceMotion.value));

/**
 * Lite mode's switch ("Animate stickers and emoji") as the user left it: their choice, or the
 * default until they make one. What Appearance settings binds to.
 */
export const animationsChoice: WritableComputedRef<boolean> = computed({
  get: () => choices.value.animations.value ?? animationsDefault.value,
  set: (value) => choices.value.animations.set(value),
});

/**
 * Whether stickers and custom emoji play: the switch, unless power saving has the say — a low
 * battery or a running game holds them on their first frame whatever was chosen (lib/powerSaver.ts).
 * Everything animated plays through the animation intersector, which reads this. Writing it moves
 * the switch.
 */
export const animationsEnabled: WritableComputedRef<boolean> = computed({
  get: () => !powerSaveActive.value && animationsChoice.value,
  set: (value) => {
    animationsChoice.value = value;
  },
});

/** The picker grid's stickers and emoji (group "picker") play on their own; off, they hold still. */
export const pickerAutoplay: WritableComputedRef<boolean> = computed({
  get: () => choices.value.pickerAutoplay.value ?? true,
  set: (value) => choices.value.pickerAutoplay.set(value),
});

/** Back to "not chosen": both switches follow their defaults again. */
export function resetExpressionAnimationChoices(): void {
  choices.value.animations.set(null);
  choices.value.pickerAutoplay.set(null);
}

/**
 * Whether an animation that was not told otherwise should hold still: power saving when it is on,
 * else the user's choice when there is one (an explicit "animate" wins over the OS setting), else
 * reduced motion. Read live.
 */
export function prefersReducedMotion(): boolean {
  if (powerSaveActive.value) return true;
  const chosen = choices.value.animations.value;
  if (chosen !== null) return !chosen;
  return osReducedMotionNow() || reduceMotion.value;
}
