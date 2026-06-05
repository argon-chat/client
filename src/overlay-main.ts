/**
 * Entry point for the lean offscreen in-game overlay window (overlay.html).
 * Deliberately minimal — no router, pinia, i18n, sockets or app shell. It mounts
 * only the WebGPU overlay view, which is driven entirely by the `argonOverlay`
 * preload bridge.
 */
import { createApp } from "vue";
import OverlayWindow from "./components/overlay-window/OverlayWindow.vue";

createApp(OverlayWindow).mount("#overlay-app");
