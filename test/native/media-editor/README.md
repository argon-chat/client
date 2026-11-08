# Production editor in the native SDK

Windows qualification fixture for the actual `@argon/media-editor` public
entry point, store, Vue components and WGSL shaders. This is not a replacement
editor. `vue` is aliased to the SDK renderer by its builder, as in the app.

From the shell repository, after installing the client and SDK JS dependencies:

```powershell
$env:CARGO_TARGET_DIR = 'G:/as-target' # optional local build cache
Push-Location crates/vue-native
cargo build --release -p vn-app --no-default-features --features webgpu --locked
Pop-Location
./client/test/native/media-editor/run.ps1 -HostPath <path-to-vn-app.exe>
# Default one-device GPU-only display (no environment overrides):
./client/test/native/media-editor/run.ps1 -HostPath <path-to-vn-app.exe> -Output artifacts/editor-native
# Same physical device, previous readback display for A/B comparison:
./client/test/native/media-editor/run.ps1 -HostPath <path-to-vn-app.exe> -Readback -Output artifacts/editor-readback
# Optional independent comparison (requires Python + Pillow):
python ./client/test/native/media-editor/compare.py artifacts/editor-native artifacts/editor-readback
```

`-Output <directory>` selects an evidence directory; otherwise it uses
`artifacts/native-media-editor-<UTC timestamp>`. No source paths are baked in.
The host gets an empty profile, separate app-data directories, no single
instance and no foreground focus. The runner fences the devtools connection
by child PID and terminates only that child in `finally`.

The source PNG is generated in memory, including a translucent strip for alpha
qualification; no account, user files or uploads are used. The fixture checks actual pointer-slider input, a single history entry,
Ctrl+Z pixel restoration, rotation/crop/mirror redraw, avatar PNG export,
sticker mask upload, jump-flood outline, sticker PNG export and close/reopen.
It also drives GPUI hit-tested brush down/move/release outside the surface,
first blur and neon, projected text selection/drag/double-click and native
textbox input. Source annotation coordinates must stay unchanged when the
perspective changes; diagnostics and annotated PNG export are captured.
All eight local editor font faces must load successfully, including through
bundled npm imports in development.

Frame intervals are recorded for animated perspective and pen/blur/neon/mask
brushes on a generated 1536×1152 image. The runner rejects a single-frame
stall above 500 ms; the JSON evidence also records median and p95, which
must be reviewed rather than treating that coarse stall check as an FPS target.
Each close waits for logical GPUDevice loss and zero attached canvases. Export
must leave the live preview usable. GPU hashes, alpha counts, screenshots,
state, exported PNGs and cleanup are saved. A shared-device run also requires
the host's native COM identity check to succeed. In GPU-only mode `mem` must
report positive native frames/atlas GPU copies, zero asynchronous display
readbacks and zero atlas CPU fallbacks. `compare.py` requires exact GPU fingerprints, source annotation rasters and
three decoded PNG exports. Whole-window screenshots allow at most one 8-bit
channel level of SVG/atlas compositing roundoff; every measured maximum is
reported. It also checks
resource/process cleanup for both runs.

This qualifies static image avatar/sticker paths, annotation rasterization and
interactive text/brush input. Magnetic lasso workers, video/WebCodecs imports
and a production account flow are not covered. Native WebGPU and shared-device presentation are enabled by default. Canvas presentation uses
GPU textures in shared-device mode. The explicit `-SeparateDevice` diagnostic mode and
`-Readback` baseline retain bounded asynchronous readback; pixel/PNG export
always remains an explicit CPU readback.
