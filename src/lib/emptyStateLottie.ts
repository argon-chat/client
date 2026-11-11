/**
 * Themes an empty-state Lottie file (scripts/empty-states-lottie.ts) for components/shared/EmptyStateLottie.vue.
 *
 * Every colour the source SVG takes from a `var(--es-…)` carries an `_es` marker naming the token:
 *
 *   - a static fill or stroke: `_es: "es-line"` on the paint;
 *   - an animated one: `_es` on each key of the colour, and of the opacity that goes with it;
 *   - a radial gradient: `_es: { stops: [[token | null, stop opacity], …] }`.
 *
 * The token's colour is written in; its alpha (--es-line is the muted foreground at 0.42) goes into
 * the paint's opacity, because a Lottie colour has none. A token that does not resolve keeps the
 * colour the SVG falls back to, which the file already holds. The markers are stripped either way.
 */

export type RGBA = [number, number, number, number];
type Json = Record<string, unknown>;
type Animated = { a: number; k: unknown };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** `var(--x, fallback)` against `read`, nested ones included. */
export function substituteVars(value: string, read: (name: string) => string, depth = 0): string {
  if (depth > 8 || !value.includes("var(")) return value;
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => {
    return read(name).trim() || fallback?.trim() || "";
  });
  return substituteVars(out, read, depth + 1);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** hex, rgb()/rgba() and hsl()/hsla(), comma or space separated, with a `/ alpha`. */
export function parseCssColor(raw: string): RGBA | null {
  const v = raw.trim().toLowerCase();
  if (v.startsWith("#")) {
    let h = v.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const fn = v.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p: string, scale: number) => (p.endsWith("%") ? (parseFloat(p) / 100) * scale : parseFloat(p));
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1);
  const rgb: [number, number, number] = fn[1].startsWith("rgb")
    ? [num(parts[0], 255) / 255, num(parts[1], 255) / 255, num(parts[2], 255) / 255]
    : hslToRgb(parseFloat(parts[0]), num(parts[1], 1), num(parts[2], 1));
  const all = [...rgb, alpha];
  return all.every(Number.isFinite) ? (all as RGBA) : null;
}

/** A copy of `source` with the palette written in and the markers stripped. */
export function themeEmptyState(source: Json, color: (token: string) => RGBA | null): Json {
  const out = structuredClone(source);
  delete out._es;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const o = node as Json;
    const marker = o._es;
    delete o._es;
    if (o.ty === "fl" || o.ty === "st") {
      const c = o.c as Animated;
      const op = o.o as Animated;
      if (typeof marker === "string") {
        const rgba = color(marker);
        if (rgba) {
          c.k = [r3(rgba[0]), r3(rgba[1]), r3(rgba[2]), 1];
          op.k = r3((op.k as number) * rgba[3]);
        }
      } else if (c.a === 1) {
        for (const key of c.k as Json[]) {
          const rgba = typeof key._es === "string" ? color(key._es) : null;
          if (rgba) key.s = [r3(rgba[0]), r3(rgba[1]), r3(rgba[2]), 1];
          delete key._es;
        }
        if (op.a === 1) {
          for (const key of op.k as Json[]) {
            const rgba = typeof key._es === "string" ? color(key._es) : null;
            if (rgba) key.s = [r3((key.s as number[])[0] * rgba[3])];
            delete key._es;
          }
        }
      }
    } else if (o.ty === "gf" && marker && typeof marker === "object") {
      const stops = (marker as { stops: [string | null, number][] }).stops;
      const g = o.g as { p: number; k: { k: number[] } };
      const k = g.k.k;
      stops.forEach(([token, opacity], i) => {
        const rgba = token ? color(token) : null;
        if (!rgba) return;
        k[i * 4 + 1] = r3(rgba[0]);
        k[i * 4 + 2] = r3(rgba[1]);
        k[i * 4 + 3] = r3(rgba[2]);
        k[g.p * 4 + i * 2 + 1] = r3(opacity * rgba[3]);
      });
    }
    for (const value of Object.values(o)) visit(value);
  };
  visit(out);
  return out;
}

/** The frame the intro has finished by: what reduced motion holds. */
export function emptyStateStillFrame(source: Json): number {
  return (source._es as { still?: number } | undefined)?.still ?? 0;
}
