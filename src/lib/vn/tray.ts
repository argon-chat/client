/**
 * Argon's tray icon on vue-native: Open / Exit, and a click that brings the window back. It used to
 * be the shell's Rust (crates/argon-shell/src/tray.rs); it is the app's now, through the SDK's
 * `appTray`, as any vue-native app would write it.
 *
 * `appTray` is read off the "vue" namespace, as ./vnWindow.ts reads `VnWindow`: the Vite build has no
 * "vue-native" module, and the lookup is dead code there behind `import.meta.env.VN`.
 *
 * An autostart starts the window hidden. If the icon cannot be shown here, the window is shown
 * instead, so a hidden app is never left with no way back in; vue-native does the same on its own
 * when no icon is up a few seconds after a hidden start.
 */
import * as vue from "vue";
import { isVn } from "./index";
import { appWindow } from "./window";
import { logger } from "@argon/core";

interface AppTray {
  readonly available: boolean;
  set(options: unknown): void;
}

const appTray: AppTray | null =
  import.meta.env.VN && isVn ? ((Reflect.get(vue, "appTray") as AppTray | undefined) ?? null) : null;

const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/**
 * The menu bar wants the cat alone, drawn in its text colour: without an icon macOS would show the
 * app icon, tile and all. An SVG data URL is a template icon. Windows keeps the executable's icon.
 * The glyph is assets/macos/AppIcon.icon/Assets/cat.svg, with the 2-in-36 margin the old bitmap had.
 */
const CAT =
  "M114.54,88.82c5.35-2.75,9.96-6.72,13.46-11.53c-4.67-3.14-9.86-5.56-15.4-7.09 c0.01-24.5-6.29-48.6-18.25-69.73c-7.96,8.45-14.3,18.49-18.62,29.31c-7.66-1.22-15.65-1.06-23.27,0.31 C48.13,19.15,41.74,9.02,33.71,0.47C21.76,21.62,15.45,45.7,15.46,70.2c-5.54,1.53-10.73,3.95-15.4,7.09 c3.49,4.82,8.1,8.78,13.46,11.53c-3.64,2.85-6.74,6.37-9.14,10.33c5.87,4.32,12.67,7.48,20.05,9.09c19.68,25.4,59.51,25.41,79.2,0 c7.38-1.61,14.18-4.78,20.05-9.09C121.28,95.19,118.18,91.68,114.54,88.82z M23.7,68.22c0,0,4.13-2.07,12.4-2.07 c8.27,0,19.64,11.37,19.64,11.37s-8.27,6.2-19.64,9.3C32.11,87.91,26.8,77.52,23.7,68.22z M64,98.19c-5.71,0-10.33-4.13-10.33-12.4 c1.04-0.35,2.16-0.62,3.3-0.85l3,6.02l1.21-6.61c1.9-0.14,3.84-0.14,5.75,0.01l1.22,6.65l3.01-6.05c1.1,0.23,2.17,0.49,3.18,0.82 C74.33,94.05,69.71,98.19,64,98.19z M92.99,86.03c-11.37-3.1-19.63-9.3-19.63-9.3s11.37-11.37,19.63-11.37s12.4,2.07,12.4,2.07 C102.29,76.73,96.98,87.12,92.99,86.03z";
const MENU_BAR_ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 144 144"><path fill="#000" d="${CAT}"/></svg>`,
)}`;

const show = () => appWindow?.show();

/** Puts the icon up. Called once at launch; a later call replaces the model. */
export function startTray(): void {
  if (!appTray) return;
  try {
    if (!appTray.available) throw new Error("no tray on this platform");
    appTray.set({
      icon: isMac ? MENU_BAR_ICON : undefined,
      tooltip: "Argon",
      onClick: show,
      menu: [
        { label: "Open Argon", default: true, onSelect: show },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    });
  } catch (error) {
    logger.warn("[tray] could not start the tray icon:", error);
    // A failed icon must not strand a hidden (autostarted) app.
    show();
  }
}
