/**
 * Makes a freshly delivered empty-state SVG usable inside the app.
 *
 * The artwork ships as a self-contained animated SVG with a hard-coded purple palette. Two things
 * have to change before it can be inlined into the client (see components/shared/EmptyStateArt.vue):
 *
 *   1. Scoping. A <style> inside an inlined SVG applies to the whole document, so every selector is
 *      prefixed with `.es-svg` and every @keyframes is renamed to `es-<name>` — otherwise generic
 *      names like `.in` or `@keyframes fl` would leak over the app.
 *   2. Theming. Every colour becomes `style="fill:var(--es-…,#original)"`. Inline style rather than
 *      the presentation attribute, because var() in presentation attributes is not dependable across
 *      engines; the hex stays as the fallback so the file still previews correctly on its own.
 *
 * Idempotent — files that already carry the `es-svg` hook are left alone, so it is safe to re-run
 * after dropping new artwork in.
 *
 *   bun run theme:empty-states
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dir, "..", "src", "styles", "empty-states");

/** Original hex -> custom property the client defines on .es-art. */
const COLORS: Record<string, string> = {
  "#7c5cf5": "es-accent-deep",
  "#a78bfa": "es-accent",
  "#23242b": "es-surface",
  "#2c2d34": "es-surface-2",
  "#3a3b45": "es-line",
  "#5c5e6b": "es-line-strong",
  "#131316": "es-void",
  "#e4e4e8": "es-paper",
  "#c9c9d1": "es-paper-dim",
  "#fff": "es-on-accent",
  "#000": "es-shadow",
  "#f04747": "es-danger",
  "#f0b232": "es-warning",
  "#2bb3a3": "es-success",
  "#5fb3f5": "es-info",
};

const COLOR_ATTRS = ["fill", "stroke", "stop-color"];

const varOf = (hex: string) => `var(--${COLORS[hex.toLowerCase()]},${hex})`;

type Block = { raw?: string; prelude?: string; body?: string };

/** Split css into top-level blocks, keeping nested @keyframes bodies intact. */
function splitBlocks(css: string): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) {
      const tail = css.slice(i);
      if (tail.trim()) out.push({ raw: tail });
      break;
    }
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    out.push({ prelude: css.slice(i, open), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

function colorize(text: string): string {
  return text.replace(/#[0-9a-fA-F]{3,6}\b/g, (m) => (COLORS[m.toLowerCase()] ? varOf(m) : m));
}

function transformStyle(css: string): string {
  const blocks = splitBlocks(css);

  const names = new Set<string>();
  for (const b of blocks) {
    const m = b.prelude?.match(/@keyframes\s+([\w-]+)/);
    if (m) names.add(m[1]);
  }

  let out = "";
  for (const b of blocks) {
    if (b.raw !== undefined) {
      out += b.raw;
      continue;
    }
    const prelude = b.prelude!;
    const kf = prelude.match(/^(\s*)@keyframes\s+([\w-]+)\s*$/);
    if (kf) {
      out += `${kf[1]}@keyframes es-${kf[2]}{${colorize(b.body!)}}`;
    } else {
      const leading = prelude.match(/^\s*/)![0];
      const selectors = prelude
        .trim()
        .split(",")
        .map((s) => `.es-svg ${s.trim()}`)
        .join(",");
      out += `${leading}${selectors}{${colorize(b.body!)}}`;
    }
  }

  for (const n of names) {
    out = out.replace(new RegExp(`(animation(?:-name)?\\s*:\\s*)${n}\\b`, "g"), `$1es-${n}`);
  }
  return out;
}

function transformMarkup(markup: string): string {
  // <mask> bodies use #fff/#000 as luminance keys, not as colours — they must stay literal.
  const guarded: [number, number][] = [];
  const maskRe = /<mask\b[\s\S]*?<\/mask>/g;
  let m: RegExpExecArray | null;
  while ((m = maskRe.exec(markup))) guarded.push([m.index, m.index + m[0].length]);
  const isGuarded = (i: number) => guarded.some(([a, b]) => i >= a && i < b);

  return markup.replace(/<([a-zA-Z][\w-]*)\b([^>]*)>/g, (tag, name, attrs, index: number) => {
    if (isGuarded(index)) return tag;

    let rest: string = attrs;
    const decls: string[] = [];

    for (const attr of COLOR_ATTRS) {
      const re = new RegExp(`\\s${attr}="([^"]*)"`);
      const hit = rest.match(re);
      if (!hit) continue;
      const value = hit[1].trim();
      if (!COLORS[value.toLowerCase()]) continue;
      rest = rest.replace(re, "");
      decls.push(`${attr}:${varOf(value)}`);
    }

    if (!decls.length) return `<${name}${rest}>`;

    const styleRe = /\sstyle="([^"]*)"/;
    if (styleRe.test(rest)) {
      rest = rest.replace(styleRe, (_all, cur: string) => {
        const sep = !cur.trim() || cur.trim().endsWith(";") ? "" : ";";
        return ` style="${cur}${sep}${decls.join(";")}"`;
      });
    } else {
      rest = `${rest} style="${decls.join(";")}"`;
    }
    return `<${name}${rest}>`;
  });
}

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".svg"))) {
  const full = path.join(DIR, file);
  let src = fs.readFileSync(full, "utf8");

  if (src.includes('class="es-svg"')) {
    console.log(`· ${file} — already themed`);
    continue;
  }

  src = src.replace(
    /<style>([\s\S]*?)<\/style>/,
    (_all, css: string) => `<style>${transformStyle(css)}</style>`,
  );

  const styleStart = src.indexOf("<style>");
  const styleEnd = src.indexOf("</style>") + "</style>".length;
  src =
    transformMarkup(src.slice(0, styleStart)) +
    src.slice(styleStart, styleEnd) +
    transformMarkup(src.slice(styleEnd));

  src = src.replace(/<svg\b([^>]*)>/, (all, attrs: string) =>
    attrs.includes("class=") ? all : `<svg${attrs} class="es-svg">`,
  );

  fs.writeFileSync(full, src);
  console.log(`✓ ${file}`);
}
