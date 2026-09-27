/**
 * The salient-object model behind "Remove background": U²-Netp (Apache-2.0), as the ONNX export
 * rembg publishes. Source, license and checksum: public/models/README.md.
 */
export const BG_MODEL = {
  name: "u2netp",
  /** Served from public/. */
  path: "/models/u2netp.onnx",
  sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
  bytes: 4_574_861,
  /** NCHW float32 [1, 3, 320, 320] in, [1, 1, 320, 320] saliency out (first output). */
  inputSize: 320,
  /** ImageNet statistics, applied after scaling by the image's own maximum (as U²-Net and rembg do). */
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
} as const;

export type BgModel = typeof BG_MODEL;
