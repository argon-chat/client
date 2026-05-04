import { ref, onUnmounted } from "vue";

/**
 * Global animation gate — while heavy transitions run, scroll-driven logic
 * should pause to avoid layout thrashing.
 */

type Ungate = () => void;
interface Gate { enter: () => void; leave: () => void }

const gates = new Set<Gate>();
let running = 0;

function broadcast(phase: "enter" | "leave") {
  for (const g of gates) g[phase]();
}

/** Signal the start of a heavy animation. Call the returned function when done. */
export function beginHeavyWork(): Ungate {
  if (running === 0) broadcast("enter");
  running++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    running--;
    if (running === 0) broadcast("leave");
  };
}

/** Convenience: auto-end after `ms` milliseconds. */
export function heavyWorkFor(ms: number): void {
  const end = beginHeavyWork();
  setTimeout(end, ms);
}

/**
 * Composable returning reactive `busy` flag.
 * While `busy` is true, callers should skip expensive scroll checks.
 * After it flips back to false, `pendingRecheck` indicates a deferred
 * check should fire.
 */
export function useHeavyAnimationCheck() {
  const isAnimating = ref(running > 0);
  const needCheckAfterAnimation = ref(false);

  const gate: Gate = {
    enter() { isAnimating.value = true; },
    leave() { isAnimating.value = false; needCheckAfterAnimation.value = true; },
  };

  gates.add(gate);
  onUnmounted(() => { gates.delete(gate); });

  const consumeNeedCheck = (): boolean => {
    if (needCheckAfterAnimation.value) {
      needCheckAfterAnimation.value = false;
      return true;
    }
    return false;
  };

  return {
    isAnimating,
    needCheckAfterAnimation,
    consumeNeedCheck,
    dispatchHeavyAnimation: beginHeavyWork,
    dispatchHeavyAnimationFor: heavyWorkFor,
  };
}
