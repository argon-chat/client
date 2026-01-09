// Re-export from @argon/theme with app-specific config
import { useTheme as useBaseTheme, type ThemeId, accentColors, hexToHSL } from "@argon/theme";
import { useConfigStore } from "@/store/configStore";

export type { ThemeId };
export { accentColors, hexToHSL };

export function useTheme() {
  const configStore = useConfigStore();
  
  return useBaseTheme({
    onThemeChange: async (_theme, nativeTheme) => {
      try {
        await configStore.setTheme(nativeTheme as "Dark" | "White" | "OLED");
      } catch (err) {
        console.warn("Failed to sync theme with native host:", err);
      }
    }
  });
}
