// Re-export from @argon/theme with app-specific (native host) wiring.
import { useTheme as useBaseTheme, type ThemeId, accentColors, hexToHSL } from "@argon/theme";
import { ref } from "vue";
import { appWindow } from "@/lib/sk/window";
import { useConfigStore } from "@/store/ui/configStore";
import { useFeatureFlags, FeatureFlagKeys } from "@/store/features/featureFlagsStore";

export type { ThemeId };
export { accentColors, hexToHSL };

/** Live OS accent color (e.g. "#3b82f6"), or null when unavailable / on web. */
export const systemAccent = ref<string | null>(null);


let baseInstance: ReturnType<typeof useBaseTheme> | null = null;
let nativeInited = false;
let lastSource: string | null = null;
let lastNative: string | null = null;

function createBase() {
  return useBaseTheme({
    systemAccent: () => systemAccent.value,
    // UI-density control is feature-flagged; off → forced "comfortable".
    uiDensityEnabled: () => {
      try {
        return useFeatureFlags().isEnabled(FeatureFlagKeys.UI_DENSITY_ACTIVE);
      } catch {
        return false; // pinia not ready yet
      }
    },
    onThemeChange: async (theme, nativeTheme) => {
      // Drive the native window theme (acrylic/mica tint + system resolution).
      const source = theme === "light" ? "light" : theme === "system" ? "system" : "dark";
      if (source !== lastSource) {
        lastSource = source;
        try {
          if (appWindow) appWindow.theme = source;
        } catch (e) {
          console.warn("[theme] setSource failed:", e);
        }
      }
      // Persist for the native host (used at next launch). Guard to avoid spam.
      if (nativeTheme !== lastNative) {
        lastNative = nativeTheme;
        try {
          await useConfigStore().setTheme(nativeTheme as "Dark" | "White" | "OLED" | "System");
        } catch (e) {
          console.warn("[theme] config sync failed:", e);
        }
      }
    },
  });
}

function initNative() {
  if (nativeInited) return;
  nativeInited = true;

  window.matchMedia?.("(prefers-color-scheme: dark)")
    ?.addEventListener?.("change", () => baseInstance?.applyAppearanceSettings());
}

export function useTheme() {
  if (!baseInstance) baseInstance = createBase();
  initNative();
  return baseInstance;
}
