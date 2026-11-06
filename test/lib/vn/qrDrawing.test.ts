/**
 * The sign-in QR's geometry under vue-native (lib/vn/qrDrawing.ts): every dark module of the matrix
 * is drawn once, as a dot or as part of a finder pattern, except the ones under the logo; and each
 * dot takes the shape qr-code-styling's "extra-rounded" gives it.
 */

import { describe, test, expect } from "vitest";
import qrcode from "qrcode-generator";
import QRCodeStyling from "qr-code-styling";
import { drawQr, qrMatrix, type QrMatrix, type QrStyle } from "@/lib/vn/qrDrawing";

/** QRStyled's options: 220 px, margin 2, level M, the cat at 0.4 of what may be hidden. */
const SIGN_IN: QrStyle = { size: 220, margin: 2, level: "M", imageSize: 0.4, imageAspect: 1 };
const NO_LOGO: QrStyle = { ...SIGN_IN, imageSize: 0 };

/** What useQrLogin shows, salted the way QRStyled salts it. */
const VALUE = "https://argon.gl/link/9f3c2a71e4b84d0c8a6f5e2d1b7c9a30?_=k3j9x2";

/** The subpaths of a path, each with the points it passes through (move, line and arc ends). */
function figures(d: string): { x: number; y: number }[][] {
  return d
    .split("M")
    .filter(Boolean)
    .map((sub) => {
      const points: { x: number; y: number }[] = [];
      for (const [, cmd, args] of sub.matchAll(/([LAZ]?)([^LAZ]*)/g)) {
        const nums = args.trim().split(/\s+/).filter(Boolean).map(Number);
        if (nums.length >= 2 && cmd !== "Z") points.push({ x: nums.at(-2)!, y: nums.at(-1)! });
      }
      return points;
    });
}

function darkModules(m: QrMatrix, keep: (row: number, col: number) => boolean = () => true): number {
  let dark = 0;
  for (let row = 0; row < m.count; row++) for (let col = 0; col < m.count; col++) if (m.isDark(row, col) && keep(row, col)) dark++;
  return dark;
}

/** A finder pattern is 33 dark modules: the 7×7 border (24) and the 3×3 middle (9). */
const FINDER_DARK = 3 * 33;

describe("the matrix", () => {
  test("is qrcode-generator's, at the smallest version, in byte mode", () => {
    const qr = qrcode(0, "M");
    qr.addData(VALUE, "Byte");
    qr.make();
    const m = qrMatrix(VALUE, "M");

    expect(m.count).toBe(qr.getModuleCount());
    expect(m.count).toBe(37);
    for (let row = 0; row < m.count; row++) for (let col = 0; col < m.count; col++) expect(m.isDark(row, col)).toBe(qr.isDark(row, col));
  });
});

describe("the drawing", () => {
  const m = qrMatrix(VALUE, "M");

  test("lays the grid out the way qr-code-styling does", () => {
    const d = drawQr(m, SIGN_IN);
    // floor((220 - 4) / 37) = 5, and the 185 px grid is centred: floor((220 - 185) / 2) = 17.
    expect(d.dotSize).toBe(5);
    expect(d.offset).toBe(17);
    expect(d.gradient).toEqual({ cx: 110, cy: 110, r: 110 });
  });

  test("without a logo, every dark module is a dot or part of a finder pattern", () => {
    const d = drawQr(m, NO_LOGO);
    expect(d.image).toBeNull();
    expect(d.hidden).toBeNull();
    expect(figures(d.dots)).toHaveLength(darkModules(m) - FINDER_DARK);
    // A ring is two circles, a centre is one rounded square.
    expect(figures(d.cornerSquares)).toHaveLength(6);
    expect(figures(d.cornerDots)).toHaveLength(3);
  });

  test("with the logo, the centre is cleared and only the centre", () => {
    const d = drawQr(m, SIGN_IN);
    // floor(0.4 * 0.15 * 37²) = 82 modules may go; the largest odd square under that is 9 × 9.
    expect(d.hidden).toEqual({ top: 14, bottom: 23, left: 14, right: 23 });
    // 9 modules of 5 px, centred on the grid: 17 + floor((185 - 45) / 2) = 87.
    expect(d.image).toEqual({ x: 87, y: 87, width: 45, height: 45 });

    const h = d.hidden!;
    const under = (row: number, col: number) => row >= h.top && row < h.bottom && col >= h.left && col < h.right;
    expect(darkModules(m, under)).toBeGreaterThan(0);
    expect(figures(d.dots)).toHaveLength(darkModules(m) - FINDER_DARK - darkModules(m, under));

    // No dot touches the logo's square, inside or on its edge.
    const box = { x0: d.offset + h.left * d.dotSize, y0: d.offset + h.top * d.dotSize, x1: d.offset + h.right * d.dotSize, y1: d.offset + h.bottom * d.dotSize };
    for (const points of figures(d.dots)) {
      for (const { x, y } of points) expect(x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1).toBe(false);
    }
    // And the modules around it are still there: the drawing differs from the logo-less one by exactly the hidden ones.
    expect(figures(drawQr(m, NO_LOGO).dots).length - figures(d.dots).length).toBe(darkModules(m, under));
  });
});

/**
 * The corners of one of qr-code-styling's dot elements, as it lays them out: a `<circle>`, a
 * `<rect>`, or a `<path>` in relative commands turned by `rotate(deg,cx,cy)`.
 */
function theirFigure(element: string): string {
  const a: Record<string, string> = {};
  for (const [, k, v] of element.matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = v;
  let points: [number, number][];
  if (element.startsWith("<circle")) {
    points = [
      [+a.cx - +a.r, +a.cy],
      [+a.cx + +a.r, +a.cy],
    ];
  } else if (element.startsWith("<rect")) {
    const [x, y, w, h] = [+a.x, +a.y, +a.width, +a.height];
    points = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  } else {
    points = [];
    const tokens = a.d.match(/[a-zA-Z]|-?[\d.]+/g)!;
    let [x, y, i, cmd] = [0, 0, 0, ""];
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
      if (cmd === "z" || cmd === "Z") continue;
      if (cmd === "M") [x, y] = [+tokens[i++], +tokens[i++]];
      else if (cmd === "v") y += +tokens[i++];
      else if (cmd === "h") x += +tokens[i++];
      else if (cmd === "a") {
        i += 5;
        [x, y] = [x + +tokens[i++], y + +tokens[i++]];
      } else throw new Error(`unexpected "${cmd}" in ${a.d}`);
      points.push([x, y]);
    }
  }
  const rotate = a.transform?.match(/rotate\(([-\d.e]+),([-\d.e]+),([-\d.e]+)\)/);
  if (rotate) {
    const [rad, ox, oy] = [(+rotate[1] * Math.PI) / 180, +rotate[2], +rotate[3]];
    const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
    points = points.map(([x, y]) => [ox + (x - ox) * cos - (y - oy) * sin, oy + (x - ox) * sin + (y - oy) * cos]);
  }
  return cornerKey(points.map(([x, y]) => ({ x, y })));
}

const cornerKey = (points: { x: number; y: number }[]) =>
  [...new Set(points.map(({ x, y }) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`))].sort().join(" ");

describe("against qr-code-styling", () => {
  test("its own SVG of the same code has the same dots, figure for figure", async () => {
    const qr = new QRCodeStyling({
      type: "svg",
      shape: "square",
      width: 220,
      height: 220,
      margin: 2,
      data: VALUE,
      qrOptions: { typeNumber: 0, mode: "Byte", errorCorrectionLevel: "M" },
      dotsOptions: { type: "extra-rounded", roundSize: true, color: "#000" },
      cornersSquareOptions: { type: "dot", color: "#000" },
      cornersDotOptions: { type: "rounded", color: "#000" },
      backgroundOptions: { color: "transparent" },
    });
    const svg = await ((await qr.getRawData("svg")) as Blob).text();
    const clip = svg.match(/<clipPath id="clip-path-dot-color[^>]*>([\s\S]*?)<\/clipPath>/)![1];
    const theirs = clip.match(/<(circle|rect|path)\b[^>]*>/g)!.map(theirFigure).sort();

    const ours = figures(drawQr(qrMatrix(VALUE, "M"), NO_LOGO).dots).map(cornerKey).sort();
    expect(ours).toHaveLength(theirs.length);
    expect(ours).toEqual(theirs);
  });
});

describe("the shape of a dot", () => {
  /** A 21-module matrix with only the given modules dark. */
  const matrix = (...dark: [number, number][]): QrMatrix => ({
    count: 21,
    isDark: (row, col) => dark.some(([r, c]) => r === row && c === col),
  });
  // 21 modules of floor(216 / 21) = 10 px, starting at floor((220 - 210) / 2) = 5.
  const at = (row: number, col: number) => ({ x: 5 + col * 10, y: 5 + row * 10 });
  const corners = (row: number, col: number) => {
    const { x, y } = at(row, col);
    return { tl: { x, y }, tr: { x: x + 10, y }, br: { x: x + 10, y: y + 10 }, bl: { x, y: y + 10 } };
  };
  const has = (points: { x: number; y: number }[], p: { x: number; y: number }) => points.some((q) => q.x === p.x && q.y === p.y);
  const shapes = (m: QrMatrix) => figures(drawQr(m, NO_LOGO).dots);

  test("alone, a circle: no corner of its square", () => {
    const [dot] = shapes(matrix([10, 10]));
    const c = corners(10, 10);
    expect(Object.values(c).some((p) => has(dot, p))).toBe(false);
    expect(has(dot, { x: 105, y: 110 }) && has(dot, { x: 115, y: 110 })).toBe(true);
  });

  test("with one neighbour, its flat side faces it", () => {
    const [left, right] = shapes(matrix([10, 12], [10, 13]));
    const a = corners(10, 12);
    const b = corners(10, 13);
    expect([has(left, a.tr), has(left, a.br), has(left, a.tl), has(left, a.bl)]).toEqual([true, true, false, false]);
    expect([has(right, b.tl), has(right, b.bl), has(right, b.tr), has(right, b.br)]).toEqual([true, true, false, false]);

    const [top, bottom] = shapes(matrix([4, 10], [5, 10]));
    expect([has(top, corners(4, 10).bl), has(top, corners(4, 10).br), has(top, corners(4, 10).tl)]).toEqual([true, true, false]);
    expect([has(bottom, corners(5, 10).tl), has(bottom, corners(5, 10).tr), has(bottom, corners(5, 10).bl)]).toEqual([true, true, false]);
  });

  test("with two at a corner, only the far corner is rounded away", () => {
    // (14, 10) has (15, 10) below; (15, 10) has it above and (15, 11) to the right.
    const [, elbow] = shapes(matrix([14, 10], [15, 10], [15, 11]));
    const c = corners(15, 10);
    expect([has(elbow, c.tl), has(elbow, c.tr), has(elbow, c.br), has(elbow, c.bl)]).toEqual([true, true, true, false]);
  });

  test("between two in a line, a square", () => {
    const [, middle] = shapes(matrix([10, 9], [10, 10], [10, 11]));
    expect(Object.values(corners(10, 10)).every((p) => has(middle, p))).toBe(true);
  });

  test("a neighbour inside a finder pattern does not count", () => {
    // (6, 3) is the top-left finder's bottom edge: drawn by the ring, not as a dot.
    const dots = shapes(matrix([6, 3], [7, 3]));
    expect(dots).toHaveLength(1);
    expect(Object.values(corners(7, 3)).some((p) => has(dots[0], p))).toBe(false);
  });
});
