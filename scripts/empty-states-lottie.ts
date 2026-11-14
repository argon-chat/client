/**
 * Converts the animated empty-state SVGs into Lottie, for the native app.
 *
 * Skathi draws an inline <svg> as one raster and runs no CSS animation inside it, so the artwork
 * of components/shared/EmptyStateArt.vue cannot move there. Its native twin, EmptyStateLottie.vue,
 * plays these files on <lottie> instead (ThorVG, on a worker thread). The SVGs stay the source: the
 * web keeps playing them, and this script is re-run whenever one changes.
 *
 *   bun run lottie:empty-states
 *
 * What it understands is what the artwork uses, nothing more:
 *
 *   - <g>, <rect>, <circle>, <ellipse>, <line>, <path>, <text>; a radial gradient fill; clip-path and
 *     luminance masks; presentation attributes, inline style and the `.es-svg .class` rules;
 *   - @keyframes on transform (translate, scale, rotate), opacity, fill, stroke and
 *     stroke-dashoffset, with cubic-bezier and steps timing, delays, `both`/`forwards`, `infinite`
 *     and `alternate`; transform-box fill-box/view-box and transform-origin.
 *
 * The output, per artwork:
 *
 *   - each <g> is a null layer carrying its transform, children parented to it;
 *   - each shape is a shape layer of its own, so a mask can sit on it; an ancestor's opacity, which
 *     parenting does not pass on, wraps the shape as a group;
 *   - circles and rects are written as paths starting where SVG starts them, so dashes keep their
 *     phase; text is outlined from the bundled Inter;
 *   - an infinite animation is one cycle of keyframes with `loopOut('cycle')` (ThorVG runs the
 *     expression), so loops of different periods need no common multiple;
 *   - every colour drawn from the theme (`var(--es-…, #hex)`) carries an `_es` marker naming the
 *     token. EmptyStateLottie.vue writes the resolved colour in and strips the markers, so the
 *     accent and the light/dark/OLED surfaces apply as they do to the SVG.
 *
 * Anything else is reported, and the file is still written with what could be drawn.
 */
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";

const ROOT = path.join(import.meta.dir, "..");
const SRC = path.join(ROOT, "src", "styles", "empty-states");
const OUT = path.join(SRC, "lottie");
const FONTS = path.join(ROOT, "packages", "assets", "fonts", "Inter", "static");

const FPS = 60;
/**
 * The comp's length. The loops run on expressions, so this only says how often the intro replays:
 * the player loops the comp, once an hour.
 */
const OUT_POINT = FPS * 3600;

let warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

// ------------------------------------------------------------------------------------------------
// XML
// ------------------------------------------------------------------------------------------------

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: El[];
  text: string;
  parent?: El;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseXml(src: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [], text: "" };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m: RegExpExecArray | null; (m = re.exec(src)); ) {
    if (m[1]) {
      cur = cur.parent ?? root;
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      for (const a of m[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
      const el: El = { tag: m[2], attrs, children: [], text: "", parent: cur };
      cur.children.push(el);
      if (!m[4]) cur = el;
    } else if (m[5] && cur !== root) {
      cur.text += decodeEntities(m[5]);
    }
  }
  return root.children.find((c) => c.tag === "svg")!;
}

// ------------------------------------------------------------------------------------------------
// CSS
// ------------------------------------------------------------------------------------------------

type Decls = Record<string, string>;

/** Splits on `sep` outside parentheses. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter((p) => p.length);
}

function parseDecls(body: string): Decls {
  const d: Decls = {};
  for (const part of splitTop(body, ";")) {
    const i = part.indexOf(":");
    if (i > 0) d[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/\s*!important$/, "");
  }
  return d;
}

/** Top-level `prelude { body }` blocks, nested braces kept in the body. */
function blocks(css: string): { prelude: string; body: string }[] {
  const out: { prelude: string; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    for (; j < css.length && depth; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
    }
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

interface Keyframe {
  offset: number;
  decls: Decls;
}

interface Sheet {
  /** class → declarations, in source order. */
  rules: { cls: string; decls: Decls }[];
  keyframes: Record<string, Keyframe[]>;
}

function parseSheet(css: string): Sheet {
  const sheet: Sheet = { rules: [], keyframes: {} };
  for (const b of blocks(css)) {
    const kf = b.prelude.match(/^@keyframes\s+([\w-]+)$/);
    if (kf) {
      const frames: Keyframe[] = [];
      for (const f of blocks(b.body)) {
        const decls = parseDecls(f.body);
        for (const sel of f.prelude.split(",")) {
          const s = sel.trim();
          const offset = s === "from" ? 0 : s === "to" ? 1 : parseFloat(s) / 100;
          frames.push({ offset, decls });
        }
      }
      sheet.keyframes[kf[1]] = frames;
      continue;
    }
    for (const sel of b.prelude.split(",")) {
      const m = sel.trim().match(/^\.es-svg\s+\.([\w-]+)$/);
      if (m) sheet.rules.push({ cls: m[1], decls: parseDecls(b.body) });
      else warn(`selector not understood: ${sel.trim()}`);
    }
  }
  return sheet;
}

// ------------------------------------------------------------------------------------------------
// Colours
// ------------------------------------------------------------------------------------------------

type RGBA = [number, number, number, number];

/** A colour as drawn: a theme token (resolved at run time) and the hex it falls back to. */
interface Color {
  token?: string;
  rgba: RGBA;
}

const NAMED: Record<string, string> = { white: "#fff", black: "#000" };

function hexToRgba(hex: string): RGBA {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
}

function parseColor(raw: string | undefined): Color | "none" | { gradient: string } | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (v === "none" || v === "transparent") return "none";
  const url = v.match(/^url\(#([\w-]+)\)/);
  if (url) return { gradient: url[1] };
  const tok = v.match(/^var\(--(es-[\w-]+)\s*,\s*([^)]+)\)$/);
  if (tok) return { token: tok[1], rgba: hexToRgba(NAMED[tok[2].trim()] ?? tok[2].trim()) };
  if (v.startsWith("#")) return { rgba: hexToRgba(v) };
  if (NAMED[v]) return { rgba: hexToRgba(NAMED[v]) };
  warn(`colour not understood: ${v}`);
  return undefined;
}

// ------------------------------------------------------------------------------------------------
// Geometry
// ------------------------------------------------------------------------------------------------

/** 2D affine, SVG order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const DEG = Math.PI / 180;

/** An SVG `transform` attribute. */
function parseTransformAttr(s: string | undefined): Mat {
  let m = IDENTITY;
  if (!s) return m;
  for (const f of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = f[2].split(/[\s,]+/).filter(Boolean).map(Number);
    switch (f[1]) {
      case "translate":
        m = mul(m, [1, 0, 0, 1, a[0], a[1] ?? 0]);
        break;
      case "scale":
        m = mul(m, [a[0], 0, 0, a[1] ?? a[0], 0, 0]);
        break;
      case "rotate": {
        const r = a[0] * DEG;
        const rot: Mat = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        if (a.length === 3) m = mul(mul(mul(m, [1, 0, 0, 1, a[1], a[2]]), rot), [1, 0, 0, 1, -a[1], -a[2]]);
        else m = mul(m, rot);
        break;
      }
      case "skewX":
        m = mul(m, [1, 0, Math.tan(a[0] * DEG), 1, 0, 0]);
        break;
      case "skewY":
        m = mul(m, [1, Math.tan(a[0] * DEG), 0, 1, 0, 0]);
        break;
      case "matrix":
        m = mul(m, a as Mat);
        break;
      default:
        warn(`transform function not understood: ${f[1]}`);
    }
  }
  return m;
}

/** A vertex with absolute control points. */
interface Vtx {
  x: number;
  y: number;
  ix: number;
  iy: number;
  ox: number;
  oy: number;
}
interface Sub {
  closed: boolean;
  v: Vtx[];
}

const vtx = (x: number, y: number): Vtx => ({ x, y, ix: x, iy: y, ox: x, oy: y });

class PathBuilder {
  subs: Sub[] = [];
  private cur: Sub | null = null;
  x = 0;
  y = 0;
  private sx = 0;
  private sy = 0;

  moveTo(x: number, y: number) {
    this.cur = { closed: false, v: [vtx(x, y)] };
    this.subs.push(this.cur);
    this.x = this.sx = x;
    this.y = this.sy = y;
  }
  lineTo(x: number, y: number) {
    if (!this.cur) this.moveTo(this.x, this.y);
    this.cur!.v.push(vtx(x, y));
    this.x = x;
    this.y = y;
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    if (!this.cur) this.moveTo(this.x, this.y);
    const last = this.cur!.v[this.cur!.v.length - 1];
    last.ox = x1;
    last.oy = y1;
    this.cur!.v.push({ x, y, ix: x2, iy: y2, ox: x, oy: y });
    this.x = x;
    this.y = y;
  }
  quadTo(qx: number, qy: number, x: number, y: number) {
    const x0 = this.x;
    const y0 = this.y;
    this.cubicTo(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
  }
  /** SVG's endpoint arc, as at most 90° cubic pieces. */
  arcTo(rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x: number, y: number) {
    const x1 = this.x;
    const y1 = this.y;
    if (rx === 0 || ry === 0 || (x1 === x && y1 === y)) return this.lineTo(x, y);
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const p = phi * DEG;
    const cos = Math.cos(p);
    const sin = Math.sin(p);
    const dx = (x1 - x) / 2;
    const dy = (y1 - y) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
    const step = dt / n;
    const k = (4 / 3) * Math.tan(step / 4);
    const point = (t: number): [number, number] => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
    const deriv = (t: number): [number, number] => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
    for (let i = 0; i < n; i++) {
      const a = t1 + i * step;
      const b = a + step;
      const [ax, ay] = point(a);
      const [bx, by] = i === n - 1 ? [x, y] : point(b);
      const [dax, day] = deriv(a);
      const [dbx, dby] = deriv(b);
      this.cubicTo(ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by);
    }
  }
  close() {
    if (!this.cur) return;
    const v = this.cur.v;
    const first = v[0];
    const last = v[v.length - 1];
    if (v.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
      first.ix = last.ix;
      first.iy = last.iy;
      v.pop();
    }
    this.cur.closed = true;
    this.x = this.sx;
    this.y = this.sy;
    this.cur = null;
  }
}

function parsePathData(d: string): Sub[] {
  const b = new PathBuilder();
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  const num = () => parseFloat(tokens[i++]);
  const flag = () => tokens[i++] === "1";
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? b.x : 0;
    const oy = rel ? b.y : 0;
    const C = cmd.toUpperCase();
    let nextC: [number, number] | null = null;
    let nextQ: [number, number] | null = null;
    switch (C) {
      case "M":
        b.moveTo(ox + num(), oy + num());
        cmd = rel ? "l" : "L";
        break;
      case "L":
        b.lineTo(ox + num(), oy + num());
        break;
      case "H":
        b.lineTo(ox + num(), b.y);
        break;
      case "V":
        b.lineTo(b.x, oy + num());
        break;
      case "C": {
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
        b.cubicTo(x1, y1, x2, y2, x, y);
        nextC = [x2, y2];
        break;
      }
      case "S": {
        const [rx, ry] = lastC ? [2 * b.x - lastC[0], 2 * b.y - lastC[1]] : [b.x, b.y];
        const x2 = ox + num(), y2 = oy + num(), x = ox + num(), y = oy + num();
        b.cubicTo(rx, ry, x2, y2, x, y);
        nextC = [x2, y2];
        break;
      }
      case "Q": {
        const qx = ox + num(), qy = oy + num(), x = ox + num(), y = oy + num();
        b.quadTo(qx, qy, x, y);
        nextQ = [qx, qy];
        break;
      }
      case "T": {
        const [qx, qy] = lastQ ? [2 * b.x - lastQ[0], 2 * b.y - lastQ[1]] : [b.x, b.y];
        const x = ox + num(), y = oy + num();
        b.quadTo(qx, qy, x, y);
        nextQ = [qx, qy];
        break;
      }
      case "A": {
        const rx = num(), ry = num(), phi = num(), large = flag(), sweep = flag(), x = ox + num(), y = oy + num();
        b.arcTo(rx, ry, phi, large, sweep, x, y);
        break;
      }
      case "Z":
        b.close();
        break;
      default:
        warn(`path command not understood: ${cmd}`);
        i++;
    }
    lastC = nextC;
    lastQ = nextQ;
  }
  return b.subs;
}

/** An ellipse as SVG draws it: from (cx+rx, cy), the angle increasing (clockwise on screen). */
function ellipseSubs(cx: number, cy: number, rx: number, ry: number): Sub[] {
  const b = new PathBuilder();
  b.moveTo(cx + rx, cy);
  b.arcTo(rx, ry, 0, false, true, cx, cy + ry);
  b.arcTo(rx, ry, 0, false, true, cx - rx, cy);
  b.arcTo(rx, ry, 0, false, true, cx, cy - ry);
  b.arcTo(rx, ry, 0, false, true, cx + rx, cy);
  b.close();
  return b.subs;
}

/** A rect as SVG draws it: from (x+rx, y), clockwise. */
function rectSubs(x: number, y: number, w: number, h: number, rx: number, ry: number): Sub[] {
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  const b = new PathBuilder();
  b.moveTo(x + rx, y);
  b.lineTo(x + w - rx, y);
  if (rx || ry) b.arcTo(rx, ry, 0, false, true, x + w, y + ry);
  b.lineTo(x + w, y + h - ry);
  if (rx || ry) b.arcTo(rx, ry, 0, false, true, x + w - rx, y + h);
  b.lineTo(x + rx, y + h);
  if (rx || ry) b.arcTo(rx, ry, 0, false, true, x, y + h - ry);
  b.lineTo(x, y + ry);
  if (rx || ry) b.arcTo(rx, ry, 0, false, true, x + rx, y);
  b.close();
  return b.subs;
}

function transformSubs(subs: Sub[], m: Mat): Sub[] {
  return subs.map((s) => ({
    closed: s.closed,
    v: s.v.map((p) => {
      const [x, y] = apply(m, p.x, p.y);
      const [ix, iy] = apply(m, p.ix, p.iy);
      const [ox, oy] = apply(m, p.ox, p.oy);
      return { x, y, ix, iy, ox, oy };
    }),
  }));
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function bboxOf(subs: Sub[]): Box | null {
  let b: Box | null = null;
  for (const s of subs)
    for (const p of s.v)
      for (const [x, y] of [[p.x, p.y], [p.ix, p.iy], [p.ox, p.oy]] as const) {
        if (!b) b = { x0: x, y0: y, x1: x, y1: y };
        else {
          b.x0 = Math.min(b.x0, x);
          b.y0 = Math.min(b.y0, y);
          b.x1 = Math.max(b.x1, x);
          b.y1 = Math.max(b.y1, y);
        }
      }
  return b;
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function lottiePath(s: Sub) {
  return {
    c: s.closed,
    v: s.v.map((p) => [r3(p.x), r3(p.y)]),
    i: s.v.map((p) => [r3(p.ix - p.x), r3(p.iy - p.y)]),
    o: s.v.map((p) => [r3(p.ox - p.x), r3(p.oy - p.y)]),
  };
}

// ------------------------------------------------------------------------------------------------
// Text
// ------------------------------------------------------------------------------------------------

const fontCache = new Map<number, opentype.Font>();
const WEIGHTS: Record<number, string> = {
  100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black",
};

function interFont(weight: number): opentype.Font {
  const w = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  let f = fontCache.get(w);
  if (!f) {
    const buf = fs.readFileSync(path.join(FONTS, `Inter_18pt-${WEIGHTS[w]}.ttf`));
    f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    fontCache.set(w, f);
  }
  return f;
}

function textSubs(text: string, x: number, y: number, style: Decls): Sub[] {
  const size = parseFloat(style["font-size"] ?? "16");
  const w = style["font-weight"];
  const weight = w === "bold" ? 700 : w === "normal" || !w ? 400 : parseInt(w, 10);
  const spacing = parseFloat(style["letter-spacing"] ?? "0") || 0;
  const font = interFont(weight);
  const scale = size / font.unitsPerEm;
  const glyphs = [...text].map((ch) => {
    const g = font.charToGlyph(ch);
    if (!g || g.index === 0) warn(`Inter has no glyph for ${JSON.stringify(ch)}`);
    return g;
  });
  // A browser adds letter-spacing after every character, the last included.
  const width = glyphs.reduce((sum, g) => sum + (g.advanceWidth ?? 0) * scale + spacing, 0);
  const anchor = style["text-anchor"];
  let pen = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const b = new PathBuilder();
  for (const g of glyphs) {
    for (const c of g.getPath(pen, y, size).commands) {
      if (c.type === "M") b.moveTo(c.x, c.y);
      else if (c.type === "L") b.lineTo(c.x, c.y);
      else if (c.type === "Q") b.quadTo(c.x1, c.y1, c.x, c.y);
      else if (c.type === "C") b.cubicTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
      else if (c.type === "Z") b.close();
    }
    pen += (g.advanceWidth ?? 0) * scale + spacing;
  }
  return b.subs;
}

// ------------------------------------------------------------------------------------------------
// The cascade
// ------------------------------------------------------------------------------------------------

const INHERITED = new Set([
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "stroke-opacity", "fill-opacity", "fill-rule", "font-family", "font-size", "font-weight", "text-anchor",
  "letter-spacing", "color", "stroke-miterlimit",
]);
const PRESENTATION = new Set([...INHERITED, "opacity", "transform-origin", "clip-path", "mask"]);

/** The element's own declarations: presentation attributes, then class rules, then inline style. */
function ownDecls(el: El, sheet: Sheet): Decls {
  const d: Decls = {};
  for (const [k, v] of Object.entries(el.attrs)) if (PRESENTATION.has(k)) d[k] = v;
  const classes = (el.attrs.class ?? "").split(/\s+/).filter(Boolean);
  for (const r of sheet.rules) if (classes.includes(r.cls)) Object.assign(d, r.decls);
  if (el.attrs.style) Object.assign(d, parseDecls(el.attrs.style));
  return d;
}

/** Computed style: inherited properties and custom properties from the parent, then the own. */
function computed(el: El, sheet: Sheet, parent: Decls | null): Decls {
  const d: Decls = {};
  if (parent) for (const [k, v] of Object.entries(parent)) if (INHERITED.has(k) || k.startsWith("--")) d[k] = v;
  return Object.assign(d, ownDecls(el, sheet));
}

/** Substitutes `var(--x, fallback)` for anything but the theme's colour tokens. */
function resolveVars(v: string, style: Decls): string {
  return v.replace(/var\(--([\w-]+)\s*(?:,\s*([^()]*(?:\([^)]*\))?[^()]*))?\)/g, (m, name: string, fallback?: string) => {
    if (name.startsWith("es-")) return m;
    return style[`--${name}`] ?? fallback?.trim() ?? m;
  });
}

// ------------------------------------------------------------------------------------------------
// Animations
// ------------------------------------------------------------------------------------------------

type Ease = { kind: "bezier"; x1: number; y1: number; x2: number; y2: number } | { kind: "steps"; n: number; start: boolean };

const NAMED_EASE: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

function parseEase(s: string): Ease | null {
  const t = s.trim();
  if (NAMED_EASE[t]) {
    const [x1, y1, x2, y2] = NAMED_EASE[t];
    return { kind: "bezier", x1, y1, x2, y2 };
  }
  const cb = t.match(/^cubic-bezier\(([^)]*)\)$/);
  if (cb) {
    const [x1, y1, x2, y2] = cb[1].split(",").map(Number);
    return { kind: "bezier", x1, y1, x2, y2 };
  }
  const st = t.match(/^steps\(\s*(\d+)\s*(?:,\s*([\w-]+))?\s*\)$/);
  if (st) return { kind: "steps", n: +st[1], start: st[2] === "start" || st[2] === "jump-start" };
  if (t === "step-start") return { kind: "steps", n: 1, start: true };
  if (t === "step-end") return { kind: "steps", n: 1, start: false };
  return null;
}

/** The eased progress of an ease at linear progress x. */
function evalEase(e: Ease, x: number): number {
  if (e.kind === "steps") {
    const s = e.start ? Math.ceil(x * e.n) : Math.floor(x * e.n);
    return Math.min(1, Math.max(0, s / e.n));
  }
  const bx = (t: number) => 3 * e.x1 * t * (1 - t) ** 2 + 3 * e.x2 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * e.y1 * t * (1 - t) ** 2 + 3 * e.y2 * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

interface Anim {
  name: string;
  duration: number;
  delay: number;
  ease: Ease;
  infinite: boolean;
  count: number;
  alternate: boolean;
  fillBackwards: boolean;
  fillForwards: boolean;
}

function seconds(s: string): number {
  return s.endsWith("ms") ? parseFloat(s) / 1000 : parseFloat(s);
}

function parseAnimations(style: Decls): Anim[] {
  const list = splitTop(style.animation ?? "", ",").map((one) => {
    const a: Anim = { name: "", duration: 0, delay: 0, ease: parseEase("ease")!, infinite: false, count: 1, alternate: false, fillBackwards: false, fillForwards: false };
    let times = 0;
    for (const tok of splitTop(one, " ")) {
      if (/^-?[\d.]+m?s$/.test(tok)) {
        if (times++ === 0) a.duration = seconds(tok);
        else a.delay = seconds(tok);
      } else if (parseEase(tok)) a.ease = parseEase(tok)!;
      else if (tok === "infinite") a.infinite = true;
      else if (/^[\d.]+$/.test(tok)) a.count = +tok;
      else if (tok === "alternate" || tok === "alternate-reverse") a.alternate = true;
      else if (tok === "both") a.fillBackwards = a.fillForwards = true;
      else if (tok === "forwards") a.fillForwards = true;
      else if (tok === "backwards") a.fillBackwards = true;
      else if (tok === "normal" || tok === "none" || tok === "running") continue;
      else if (tok === "reverse" || tok === "alternate-reverse") warn(`animation direction ${tok} not supported`);
      else a.name = tok;
    }
    return a;
  });
  const longhand = (prop: string, set: (a: Anim, v: string) => void) => {
    if (style[prop] === undefined) return;
    const values = splitTop(style[prop], ",");
    list.forEach((a, i) => set(a, values[i % values.length]));
  };
  longhand("animation-delay", (a, v) => (a.delay = seconds(v)));
  longhand("animation-duration", (a, v) => (a.duration = seconds(v)));
  return list.filter((a) => a.name && a.duration > 0);
}

/** One animated property of one animation: its keyframes, implicit ends filled in from `base`. */
interface Track {
  prop: string;
  anim: Anim;
  keys: { offset: number; value: string; ease: Ease }[];
}

const ANIMATABLE = ["transform", "opacity", "fill", "stroke", "stroke-dashoffset"];

function tracksFor(el: El, style: Decls, sheet: Sheet, base: (prop: string) => string): Map<string, Track> {
  const out = new Map<string, Track>();
  for (const anim of parseAnimations(style)) {
    const frames = sheet.keyframes[anim.name];
    if (!frames) {
      warn(`<${el.tag} class="${el.attrs.class}"> names @keyframes ${anim.name}, which is not defined (a browser ignores it too)`);
      continue;
    }
    const props = new Set<string>();
    for (const f of frames) for (const p of Object.keys(f.decls)) props.add(p);
    for (const prop of props) {
      if (prop === "animation-timing-function") continue;
      if (!ANIMATABLE.includes(prop)) {
        warn(`@keyframes ${anim.name} animates ${prop}, which is not converted`);
        continue;
      }
      const byOffset = new Map<number, { value: string; ease: Ease }>();
      for (const f of frames) {
        if (f.decls[prop] === undefined) continue;
        const ease = (f.decls["animation-timing-function"] && parseEase(f.decls["animation-timing-function"])) || anim.ease;
        byOffset.set(f.offset, { value: resolveVars(f.decls[prop], style), ease });
      }
      if (!byOffset.has(0)) byOffset.set(0, { value: base(prop), ease: anim.ease });
      if (!byOffset.has(1)) byOffset.set(1, { value: base(prop), ease: anim.ease });
      const keys = [...byOffset.entries()].sort((a, b) => a[0] - b[0]).map(([offset, k]) => ({ offset, ...k }));
      // The last animation in the list wins a property it shares with an earlier one.
      out.set(prop, { prop, anim, keys });
    }
  }
  return out;
}

// --- transform values -----------------------------------------------------------------------------

type TFn = { fn: string; args: number[] };

function parseLength(s: string): number {
  return parseFloat(s);
}

function parseAngle(s: string): number {
  if (s.endsWith("turn")) return parseFloat(s) * 360;
  if (s.endsWith("rad")) return parseFloat(s) / DEG;
  return parseFloat(s);
}

function parseCssTransform(s: string): TFn[] {
  if (!s || s === "none") return [];
  const out: TFn[] = [];
  for (const f of s.matchAll(/([\w]+)\(([^)]*)\)/g)) {
    const args = f[2].split(",").map((a) => a.trim());
    switch (f[1]) {
      case "translate":
        out.push({ fn: "translate", args: [parseLength(args[0]), args[1] ? parseLength(args[1]) : 0] });
        break;
      case "translateX":
        out.push({ fn: "translate", args: [parseLength(args[0]), 0] });
        break;
      case "translateY":
        out.push({ fn: "translate", args: [0, parseLength(args[0])] });
        break;
      case "scale":
        out.push({ fn: "scale", args: [parseFloat(args[0]), args[1] ? parseFloat(args[1]) : parseFloat(args[0])] });
        break;
      case "scaleX":
        out.push({ fn: "scale", args: [parseFloat(args[0]), 1] });
        break;
      case "scaleY":
        out.push({ fn: "scale", args: [1, parseFloat(args[0])] });
        break;
      case "rotate":
        out.push({ fn: "rotate", args: [parseAngle(args[0])] });
        break;
      default:
        warn(`CSS transform function not converted: ${f[1]}`);
    }
  }
  return out;
}

const IDENTITY_ARGS: Record<string, number[]> = { translate: [0, 0], scale: [1, 1], rotate: [0] };

/** CSS interpolation of two function lists: argument-wise when they line up, else by end values. */
function lerpTransform(a: TFn[], b: TFn[], u: number): TFn[] {
  if (!a.length) a = b.map((f) => ({ fn: f.fn, args: IDENTITY_ARGS[f.fn] }));
  if (!b.length) b = a.map((f) => ({ fn: f.fn, args: IDENTITY_ARGS[f.fn] }));
  const same = a.length === b.length && a.every((f, i) => f.fn === b[i].fn);
  if (!same) return u < 0.5 ? a : b;
  return a.map((f, i) => ({ fn: f.fn, args: f.args.map((v, j) => v + (b[i].args[j] - v) * u) }));
}

/** A function list as Lottie's position/scale/rotation about the origin `o`. */
function toChannels(fns: TFn[], o: [number, number]) {
  let m = IDENTITY;
  let sx = 1;
  let sy = 1;
  let rot = 0;
  for (const f of fns) {
    if (f.fn === "translate") m = mul(m, [1, 0, 0, 1, f.args[0], f.args[1]]);
    else if (f.fn === "scale") {
      m = mul(m, [f.args[0], 0, 0, f.args[1], 0, 0]);
      sx *= f.args[0];
      sy *= f.args[1];
    } else if (f.fn === "rotate") {
      const r = f.args[0] * DEG;
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
      rot += f.args[0];
    }
  }
  return { p: [o[0] + m[4], o[1] + m[5]], s: [sx * 100, sy * 100], r: rot };
}

// ------------------------------------------------------------------------------------------------
// Lottie keyframes
// ------------------------------------------------------------------------------------------------

type Value = number[];
interface LKey {
  t: number;
  s: Value;
  h?: 1;
  o?: { x: number[]; y: number[] };
  i?: { x: number[]; y: number[] };
  _es?: string;
}

/** One emitted channel: keyframes, and whether it loops. */
interface Channel {
  keys: LKey[];
  loop: boolean;
}

const frame = (sec: number) => r3(sec * FPS);

function easeTangents(e: Ease, reverse: boolean) {
  if (e.kind !== "bezier") return {};
  let { x1, y1, x2, y2 } = e;
  if (reverse) [x1, y1, x2, y2] = [1 - x2, 1 - y2, 1 - x1, 1 - y1];
  return { o: { x: [r3(x1)], y: [r3(y1)] }, i: { x: [r3(x2)], y: [r3(y2)] } };
}

/**
 * Lays a track's keyframes on the comp's timeline. `values(i)` gives the Lottie value of key i
 * (or of an interpolated state, through `at`); a segment whose value is not linear in its eased
 * progress (`needsSampling`) is written as linear sub-keyframes instead.
 */
function emitTrack<T>(
  track: Track,
  parse: (raw: string) => T,
  toValue: (v: T) => Value,
  lerp: (a: T, b: T, u: number) => T,
  needsSampling: (a: T, b: T) => boolean,
  token?: (raw: string) => string | undefined,
): Channel {
  const { anim } = track;
  const vals = track.keys.map((k) => parse(k.value));
  const keys: LKey[] = [];
  const passes = anim.infinite ? (anim.alternate ? 2 : 1) : anim.count * (anim.alternate ? 1 : 1);
  if (!anim.infinite && anim.count !== 1) warn(`animation ${anim.name}: ${anim.count} iterations, written as one`);
  const push = (k: LKey) => {
    const prev = keys[keys.length - 1];
    if (prev && Math.abs(prev.t - k.t) < 1e-6) keys[keys.length - 1] = k;
    else keys.push(k);
  };
  for (let pass = 0; pass < passes; pass++) {
    const reverse = pass === 1;
    const start = anim.delay + pass * anim.duration;
    const n = track.keys.length;
    for (let s = 0; s < n - 1; s++) {
      // In reverse, segment s runs from key n-1-s to key n-2-s.
      const ia = reverse ? n - 1 - s : s;
      const ib = reverse ? n - 2 - s : s + 1;
      const offA = reverse ? 1 - track.keys[ia].offset : track.keys[ia].offset;
      const offB = reverse ? 1 - track.keys[ib].offset : track.keys[ib].offset;
      const t0 = start + offA * anim.duration;
      const t1 = start + offB * anim.duration;
      const ease = track.keys[reverse ? ib : ia].ease;
      const a = vals[ia];
      const b = vals[ib];
      const tokA = token?.(track.keys[ia].value);
      if (ease.kind === "steps") {
        for (let j = 0; j < ease.n; j++) {
          const x = j / ease.n;
          const u = evalEase(ease, x + (ease.start ? 1e-9 : 0));
          const v = lerp(a, b, reverse ? 1 - evalEase(ease, 1 - x - 1e-9) : u);
          const raw = u < 0.5 ? track.keys[ia].value : track.keys[ib].value;
          push({ t: frame(t0 + x * (t1 - t0)), s: toValue(v), h: 1, _es: token?.(raw) });
        }
      } else if (needsSampling(a, b)) {
        const N = 12;
        for (let j = 0; j < N; j++) {
          const x = j / N;
          const u = evalEase(ease, reverse ? 1 - x : x);
          push({ t: frame(t0 + x * (t1 - t0)), s: toValue(lerp(a, b, reverse ? 1 - u : u)), o: { x: [0], y: [0] }, i: { x: [1], y: [1] }, _es: tokA });
        }
      } else {
        push({ t: frame(t0), s: toValue(a), ...easeTangents(ease, reverse), _es: tokA });
      }
    }
    const last = reverse ? 0 : n - 1;
    push({ t: frame(start + anim.duration), s: toValue(vals[last]), _es: token?.(track.keys[last].value) });
  }
  // Lottie holds the first keyframe before it, where CSS shows the element's own state until a
  // delay without `backwards` fill runs out. The artwork means the former: in a browser a check
  // mark that should pop in later sits there for the first second, then vanishes.
  return { keys, loop: anim.infinite };
}

function prop(channel: Channel | null, fallback: Value | number) {
  if (!channel) return { a: 0, k: fallback };
  const k = channel.keys.map((key, i) => {
    const out: Record<string, unknown> = { t: key.t, s: key.s };
    if (i < channel.keys.length - 1) {
      if (key.h) out.h = 1;
      else {
        out.o = key.o ?? { x: [0], y: [0] };
        out.i = key.i ?? { x: [1], y: [1] };
      }
    }
    if (key._es) out._es = key._es;
    return out;
  });
  const p: Record<string, unknown> = { a: 1, k };
  if (channel.loop) p.x = "var $bm_rt;\n$bm_rt = loopOut('cycle');";
  return p;
}

// ------------------------------------------------------------------------------------------------
// Conversion
// ------------------------------------------------------------------------------------------------

const SHAPES = new Set(["rect", "circle", "ellipse", "line", "path", "text"]);
const num = (v: string | undefined, d = 0) => (v === undefined ? d : parseFloat(v));

interface Ctx {
  sheet: Sheet;
  defs: Map<string, El>;
  layers: Record<string, unknown>[];
  nulls: Record<string, unknown>[];
  nextInd: number;
  /** The intro is over by this time; the still frame for reduced motion. */
  stillSec: number;
}

/** Geometry of a shape element in its own coordinates (its `transform` not applied). */
function shapeSubs(el: El, style: Decls): Sub[] {
  const a = el.attrs;
  switch (el.tag) {
    case "rect": {
      const rx = a.rx ?? a.ry;
      const ry = a.ry ?? a.rx;
      return rectSubs(num(a.x), num(a.y), num(a.width), num(a.height), num(rx), num(ry));
    }
    case "circle":
      return ellipseSubs(num(a.cx), num(a.cy), num(a.r), num(a.r));
    case "ellipse":
      return ellipseSubs(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
    case "line": {
      const b = new PathBuilder();
      b.moveTo(num(a.x1), num(a.y1));
      b.lineTo(num(a.x2), num(a.y2));
      return b.subs;
    }
    case "path":
      return parsePathData(a.d ?? "");
    case "text":
      return textSubs(el.text.trim(), num(a.x), num(a.y), style);
  }
  return [];
}

/** The bbox of an element's content in its own coordinates, children's static transforms applied. */
function contentBox(el: El, style: Decls, ctx: Ctx): Box | null {
  if (SHAPES.has(el.tag)) return bboxOf(shapeSubs(el, style));
  let box: Box | null = null;
  for (const c of el.children) {
    if (!SHAPES.has(c.tag) && c.tag !== "g") continue;
    const cs = computed(c, ctx.sheet, style);
    const b = contentBox(c, cs, ctx);
    if (!b) continue;
    const m = parseTransformAttr(c.attrs.transform);
    const pts = [apply(m, b.x0, b.y0), apply(m, b.x1, b.y0), apply(m, b.x0, b.y1), apply(m, b.x1, b.y1)];
    box = union(box, { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) });
  }
  return box;
}

/** transform-origin in the element's own coordinates. `ctm` maps them to the viewport. */
function originOf(el: El, style: Decls, ctx: Ctx, ctm: Mat): [number, number] {
  const boxKind = style["transform-box"] ?? "view-box";
  const raw = (style["transform-origin"] ?? "0 0").split(/\s+/);
  const axis = (v: string | undefined, lo: number, size: number) => {
    if (v === undefined || v === "center") return lo + size / 2;
    if (v === "left" || v === "top") return lo;
    if (v === "right" || v === "bottom") return lo + size;
    if (v.endsWith("%")) return lo + (parseFloat(v) / 100) * size;
    return lo + parseFloat(v);
  };
  if (raw.length === 1) raw.push(raw[0] === "center" ? "center" : "center");
  if (boxKind === "fill-box") {
    const b = contentBox(el, style, ctx) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
    return [axis(raw[0], b.x0, b.x1 - b.x0), axis(raw[1], b.y0, b.y1 - b.y0)];
  }
  // view-box: the origin is in the viewport's coordinates.
  const vx = axis(raw[0], 0, 200);
  const vy = axis(raw[1], 0, 200);
  return apply(invert(ctm), vx, vy);
}

function transformChannels(track: Track, origin: [number, number]) {
  const parse = parseCssTransform;
  const sampled = (a: TFn[], b: TFn[]) => {
    const mid = toChannels(lerpTransform(a, b, 0.5), origin).p;
    const pa = toChannels(a, origin).p;
    const pb = toChannels(b, origin).p;
    return Math.hypot(mid[0] - (pa[0] + pb[0]) / 2, mid[1] - (pa[1] + pb[1]) / 2) > 0.2;
  };
  return {
    p: emitTrack(track, parse, (v) => toChannels(v, origin).p.map(r3), lerpTransform, sampled),
    s: emitTrack(track, parse, (v) => toChannels(v, origin).s.map(r3), lerpTransform, sampled),
    r: emitTrack(track, parse, (v) => [r3(toChannels(v, origin).r)], lerpTransform, sampled),
  };
}

function scalarChannel(track: Track, scale: number) {
  return emitTrack(track, (raw) => parseFloat(raw), (v) => [r3(v * scale)], (a, b, u) => a + (b - a) * u, () => false);
}

function colorChannel(track: Track) {
  const parse = (raw: string) => {
    const c = parseColor(raw);
    return c && c !== "none" && !("gradient" in c) ? c.rgba : ([0, 0, 0, 1] as RGBA);
  };
  const token = (raw: string) => {
    const c = parseColor(raw);
    return c && c !== "none" && !("gradient" in c) ? c.token : undefined;
  };
  return emitTrack(track, parse, (v) => v.map(r3), (a, b, u) => a.map((x, i) => x + (b[i] - x) * u) as RGBA, () => false, token);
}

/**
 * The opacity that goes with an animated theme colour: a Lottie colour has no alpha, and tokens like
 * --es-line do. Same keys as the colour, each holding the paint's own opacity and marked with the
 * token whose alpha EmptyStateLottie.vue multiplies in.
 */
function colorOpacityChannel(track: Track, base: number) {
  const token = (raw: string) => {
    const c = parseColor(raw);
    return c && c !== "none" && !("gradient" in c) ? c.token : undefined;
  };
  return emitTrack(track, () => base, (v) => [r3(v * 100)], (a) => a, () => false, token);
}

function staticTr(opacity: Channel | number) {
  return {
    ty: "tr",
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: typeof opacity === "number" ? { a: 0, k: r3(opacity * 100) } : prop(opacity, 100),
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
  };
}

function trackEnd(t: Track) {
  return t.anim.infinite ? t.anim.delay : t.anim.delay + t.anim.duration * t.anim.count;
}

/** A static opacity, or an animated one, to wrap a shape in. */
type OpacityWrap = { static: number } | { channel: Channel };

interface Inherited {
  parentInd?: number;
  style: Decls;
  /** Maps the element's coordinates to the viewport (static transforms only). */
  ctm: Mat;
  opacities: OpacityWrap[];
  /** Masks on an ancestor, as paths in the coordinates of the current parent layer. */
  masks: Record<string, unknown>[];
}

function maskShapes(el: El, style: Decls, ctx: Ctx, toLayer: Mat): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const key of ["clip-path", "mask"] as const) {
    const ref = style[key]?.match(/url\(#([\w-]+)\)/);
    if (!ref) continue;
    const def = ctx.defs.get(ref[1]);
    if (!def) {
      warn(`${key} references #${ref[1]}, which is not defined`);
      continue;
    }
    for (const c of def.children) {
      if (!SHAPES.has(c.tag)) continue;
      const cs = computed(c, ctx.sheet, null);
      const subs = transformSubs(shapeSubs(c, cs), mul(toLayer, parseTransformAttr(c.attrs.transform)));
      // A luminance mask: white adds, black takes away. A clip path only adds.
      const fill = (c.attrs.fill ?? cs.fill ?? "#000").toLowerCase();
      const mode = key === "clip-path" ? "a" : fill === "#000" || fill === "black" || fill === "#000000" ? "s" : "a";
      for (const s of subs) out.push({ inv: false, mode, pt: { a: 0, k: lottiePath(s) }, o: { a: 0, k: 100 }, x: { a: 0, k: 0 }, nm: `${key} #${ref[1]}` });
    }
  }
  return out;
}

function paintItems(el: El, style: Decls, subs: Sub[], tracks: Map<string, Track>, ctx: Ctx): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  const fillRule = style["fill-rule"] === "evenodd" ? 2 : 1;

  const stroke = parseColor(resolveVars(style.stroke ?? "none", style));
  const strokeTrack = tracks.get("stroke");
  if ((stroke && stroke !== "none") || strokeTrack) {
    if (stroke && stroke !== "none" && "gradient" in stroke) warn("gradient strokes are not converted");
    const color = stroke && stroke !== "none" && !("gradient" in stroke) ? stroke : { rgba: [0, 0, 0, 1] as RGBA };
    const opacity = num(style["stroke-opacity"], 1);
    const st: Record<string, unknown> = {
      ty: "st",
      c: strokeTrack ? prop(colorChannel(strokeTrack), [0, 0, 0, 1]) : { a: 0, k: color.rgba.map(r3) },
      o: strokeTrack ? prop(colorOpacityChannel(strokeTrack, opacity), 100) : { a: 0, k: r3(opacity * 100) },
      w: { a: 0, k: num(style["stroke-width"], 1) },
      lc: { butt: 1, round: 2, square: 3 }[style["stroke-linecap"] ?? "butt"] ?? 1,
      lj: { miter: 1, round: 2, bevel: 3 }[style["stroke-linejoin"] ?? "miter"] ?? 1,
      ml: num(style["stroke-miterlimit"], 4),
      nm: "stroke",
    };
    if (!strokeTrack && color.token) st._es = color.token;
    const dashes = (style["stroke-dasharray"] ?? "none").split(/[\s,]+/).filter((x) => x && x !== "none").map(Number);
    const dashTrack = tracks.get("stroke-dashoffset");
    if (dashes.length) {
      const list = dashes.length % 2 ? [...dashes, ...dashes] : dashes;
      const d: Record<string, unknown>[] = [];
      list.forEach((v, i) => d.push({ n: i % 2 ? "g" : "d", nm: i % 2 ? "gap" : "dash", v: { a: 0, k: v } }));
      const offset = dashTrack ? prop(scalarChannel(dashTrack, 1), 0) : { a: 0, k: num(style["stroke-dashoffset"]) };
      d.push({ n: "o", nm: "offset", v: offset });
      st.d = d;
    } else if (dashTrack) warn("stroke-dashoffset animated on a stroke without dashes");
    items.push(st);
  }

  const fill = parseColor(resolveVars(style.fill ?? "#000", style));
  const fillTrack = tracks.get("fill");
  if (fill && fill !== "none" && "gradient" in fill) {
    items.push(gradientFill(fill.gradient, subs, style, ctx));
  } else if ((fill && fill !== "none") || fillTrack) {
    const color = fill && fill !== "none" && !("gradient" in fill) ? fill : { rgba: [0, 0, 0, 1] as RGBA };
    const opacity = num(style["fill-opacity"], 1);
    const fl: Record<string, unknown> = {
      ty: "fl",
      c: fillTrack ? prop(colorChannel(fillTrack), [0, 0, 0, 1]) : { a: 0, k: color.rgba.map(r3) },
      o: fillTrack ? prop(colorOpacityChannel(fillTrack, opacity), 100) : { a: 0, k: r3(opacity * 100) },
      r: fillRule,
      nm: "fill",
    };
    if (!fillTrack && color.token) fl._es = color.token;
    items.push(fl);
  }
  return items;
}

function gradientFill(id: string, subs: Sub[], style: Decls, ctx: Ctx): Record<string, unknown> {
  const g = ctx.defs.get(id);
  if (!g || g.tag !== "radialGradient") {
    warn(`fill references #${id}, which is not a radialGradient`);
    return { ty: "fl", c: { a: 0, k: [0, 0, 0, 1] }, o: { a: 0, k: 0 }, r: 1 };
  }
  const box = bboxOf(subs) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const pct = (v: string | undefined, d: number) => (v === undefined ? d : v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));
  if (g.attrs.gradientUnits === "userSpaceOnUse") warn("userSpaceOnUse gradients are not converted");
  if (Math.abs(w - h) > 0.5) warn(`radial gradient #${id} on a ${w}×${h} box is drawn circular`);
  const cx = box.x0 + pct(g.attrs.cx, 0.5) * w;
  const cy = box.y0 + pct(g.attrs.cy, 0.5) * h;
  const r = pct(g.attrs.r, 0.5) * Math.max(w, h);
  const stops = g.children.filter((c) => c.tag === "stop").map((s) => {
    const st = { ...s.attrs, ...(s.attrs.style ? parseDecls(s.attrs.style) : {}) };
    const c = parseColor(st["stop-color"] ?? "#000");
    const color = c && c !== "none" && !("gradient" in c) ? c : { rgba: [0, 0, 0, 1] as RGBA };
    return { offset: pct(st.offset, 0), color, opacity: num(st["stop-opacity"], 1) };
  });
  const colors = stops.flatMap((s) => [r3(s.offset), ...s.color.rgba.slice(0, 3).map(r3)]);
  const alphas = stops.flatMap((s) => [r3(s.offset), r3(s.opacity * s.color.rgba[3])]);
  return {
    ty: "gf",
    o: { a: 0, k: 100 },
    r: 1,
    t: 2,
    s: { a: 0, k: [r3(cx), r3(cy)] },
    e: { a: 0, k: [r3(cx + r), r3(cy)] },
    h: { a: 0, k: 0 },
    a: { a: 0, k: 0 },
    g: { p: stops.length, k: { a: 0, k: [...colors, ...alphas] } },
    nm: `gradient #${id}`,
    // Per stop: the token, and the stop's own opacity the token's alpha multiplies.
    _es: { stops: stops.map((s) => [s.color.token ?? null, s.opacity]) },
  };
}

function walk(el: El, inh: Inherited, ctx: Ctx) {
  for (const child of el.children) {
    if (child.tag === "defs" || child.tag === "style" || child.tag === "title" || child.tag === "desc") continue;
    if (child.tag !== "g" && !SHAPES.has(child.tag)) {
      warn(`<${child.tag}> is not converted`);
      continue;
    }
    const style = computed(child, ctx.sheet, inh.style);
    const attrMat = parseTransformAttr(child.attrs.transform);
    const baseOf = (p: string) =>
      p === "transform" ? "none" : p === "opacity" ? style.opacity ?? "1" : p === "stroke-dashoffset" ? style["stroke-dashoffset"] ?? "0" : style[p] ?? (p === "fill" ? "#000" : "none");
    const tracks = tracksFor(child, style, ctx.sheet, baseOf);
    for (const t of tracks.values()) if (!t.anim.infinite) ctx.stillSec = Math.max(ctx.stillSec, trackEnd(t));
    const tTrack = tracks.get("transform");
    if (tTrack && child.attrs.transform) warn(`<${child.tag} class="${child.attrs.class}"> has a transform attribute its CSS animation replaces (as in a browser)`);
    // The element's own static transform, when no CSS transform replaces it.
    const ownStatic = tTrack ? IDENTITY : attrMat;
    const ctm = mul(inh.ctm, ownStatic);

    const opacityTrack = tracks.get("opacity");
    const staticOpacity = num(style.opacity, 1);
    const ownOpacity: OpacityWrap | null = opacityTrack
      ? { channel: scalarChannel(opacityTrack, 100) }
      : staticOpacity !== 1
        ? { static: staticOpacity }
        : null;

    if (child.tag === "g") {
      // A null layer carries the group's transform; children are parented to it.
      const ind = ctx.nextInd++;
      const ks: Record<string, unknown> = { o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } };
      if (tTrack) {
        const origin = originOf(child, style, ctx, inh.ctm);
        const ch = transformChannels(tTrack, origin);
        Object.assign(ks, { a: { a: 0, k: [r3(origin[0]), r3(origin[1])] }, p: prop(ch.p, 0), s: prop(ch.s, 100), r: prop(ch.r, 0) });
      } else {
        Object.assign(ks, staticTransformKs(attrMat));
      }
      const nl: Record<string, unknown> = { ddd: 0, ind, ty: 3, nm: `g${child.attrs.class ? "." + child.attrs.class.replace(/\s+/g, ".") : ""}`, sr: 1, ks, ao: 0, ip: 0, op: OUT_POINT, st: 0, bm: 0 };
      if (inh.parentInd !== undefined) nl.parent = inh.parentInd;
      ctx.nulls.push(nl);
      // A mask on the group is in the group's coordinates, which are its children's layer space.
      const masks = [...inh.masks.map((m) => maskInChild(m, ownStatic)), ...maskShapes(child, style, ctx, IDENTITY)];
      if (tTrack && inh.masks.length) warn("an animated group inside a masked group: the mask does not follow it");
      walk(child, { parentInd: ind, style, ctm, opacities: ownOpacity ? [...inh.opacities, ownOpacity] : inh.opacities, masks }, ctx);
      continue;
    }

    // A shape: a layer of its own.
    let subs = shapeSubs(child, style);
    let tr: Record<string, unknown>;
    if (tTrack) {
      const origin = originOf(child, style, ctx, inh.ctm);
      const ch = transformChannels(tTrack, origin);
      tr = {
        ty: "tr",
        a: { a: 0, k: [r3(origin[0]), r3(origin[1])] },
        p: prop(ch.p, 0),
        s: prop(ch.s, 100),
        r: prop(ch.r, 0),
        o: { a: 0, k: 100 },
        sk: { a: 0, k: 0 },
        sa: { a: 0, k: 0 },
      };
    } else {
      // A static transform is baked into the geometry.
      subs = transformSubs(subs, attrMat);
      tr = staticTr(1);
    }
    if (ownOpacity) tr.o = "channel" in ownOpacity ? prop(ownOpacity.channel, 100) : { a: 0, k: r3(ownOpacity.static * 100) };
    const paints = paintItems(child, style, subs, tracks, ctx);
    if (!paints.length) continue;
    const group: Record<string, unknown> = {
      ty: "gr",
      nm: child.tag + (child.attrs.class ? "." + child.attrs.class.replace(/\s+/g, ".") : ""),
      it: [...subs.map((s, i) => ({ ty: "sh", nm: `path ${i}`, ks: { a: 0, k: lottiePath(s) } })), ...paints, tr],
    };
    // Ancestors' opacity, outermost first, as wrapping groups.
    let content: Record<string, unknown> = group;
    for (const op of [...inh.opacities].reverse()) {
      content = { ty: "gr", nm: "opacity", it: [content, staticTr("channel" in op ? op.channel : op.static)] };
    }
    const ownMasks = maskShapes(child, style, ctx, tTrack ? IDENTITY : attrMat);
    if (tTrack && ownMasks.length) warn("a mask on an animated shape does not follow its animation");
    const masks = [...inh.masks, ...ownMasks];
    const layer: Record<string, unknown> = {
      ddd: 0,
      ind: ctx.nextInd++,
      ty: 4,
      nm: group.nm,
      sr: 1,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      ao: 0,
      shapes: [content],
      ip: 0,
      op: OUT_POINT,
      st: 0,
      bm: 0,
    };
    if (inh.parentInd !== undefined) layer.parent = inh.parentInd;
    if (masks.length) {
      layer.hasMask = true;
      layer.masksProperties = masks;
    }
    ctx.layers.push(layer);
  }
}

/** A mask path of a parent's space, moved into a child group's space. */
function maskInChild(mask: Record<string, unknown>, childStatic: Mat): Record<string, unknown> {
  if (childStatic === IDENTITY) return mask;
  const pt = (mask.pt as { k: ReturnType<typeof lottiePath> }).k;
  const inv = invert(childStatic);
  const sub: Sub = {
    closed: pt.c,
    v: pt.v.map(([x, y], i) => ({ x, y, ix: x + pt.i[i][0], iy: y + pt.i[i][1], ox: x + pt.o[i][0], oy: y + pt.o[i][1] })),
  };
  return { ...mask, pt: { a: 0, k: lottiePath(transformSubs([sub], inv)[0]) } };
}

function staticTransformKs(m: Mat) {
  const sx = Math.hypot(m[0], m[1]);
  const rot = Math.atan2(m[1], m[0]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = det / sx;
  // No skew in the artwork's group transforms; a matrix with one would be drawn without it.
  const shear = (m[0] * m[2] + m[1] * m[3]) / (sx * sx);
  if (Math.abs(shear) > 1e-6) warn("a group transform with skew is drawn without it");
  return {
    a: { a: 0, k: [0, 0] },
    p: { a: 0, k: [r3(m[4]), r3(m[5])] },
    s: { a: 0, k: [r3(sx * 100), r3(sy * 100)] },
    r: { a: 0, k: r3(rot / DEG) },
  };
}

function collectDefs(el: El, defs: Map<string, El>) {
  if (el.attrs.id) defs.set(el.attrs.id, el);
  for (const c of el.children) collectDefs(c, defs);
}

function convert(name: string, svgText: string): Record<string, unknown> {
  const svg = parseXml(svgText);
  const css = svg.children.filter((c) => c.tag === "style").map((c) => c.text).join("\n");
  const sheet = parseSheet(css);
  const defs = new Map<string, El>();
  collectDefs(svg, defs);
  const [vx, vy, vw, vh] = (svg.attrs.viewBox ?? "0 0 200 200").split(/[\s,]+/).map(Number);
  if (vx || vy || vw !== 200 || vh !== 200) warn(`viewBox ${svg.attrs.viewBox} is not 0 0 200 200`);
  const ctx: Ctx = { sheet, defs, layers: [], nulls: [], nextInd: 1, stillSec: 0 };
  walk(svg, { style: computed(svg, sheet, null), ctm: IDENTITY, opacities: [], masks: [] }, ctx);
  return {
    v: "5.7.4",
    fr: FPS,
    ip: 0,
    op: OUT_POINT,
    w: vw,
    h: vh,
    nm: name,
    ddd: 0,
    assets: [],
    // Lottie draws the first layer on top; SVG paints later elements over earlier ones.
    layers: [...ctx.layers.reverse(), ...ctx.nulls],
    _es: { still: frame(ctx.stillSec) },
  };
}

// ------------------------------------------------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
let failed = false;
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith(".svg")).sort()) {
  const name = file.replace(/\.svg$/, "");
  if (only.length && !only.includes(name)) continue;
  warnings = [];
  const json = convert(name, fs.readFileSync(path.join(SRC, file), "utf8"));
  const text = JSON.stringify(json);
  fs.writeFileSync(path.join(OUT, `${name}.json`), text);
  const layers = (json.layers as unknown[]).length;
  console.log(`${name}: ${layers} layers, ${(text.length / 1024).toFixed(1)} KB`);
  for (const w of [...new Set(warnings)]) console.log(`  ! ${w}`);
  if (!text.length) failed = true;
}
if (failed) process.exit(1);
