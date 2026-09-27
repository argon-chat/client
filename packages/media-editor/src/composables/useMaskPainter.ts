import { inject, type InjectionKey } from 'vue';
import type { Vec2 } from '../types';

/** Paints on the image's mask; implemented by the image canvas, driven by the brush canvas. */
export interface MaskPainter {
  /** `size` and `point` in canvas (device) pixels. */
  begin(mode: 'erase' | 'restore', size: number, point: Vec2): void;
  extend(point: Vec2): void;
  end(): void;
}

export type MaskPainterSlot = { current: MaskPainter | null };

export const MASK_PAINTER_KEY: InjectionKey<MaskPainterSlot> = Symbol('media-editor-mask-painter');

export function useMaskPainterSlot(): MaskPainterSlot {
  return inject(MASK_PAINTER_KEY, { current: null });
}
