/**
 * The sign-in QR as SVG geometry, for vue-native, where qr-code-styling cannot draw.
 *
 * qr-code-styling builds its picture with `document.createElementNS`, serialises it with
 * XMLSerializer, paints that into a canvas 2D context through an `Image` loaded from a data: URL,
 * and fetches the logo over XMLHttpRequest. vue-native has none of those, so QRStyled.vue draws
 * the same code as a template `<svg>` from this geometry instead. Phase 2 item 8, "QR on sign-in".
 *
 * The geometry is qr-code-styling 1.9.2's for the options QRStyled passes (square shape,
 * `roundSize`, extra-rounded dots, "dot" corner squares, "rounded" corner dots, the logo with the
 * modules under it hidden), so the two read the same to a scanner and look the same to a person:
 * - module size is `floor((size - 2 * margin) / count)`, and the grid is centred with `floor`;
 * - the three finder patterns are not dots: each is a ring and a rounded 3×3 centre;
 * - the logo hides a centred block of modules, odd on each side, as large as `imageSize` times the
 *   error-correction share allows, and never wider than `count - 14`;
 * - a module's shape depends on its dark neighbours, the ones a finder or the logo hides not counted.
 *
 * Every path uses absolute commands only (M, L, A, Z), one subpath per figure.
 */
import qrcode from "qrcode-generator";

export type QrLevel = "L" | "M" | "Q" | "H";

/** The module matrix: `isDark(row, col)`, both in `[0, count)`. */
export interface QrMatrix {
  readonly count: number;
  isDark(row: number, col: number): boolean;
}

export interface QrStyle {
  /** Width and height of the picture, in px. */
  size: number;
  /** The quiet zone, in px. */
  margin: number;
  /** The error-correction level the code was made with: it bounds how much the logo may hide. */
  level: QrLevel;
  /** qr-code-styling's `imageOptions.imageSize`: the logo's share of what may be hidden. 0 for none. */
  imageSize: number;
  /** The logo's height over its width. */
  imageAspect: number;
}

/** A block of modules: rows `[top, bottom)`, columns `[left, right)`. */
export interface QrModuleRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface QrDrawing {
  size: number;
  count: number;
  /** One module, in px. */
  dotSize: number;
  /** Where the module grid starts, in px, on both axes. */
  offset: number;
  /** The data modules, extra-rounded, one subpath per module. */
  dots: string;
  /** The three finder rings, outer and inner circle each (fill-rule evenodd; also opposite windings). */
  cornerSquares: string;
  /** The three finder centres, a rounded square each. */
  cornerDots: string;
  /** The dots' radial gradient, in user space: qr-code-styling centres it on the picture. */
  gradient: { cx: number; cy: number; r: number };
  /** Where the logo goes, in px; null without one. */
  image: { x: number; y: number; width: number; height: number } | null;
  /** The modules the logo hides; null without one. */
  hidden: QrModuleRect | null;
}

/** The share of the code each level can lose and still be read (qr-code-styling's table). */
const RECOVERABLE: Record<QrLevel, number> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

/** The module matrix for `data`, the way qr-code-styling makes it: smallest version, byte mode. */
export function qrMatrix(data: string, level: QrLevel): QrMatrix {
  const qr = qrcode(0, level);
  qr.addData(data, "Byte");
  qr.make();
  return { count: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

export function drawQr(matrix: QrMatrix, style: QrStyle): QrDrawing {
  const { count } = matrix;
  const dotSize = Math.floor((style.size - style.margin * 2) / count);
  const offset = Math.floor((style.size - count * dotSize) / 2);
  const logo = style.imageSize > 0 ? logoSize(count, dotSize, style) : null;

  const hidden: QrModuleRect | null = logo && {
    top: Math.ceil((count - logo.yDots) / 2),
    bottom: Math.ceil((count + logo.yDots) / 2),
    left: Math.ceil((count - logo.xDots) / 2),
    right: Math.ceil((count + logo.xDots) / 2),
  };
  const shown = (row: number, col: number) =>
    row >= 0 &&
    col >= 0 &&
    row < count &&
    col < count &&
    !inFinder(row, col, count) &&
    !(hidden && row >= hidden.top && row < hidden.bottom && col >= hidden.left && col < hidden.right);
  const dark = (row: number, col: number) => shown(row, col) && matrix.isDark(row, col);

  const dots: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!dark(row, col)) continue;
      dots.push(
        extraRounded(offset + col * dotSize, offset + row * dotSize, dotSize, {
          left: dark(row, col - 1),
          right: dark(row, col + 1),
          top: dark(row - 1, col),
          bottom: dark(row + 1, col),
        }),
      );
    }
  }

  const squares: string[] = [];
  const centres: string[] = [];
  for (const [col, row] of FINDERS) {
    const x = offset + col * dotSize * (count - 7);
    const y = offset + row * dotSize * (count - 7);
    const half = (dotSize * 7) / 2;
    squares.push(circle(x + half, y + half, half, 1), circle(x + half, y + half, half - dotSize, 0));
    centres.push(roundedSquare(x + dotSize * 2, y + dotSize * 2, dotSize * 3, dotSize / 2));
  }

  return {
    size: style.size,
    count,
    dotSize,
    offset,
    dots: dots.join(""),
    cornerSquares: squares.join(""),
    cornerDots: centres.join(""),
    gradient: { cx: style.size / 2, cy: style.size / 2, r: style.size / 2 },
    image: logo && {
      x: offset + Math.floor((count * dotSize - logo.width) / 2),
      y: offset + Math.floor((count * dotSize - logo.height) / 2),
      width: logo.width,
      height: logo.height,
    },
    hidden,
  };
}

/** The finder patterns' corners, as qr-code-styling lists them: [column, row] in units of count - 7. */
const FINDERS = [
  [0, 0],
  [1, 0],
  [0, 1],
] as const;

/**
 * Is this module part of a finder pattern's ring or centre? qr-code-styling's square and dot masks:
 * the 7×7 border and the 3×3 middle, at the top-left, the bottom-left and the top-right.
 */
function inFinder(row: number, col: number, count: number): boolean {
  const masked = (r: number, c: number) =>
    r >= 0 && r < 7 && c >= 0 && c < 7 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
  return masked(row, col) || masked(row - count + 7, col) || masked(row, col - count + 7);
}

/** qr-code-styling's calculateImageSize, kept line for line (its one quirk included). */
function logoSize(count: number, dotSize: number, style: QrStyle) {
  const maxHiddenDots = Math.floor(style.imageSize * RECOVERABLE[style.level] * count * count);
  const maxHiddenAxisDots = count - 14;
  const k = style.imageAspect;
  if (k <= 0 || maxHiddenDots <= 0 || dotSize <= 0) return null;

  let xDots = Math.floor(Math.sqrt(maxHiddenDots / k));
  if (xDots <= 0) xDots = 1;
  if (maxHiddenAxisDots && maxHiddenAxisDots < xDots) xDots = maxHiddenAxisDots;
  if (xDots % 2 === 0) xDots--;
  let width = xDots * dotSize;
  let yDots = 1 + 2 * Math.ceil((xDots * k - 1) / 2);
  let height = Math.round(width * k);
  if (yDots * xDots > maxHiddenDots || (maxHiddenAxisDots && maxHiddenAxisDots < yDots)) {
    if (maxHiddenAxisDots && maxHiddenAxisDots < yDots) {
      yDots = maxHiddenAxisDots;
      if (yDots % 2 === 0) xDots--;
    } else {
      yDots -= 2;
    }
    height = yDots * dotSize;
    xDots = 1 + 2 * Math.ceil((yDots / k - 1) / 2);
    width = Math.round(height / k);
  }
  return { xDots, yDots, width, height };
}

type Neighbours = { left: boolean; right: boolean; top: boolean; bottom: boolean };

/**
 * qr-code-styling's "extra-rounded" dot: alone, a circle; between two in a line or with three or
 * more, a square; with two at a corner, a quarter disc whose square corner joins them; with one, a
 * half-rounded square whose flat side faces it.
 */
function extraRounded(x: number, y: number, s: number, near: Neighbours): string {
  const many = +near.left + +near.right + +near.top + +near.bottom;
  if (many === 0) return circle(x + s / 2, y + s / 2, s / 2, 0);
  if (many > 2 || (near.left && near.right) || (near.top && near.bottom)) return `M${p(x, y)}L${p(x + s, y)}L${p(x + s, y + s)}L${p(x, y + s)}Z`;
  if (many === 2) {
    // Drawn with its square corner at the bottom left, then turned to where the neighbours are.
    const turns = near.left && near.top ? 1 : near.top && near.right ? 2 : near.right && near.bottom ? 3 : 0;
    const at = turn(x, y, s, turns);
    return `M${at(x, y)}L${at(x, y + s)}L${at(x + s, y + s)}A${n(s)} ${n(s)} 0 0 0 ${at(x, y)}Z`;
  }
  // Drawn flat on the left, then turned to where the neighbour is.
  const turns = near.top ? 1 : near.right ? 2 : near.bottom ? 3 : 0;
  const at = turn(x, y, s, turns);
  return `M${at(x, y)}L${at(x, y + s)}L${at(x + s / 2, y + s)}A${n(s / 2)} ${n(s / 2)} 0 0 0 ${at(x + s / 2, y)}Z`;
}

/** Points of the module at (x, y), turned clockwise by `turns` quarter turns about its centre. */
function turn(x: number, y: number, s: number, turns: number) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  return (px: number, py: number) => {
    let dx = px - cx;
    let dy = py - cy;
    for (let i = 0; i < turns; i++) [dx, dy] = [-dy, dx];
    return p(cx + dx, cy + dy);
  };
}

/** A full circle as two half arcs, from its leftmost point; `sweep` picks the winding. */
function circle(cx: number, cy: number, r: number, sweep: 0 | 1): string {
  return `M${p(cx - r, cy)}A${n(r)} ${n(r)} 0 1 ${sweep} ${p(cx + r, cy)}A${n(r)} ${n(r)} 0 1 ${sweep} ${p(cx - r, cy)}Z`;
}

function roundedSquare(x: number, y: number, s: number, r: number): string {
  const a = `A${n(r)} ${n(r)} 0 0 1 `;
  return (
    `M${p(x + r, y)}L${p(x + s - r, y)}${a}${p(x + s, y + r)}L${p(x + s, y + s - r)}${a}${p(x + s - r, y + s)}` +
    `L${p(x + r, y + s)}${a}${p(x, y + s - r)}L${p(x, y + r)}${a}${p(x + r, y)}Z`
  );
}

function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function p(x: number, y: number): string {
  return `${n(x)} ${n(y)}`;
}
