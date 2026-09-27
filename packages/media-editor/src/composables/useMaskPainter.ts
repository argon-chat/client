import { inject, type InjectionKey } from 'vue';
import type { Vec2 } from '../types';
import type { DirtyRect } from '../mask/maskRaster';

/** The mask as it stands, one byte per mask pixel. */
export type MaskSnapshot = { width: number; height: number; data: Uint8Array };

/** Paints on the image's mask; implemented by the image canvas, driven by the brush canvas. */
export interface MaskPainter {
  /** `size` and `point` in canvas (device) pixels. */
  begin(mode: 'erase' | 'restore', size: number, point: Vec2): void;
  extend(point: Vec2): void;
  end(): void;
  /** For a tool that previews its own result: the mask with every committed edit. */
  snapshot(): MaskSnapshot | null;
  /** Shows `alpha` (rect-sized) in `rect` of the mask until the next change of the mask state. */
  preview(rect: DirtyRect, alpha: Uint8Array): void;
}

export type MaskPainterSlot = { current: MaskPainter | null };

export const MASK_PAINTER_KEY: InjectionKey<MaskPainterSlot> = Symbol('media-editor-mask-painter');

export function useMaskPainterSlot(): MaskPainterSlot {
  return inject(MASK_PAINTER_KEY, { current: null });
}
