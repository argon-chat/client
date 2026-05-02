import bgBlackhole from "@argon/assets/backgrounds/blackhole.webm";
import bgDreamCity from "@argon/assets/backgrounds/dream_city.webm";
import bgRain from "@argon/assets/backgrounds/rain.webm";
import bgSakura from "@argon/assets/backgrounds/sakura.webm";
import bgShells from "@argon/assets/backgrounds/shells.webm";

export interface ProfileBackground {
  id: number;
  name: string;
  src: string;
}

export const PROFILE_BACKGROUNDS: ProfileBackground[] = [
  { id: 1, name: "Black Hole", src: bgBlackhole },
  { id: 2, name: "Dream City", src: bgDreamCity },
  { id: 3, name: "Rain", src: bgRain },
  { id: 4, name: "Sakura", src: bgSakura },
  { id: 5, name: "Shells", src: bgShells },
];

export function getBackgroundSrc(backgroundId: number | null | undefined): string | null {
  if (!backgroundId) return null;
  const bg = PROFILE_BACKGROUNDS.find(b => b.id === backgroundId);
  return bg?.src ?? null;
}

/**
 * Convert ARGB i32 to CSS rgba() string
 */
export function argbToRgba(argb: number): string {
  const a = ((argb >>> 24) & 0xff) / 255;
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}

/**
 * Convert ARGB i32 to CSS rgb() string (ignoring alpha)
 */
export function argbToRgb(argb: number): string {
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Convert hex color (#RRGGBB) to ARGB signed i32 with full opacity
 */
export function hexToArgb(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  // Use | 0 to get signed i32 (server expects signed Int32)
  return ((0xff << 24) | (r << 16) | (g << 8) | b) | 0;
}

/**
 * Convert ARGB i32 to hex string (#RRGGBB)
 */
export function argbToHex(argb: number): string {
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = argb & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Tailwind 500 preset palette as signed ARGB i32 values
 */
export const COLOR_PRESETS: { name: string; argb: number }[] = [
  { name: "Red", argb: 0xffef4444 | 0 },
  { name: "Orange", argb: 0xfff97316 | 0 },
  { name: "Amber", argb: 0xfff59e0b | 0 },
  { name: "Yellow", argb: 0xffeab308 | 0 },
  { name: "Lime", argb: 0xff84cc16 | 0 },
  { name: "Green", argb: 0xff22c55e | 0 },
  { name: "Teal", argb: 0xff14b8a6 | 0 },
  { name: "Cyan", argb: 0xff06b6d4 | 0 },
  { name: "Blue", argb: 0xff3b82f6 | 0 },
  { name: "Indigo", argb: 0xff6366f1 | 0 },
  { name: "Violet", argb: 0xff8b5cf6 | 0 },
  { name: "Purple", argb: 0xffa855f7 | 0 },
  { name: "Pink", argb: 0xffec4899 | 0 },
  { name: "Rose", argb: 0xfff43f5e | 0 },
];
