/** One even-odd SVG fill shades only the area outside the crop, including rounded avatar crops. */
export function cropSpotlightPath(
  canvasWidth: number, canvasHeight: number,
  left: number, top: number, width: number, height: number, roundness: number,
): string {
  if (![canvasWidth, canvasHeight, left, top, width, height, roundness].every(Number.isFinite)) return '';
  const outer = 'M0 0H' + Math.max(0, canvasWidth) + 'V' + Math.max(0, canvasHeight) + 'H0Z';
  if (width <= 0 || height <= 0) return outer;
  const right = left + width, bottom = top + height;
  const r = Math.max(0, Math.min(roundness, width / 2, height / 2));
  return outer + ' M' + (left + r) + ' ' + top +
    'H' + (right - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + right + ' ' + (top + r) +
    'V' + (bottom - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (right - r) + ' ' + bottom +
    'H' + (left + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + left + ' ' + (bottom - r) +
    'V' + (top + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (left + r) + ' ' + top + 'Z';
}
