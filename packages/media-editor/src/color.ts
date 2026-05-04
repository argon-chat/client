/**
 * Parse a hex/hexa color string into RGBA components [0–255, 0–255, 0–255, 0–1].
 */
export function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const hasAlpha = hex.length === 8;
  const n = parseInt(hex.substring(0, 6), 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
    a: hasAlpha ? parseInt(hex.substring(6, 8), 16) / 255 : 1,
  };
}

/**
 * Convert a hex/hexa color to HSLA.
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number; a: number } {
  const { r, g, b, a } = parseHexColor(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100, a };
}

/**
 * Get a readable text color (white or black) depending on background luminance.
 */
export function contrastingTextColor(backgroundColor: string): '#ffffff' | '#000000' {
  return hexToHsl(backgroundColor).l < 80 ? '#ffffff' : '#000000';
}

/**
 * Convert hex color to an RGBA tuple for Canvas/WebGPU usage.
 */
export function hexToRgbaTuple(hex: string): [number, number, number, number] {
  const { r, g, b, a } = parseHexColor(hex);
  return [r, g, b, a];
}

