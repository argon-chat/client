import type { Vec2 } from '../types';
import type { Bounds } from './coverage';

/** Main thread → live-wire worker. Coordinates are working-image pixels. */
export type LiveWireRequest =
  | {
      type: 'init';
      id: number;
      width: number;
      height: number;
      /** Straight RGBA, transferred. */
      rgba: Uint8ClampedArray;
    }
  | {
      type: 'path';
      id: number;
      from: Vec2;
      to: Vec2;
      /** Snap `to` to the strongest edge within this radius first. */
      snap: number;
      maxWindow?: number;
      pad?: number;
      window?: Bounds;
      /** x, y pairs the path may not use. */
      blocked?: Int32Array;
    }
  | { type: 'snap'; id: number; point: Vec2; radius: number };

export type LiveWireEvent =
  | { type: 'ready'; id: number; ms: number }
  | {
      type: 'path';
      id: number;
      /** x, y pairs, transferred. */
      points: Int32Array;
      end: Vec2;
      clamped: boolean;
      straight: boolean;
      /** Time spent in the worker. */
      ms: number;
    }
  | { type: 'snap'; id: number; point: Vec2 }
  | { type: 'error'; id: number; message: string };
