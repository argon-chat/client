# Background-removal model

`u2netp.onnx` is **U²-Netp**, the 4.7 MB variant of U²-Net (Qin et al., "U²-Net: Going Deeper with
Nested U-Structure for Salient Object Detection", Pattern Recognition 2020), used by the sticker
workbench's "Remove background" (`src/lib/expressions/workbench/`).

| | |
|---|---|
| Model | U²-Netp, salient object detection |
| Weights | [`xuebinqin/U-2-Net`](https://github.com/xuebinqin/U-2-Net) (`u2netp.pth`, linked from its README) |
| License | **Apache-2.0** — the repository's [`LICENSE`](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE); a copy is [`LICENSE-U2Net.txt`](./LICENSE-U2Net.txt). The repository has no NOTICE file. |
| ONNX export | rembg (MIT), release asset <https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx>, unmodified |
| Size | 4 574 861 bytes |
| SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| MD5 | `8e83ca70e441ab06c318d82300c84806` (the checksum rembg pins in `rembg/sessions/u2netp.py`) |

Input: `float32[1, 3, 320, 320]`, RGB divided by the image's maximum value, then standardised with
mean `(0.485, 0.456, 0.406)` and std `(0.229, 0.224, 0.225)`. Output: the first of seven
`float32[1, 1, 320, 320]` saliency maps, min–max normalised by the caller.

The app checks the SHA-256 above (`BG_MODEL.sha256` in `src/lib/expressions/workbench/model.ts`)
before using the file, and keeps it in IndexedDB (`argon-workbench-models`) after the first use.
Replacing the model means updating both the file and that constant.

Verify with `sha256sum public/models/u2netp.onnx`.
