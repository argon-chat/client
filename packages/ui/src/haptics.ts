import * as vue from "vue";

type PenTexture = "ink-continuous" | "brush-continuous" | "eraser-continuous";

interface AppHaptics {
  perform(pattern: PenTexture, options: { pointerId: number; fallback?: PenTexture | false }): boolean;
  stop(pointerId: number): boolean;
  trigger(element: Element, gesture: "step" | "boundary", pointerId?: number): boolean;
}

// Skathi's Vue runtime re-exports appHaptics. Vite removes this branch in the web build.
const haptics: AppHaptics | undefined = import.meta.env.SK ? Reflect.get(vue, "appHaptics") : undefined;

export function startPenFeedback(event: PointerEvent, texture: PenTexture) {
  const { pointerId, pointerType } = event;
  if (pointerType !== "pen" || !haptics) return;
  const fallback = texture === "brush-continuous" ? "ink-continuous" : false;
  if (haptics.perform(texture, { pointerId, fallback })) return () => haptics.stop(pointerId);
}

/** Reka sliders emit value changes from both keyboard and pointer handlers. */
export function useSliderHaptics() {
  let element: Element | null = null;
  let pointerId: number | undefined;

  function capture(event: PointerEvent | KeyboardEvent) {
    element = event.currentTarget as Element;
    pointerId = "pointerId" in event ? event.pointerId : undefined;
  }

  function changed(values: number[] | undefined, min = 0, max = 100, previous?: number[] | null) {
    if (!haptics || !element || !values?.length) return;
    const boundary = values.some((value, index) =>
      (value === min || value === max) && value !== previous?.[index],
    );
    haptics.trigger(element, boundary ? "boundary" : "step", pointerId);
  }

  return { capture, changed };
}
