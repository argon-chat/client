// @argon/theme - Theme management for Argon apps
import { logger } from "@argon/core";
import { persistedValue } from "@argon/storage";
import { computed } from "vue";

export type ThemeId = "dark" | "light" | "oled";

export const accentColors: Record<string, string> = {
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  rose: "#f43f5e",
};

// CSS variable names for theme colors
const cssVars = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
] as const;

// OLED theme color overrides (pure black)
const oledOverrides: Partial<Record<(typeof cssVars)[number], string>> = {
  "--background": "0 0% 0%",
  "--foreground": "0 0% 98%",
  "--card": "0 0% 0%",
  "--card-foreground": "0 0% 98%",
  "--popover": "0 0% 0%",
  "--popover-foreground": "0 0% 98%",
  "--primary": "0 0% 98%",
  "--primary-foreground": "0 0% 0%",
  "--secondary": "0 0% 10%",
  "--secondary-foreground": "0 0% 98%",
  "--muted": "0 0% 10%",
  "--muted-foreground": "0 0% 64.9%",
  "--accent": "0 0% 10%",
  "--accent-foreground": "0 0% 98%",
  "--border": "0 0% 15%",
  "--input": "0 0% 15%",
  "--ring": "0 0% 83.9%",
};

export interface ThemeConfig {
  onThemeChange?: (theme: ThemeId, nativeTheme: string) => void | Promise<void>;
}

export function useTheme(config: ThemeConfig = {}) {
  const currentTheme = persistedValue<string>("appearance.theme", "dark");

  const applyTheme = (themeId?: ThemeId) => {
    const theme = (themeId || currentTheme.value) as ThemeId;
    const html = document.documentElement;

    // Remove all theme classes
    html.classList.remove("dark", "light", "oled");

    // Remove all inline style overrides first
    cssVars.forEach((v) => html.style.removeProperty(v));

    logger.info("[theme] applyTheme:", theme);

    // Apply theme
    if (theme === "oled") {
      html.classList.add("dark");
      // Apply OLED-specific overrides
      Object.entries(oledOverrides).forEach(([key, value]) => {
        html.style.setProperty(key, value);
      });
    } else if (theme === "light") {
      // Light theme - no dark class, use CSS defaults
    } else {
      // Dark theme (default) - add dark class
      html.classList.add("dark");
    }

    currentTheme.value = theme;

    // Update body class for theme-specific background
    document.body.classList.toggle("oled-theme", theme === "oled");

    // Notify native host if callback provided
    const nativeTheme = theme === "dark" ? "Dark" : theme === "light" ? "White" : "OLED";
    config.onThemeChange?.(theme, nativeTheme);
  };

  const applyAppearanceSettings = () => {
    const root = document.documentElement;

    // Apply theme
    applyTheme();

    // Load saved appearance settings
    const fontFamily = persistedValue<string>("appearance.fontFamily", "Inter, sans-serif");
    const fontSize = persistedValue<number>("appearance.fontSize", 14);
    const lineHeight = persistedValue<number>("appearance.lineHeight", 1.5);
    const uiDensity = persistedValue<string>("appearance.uiDensity", "comfortable");
    const borderRadius = persistedValue<number>("appearance.borderRadius", 0.75);
    const accentColor = persistedValue<string>("appearance.accentColor", "blue");
    const enableAnimations = persistedValue<boolean>("appearance.enableAnimations", true);
    const reduceMotion = persistedValue<boolean>("appearance.reduceMotion", false);
    const enableBlur = persistedValue<boolean>("appearance.enableBlur", true);

    // Accessibility settings
    const timestampFormat = persistedValue<string>("appearance.timestampFormat", "24h");
    const highContrast = persistedValue<boolean>("appearance.highContrast", false);
    const dyslexiaFont = persistedValue<boolean>("appearance.dyslexiaFont", false);
    const colorBlindMode = persistedValue<string>("appearance.colorBlindMode", "none");

    // Apply font (or dyslexia font)
    const selectedFont = dyslexiaFont.value ? "OpenDyslexic, sans-serif" : fontFamily.value;
    root.style.setProperty("font-family", selectedFont);
    document.body.style.fontFamily = selectedFont;

    // Apply font size
    root.style.fontSize = `${fontSize.value}px`;

    // Apply line height
    root.style.lineHeight = `${lineHeight.value}`;

    // Apply border radius
    root.style.setProperty("--radius", `${borderRadius.value}rem`);

    // Apply accent color - convert hex to HSL and set as primary
    const colorValue = accentColors[accentColor.value] || "#3b82f6";
    const hsl = hexToHSL(colorValue);
    root.style.setProperty("--primary", hsl);
    root.style.setProperty("--ring", hsl);

    // Apply density
    root.classList.remove("density-compact", "density-comfortable", "density-spacious");
    root.classList.add(`density-${uiDensity.value}`);

    // Apply animations
    if (!enableAnimations.value || reduceMotion.value) {
      root.style.setProperty("--transition-duration", "0ms");
    } else {
      root.style.setProperty("--transition-duration", "200ms");
    }

    // Apply blur
    root.classList.toggle("no-blur", !enableBlur.value);

    // Apply high contrast
    root.classList.toggle("high-contrast", highContrast.value);

    // Apply color blind mode filter
    applyColorBlindFilter(colorBlindMode.value);

    // Store timestamp format for use in components
    root.setAttribute("data-timestamp-format", timestampFormat.value);
  };

  return {
    currentTheme: computed(() => currentTheme.value as ThemeId),
    applyTheme,
    applyAppearanceSettings,
  };
}

// Helper function to convert HEX to HSL
export function hexToHSL(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "240 5.9% 10%";

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  return `${h} ${s}% ${l}%`;
}

// Helper function to apply color blind filters
function applyColorBlindFilter(mode: string) {
  const root = document.documentElement;

  // Remove existing filter classes
  root.classList.remove(
    "colorblind-protanopia",
    "colorblind-deuteranopia",
    "colorblind-tritanopia"
  );

  // Apply appropriate filter
  if (mode !== "none") {
    root.classList.add(`colorblind-${mode}`);
  }
}
