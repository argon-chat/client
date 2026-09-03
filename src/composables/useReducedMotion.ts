import { persistedValue } from "@argon/storage";

/**
 * The accessibility "reduce motion" preference, shared.
 *
 * `persistedValue()` builds a fresh ref per call — two call sites for the same key read the same
 * storage but never see each other's writes. Anything that reacts to this preference has to hold
 * the *same* ref as the switch in Appearance settings, or it only picks the change up on remount.
 *
 * The OS-level setting is handled separately and globally by styles/reduced-motion.css; this is the
 * in-app toggle, which exists for people whose OS setting is off.
 */
export const reduceMotion = persistedValue<boolean>("appearance.reduceMotion", false);
