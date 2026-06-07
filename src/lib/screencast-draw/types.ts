/**
 * Wire + local types for the screencast drawing overlay.
 *
 * Points are normalized to [0,1] over the SHARED MONITOR SURFACE (the exact pixels
 * being captured), so they are resolution-, DPI- and aspect-independent and every
 * party (each viewer's canvas + the streamer's physical-resolution native overlay)
 * agrees on them. Stroke width is normalized as a fraction of the surface width.
 */

export type StrokeTool = "brush" | "arrow";

/** A single normalized point [x, y], each in [0,1]. */
export type NormPoint = [number, number];

export type DrawKind = "begin" | "append" | "end" | "clear" | "undo";

export interface DrawEnvelope {
  v: 1;
  /** Drawing session id (from the server's StartDrawingSession). */
  sid: string;
  /** LiveKit participant identity of the drawer. */
  from: string;
  /** Streamer identity whose surface this draws on. */
  target: string;
  kind: DrawKind;
  /** Client send time (ms) — used to anchor decay on receipt. */
  t: number;
}

export interface StrokeBegin extends DrawEnvelope {
  kind: "begin";
  strokeId: string;
  tool: StrokeTool;
  /** "#rrggbb" or "#rrggbbaa". */
  color: string;
  /** Normalized (fraction of surface width). */
  width: number;
  /** Decay lifetime in ms (else the session default). */
  ttlMs: number;
  p: NormPoint[];
}

export interface StrokeAppend extends DrawEnvelope {
  kind: "append";
  strokeId: string;
  p: NormPoint[];
}

export interface StrokeEnd extends DrawEnvelope {
  kind: "end";
  strokeId: string;
  p?: NormPoint[];
}

export interface StrokeClear extends DrawEnvelope {
  kind: "clear";
  /** Clear all strokes, or only this drawer's strokes when set. */
  who?: string;
}

export interface StrokeUndo extends DrawEnvelope {
  kind: "undo";
  strokeId: string;
}

export type DrawPacket = StrokeBegin | StrokeAppend | StrokeEnd | StrokeClear | StrokeUndo;

/** Accumulated render-side state for one stroke. */
export interface LiveStroke {
  strokeId: string;
  from: string;
  tool: StrokeTool;
  color: string;
  width: number;
  points: NormPoint[];
  /** Local receipt time (ms) — decay anchor. */
  createdAt: number;
  ttlMs: number;
  /** Hold solid until this age (ms) before fading. */
  fadeStartMs: number;
  ended: boolean;
}

export const DRAW_TOPIC = "af-draw";

/** Defaults (overridable per-stroke / per-session). */
export const DEFAULT_TTL_MS = 6000;
export const DEFAULT_FADE_START_MS = 3000;
/** Default normalized brush width (fraction of surface width). */
export const DEFAULT_WIDTH = 0.004;
