/**
 * Entry point for the lean offscreen screencast-drawing overlay window
 * (screencast-overlay.html). Deliberately minimal — no router, pinia, i18n or app
 * shell. It mounts only the stroke canvas, which is driven entirely by the
 * `argonScreencastDraw` preload bridge (stroke packets forwarded from the streamer's
 * main window via the Electron main process).
 */
import { createApp } from "vue";
import ScreencastDrawWindow from "./components/screencast-overlay/ScreencastDrawWindow.vue";

createApp(ScreencastDrawWindow).mount("#overlay-app");
