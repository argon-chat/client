// Messages between LottiePool (main thread) and src/workers/lottie.worker.ts.

export interface LottieLoadMessage {
  type: "load";
  playerId: number;
  fileId: string;
  /** A gzipped TGS or plain Lottie JSON. */
  bytes: ArrayBuffer;
  /** Backing size in device pixels. */
  width: number;
  height: number;
  toneIndex?: number;
  /** Present here when given (transferred). Without it the worker posts each frame back instead. */
  canvas?: OffscreenCanvas;
  textColor?: string | null;
  loop?: boolean;
  /** 1 = every frame, 0.5 = every other frame (for 60 fps files). */
  skipRatio?: number;
  /** Which frames go into the cache: 0 none, Infinity all, n = all but every n-th. */
  cachingDelta?: number;
  /** Post a `firstFrame` with a copy of the first rendered frame. */
  wantFirstFrame?: boolean;
}

export type LottieToWorker =
  | { type: "init"; wasmUrl: string; cacheBudgetBytes?: number }
  | LottieLoadMessage
  | { type: "play"; playerId: number }
  | { type: "pause"; playerId: number }
  | { type: "seek"; playerId: number; frameNo: number }
  | { type: "setLoop"; playerId: number; loop: boolean }
  | { type: "setTextColor"; playerId: number; color: string | null }
  | { type: "renderFrame"; playerId: number; frameNo: number; requestId: number }
  | { type: "ack"; playerId: number }
  | { type: "destroy"; playerId: number };

export type LottieFromWorker =
  | { type: "loaded"; playerId: number; frameCount: number; fps: number }
  | { type: "firstFrame"; playerId: number; bitmap: ImageBitmap }
  /** A free-run frame (canvas-less players, to be acked) or a `renderFrame` reply (`requestId`). */
  | { type: "frame"; playerId: number; frameNo: number; bitmap: ImageBitmap; requestId?: number }
  /**
   * Once per player, after `loaded`: its first frame is on the page. A canvas player's frame has
   * reached the placeholder canvas; otherwise this follows the first `frame` message.
   */
  | { type: "presented"; playerId: number; frameNo: number }
  | { type: "ended"; playerId: number; frameNo: number }
  | { type: "error"; playerId: number; message: string; requestId?: number };
