export type TweenHandle = { cancel: () => void };

export interface TweenOptions {
  from: number | number[];
  to: number | number[];
  duration: number;
  easing?: (t: number) => number;
  onUpdate: (value: any) => void;
  onComplete?: () => void;
}

/** Cubic ease-out: fast start, smooth deceleration. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate between numeric values over time using requestAnimationFrame.
 * Returns a handle with `cancel()` to stop the animation.
 */
export function tween(opts: TweenOptions): TweenHandle {
  const { from, to, duration, easing = easeOutCubic, onUpdate, onComplete } = opts;
  const startTime = performance.now();
  let cancelled = false;

  function tick(now: number) {
    if (cancelled) return;
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const t = easing(progress);

    if (typeof from === 'number' && typeof to === 'number') {
      onUpdate(from + (to - from) * t);
    } else if (Array.isArray(from) && Array.isArray(to)) {
      onUpdate(from.map((v, i) => v + (to[i] - v) * t));
    }

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      onComplete?.();
    }
  }

  requestAnimationFrame(tick);
  return { cancel: () => { cancelled = true; } };
}

