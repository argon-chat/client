export type BgRemovalBackend = "webgpu" | "wasm";

export interface BgRemovalRequest {
  type: "segment";
  id: number;
  /** Transferred. */
  image: ImageBitmap;
  /** Size of the mask to return. */
  width: number;
  height: number;
  /** Edge softening in mask pixels. */
  feather?: number;
  /** Force the CPU runtime (tests, or a GPU known to misbehave). */
  backend?: BgRemovalBackend;
}

export type BgRemovalEvent =
  | { type: "progress"; id: number; value: number }
  | {
      type: "result";
      id: number;
      /** Transferred; one byte per pixel. */
      mask: Uint8Array;
      width: number;
      height: number;
      backend: BgRemovalBackend;
      model: "cache" | "network";
    }
  | { type: "error"; id: number; message: string };
