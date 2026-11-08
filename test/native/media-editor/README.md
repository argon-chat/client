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
# Experimental one-physical-device GPUI/WebGPU path:
./client/test/native/media-editor/run.ps1 -HostPath <path-to-vn-app.exe> -SharedDevice
```

`-Output <directory>` selects an evidence directory; otherwise it uses
`artifacts/native-media-editor-<UTC timestamp>`. No source paths are baked in.
The host gets an empty profile, separate app-data directories, no single
instance and no foreground focus. The runner fences the devtools connection
by child PID and terminates only that child in `finally`.

The source PNG is generated in memory; no account, user files or uploads are
used. The fixture checks actual pointer-slider input, a single history entry,
Ctrl+Z pixel restoration, rotation/crop/mirror redraw, avatar PNG export,
sticker mask upload, jump-flood outline, sticker PNG export and close/reopen.
Each close waits for logical GPUDevice loss and zero attached canvases. Export
must leave the live preview usable. GPU hashes, alpha counts, screenshots,
state, exported PNGs and cleanup are saved. A shared-device run also requires
the host's native COM identity check to succeed.

This qualifies static image avatar/sticker paths. Text rasterization, magnetic
lasso workers, video/WebCodecs imports and a production account flow are not
covered. Native WebGPU remains opt-in. Normal canvas presentation still uses
bounded asynchronous readback, including in the shared-device mode.
