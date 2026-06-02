import { persistedValue } from "@argon/storage";
import { watchEffect } from "vue";

/**
 * Ultrawide / compact-layout + interface-scale runtime. Module-level singletons
 * shared (reactive) between AppearanceSettings (writes), AppShell (ambient), and
 * the watchEffect below that applies everything to <html>. Applied here in the
 * renderer (not the theme package) so it works regardless of package build state.
 */
export const layoutMode = persistedValue<string>("appearance.layoutMode", "default"); // 'default' | 'ultrawide'
export const ultrawideThreshold = persistedValue<string>("appearance.ultrawideThreshold", "ultra"); // 'ultra' (>=2:1) | 'wide' (>=16:10)
export const ultrawideMaxWidth = persistedValue<number>("appearance.ultrawideMaxWidth", 1700);
export const ultrawideCenterTitlebar = persistedValue<boolean>("appearance.ultrawideCenterTitlebar", true);
export const uiScale = persistedValue<number>("appearance.uiScale", 100);

export const ULTRAWIDE_MIN = 1400;
export const ULTRAWIDE_MAX = 2400;
export const UI_SCALE_MIN = 70;
export const UI_SCALE_MAX = 150;

if (typeof document !== "undefined") {
  // Apply layout classes + max-width var (reacts to any setting change & on load).
  watchEffect(() => {
    const root = document.documentElement;
    const on = layoutMode.value === "ultrawide";
    root.classList.toggle("layout-cap-ultra", on && ultrawideThreshold.value !== "wide");
    root.classList.toggle("layout-cap-wide", on && ultrawideThreshold.value === "wide");
    root.classList.toggle("ultrawide-center-titlebar", on && ultrawideCenterTitlebar.value);
    root.style.setProperty("--ultrawide-max", `${ultrawideMaxWidth.value}px`);
  });

  // Interface scale — prefer Electron's zoom factor (handles viewport units
  // correctly); fall back to CSS zoom on the web.
  watchEffect(() => {
    const factor = (uiScale.value || 100) / 100;
    const wm = (window as any).windowManagement;
    if (wm?.setZoom) {
      wm.setZoom(factor);
    } else {
      document.documentElement.style.setProperty("zoom", String(factor));
    }
  });
}
