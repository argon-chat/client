import { describe, expect, test } from "vitest";
import { parseCssColor, substituteVars, themeEmptyState, type RGBA } from "../src/lib/emptyStateLottie";

const SVGS = import.meta.glob("../src/styles/empty-states/*.svg", { query: "?raw" });
const FILES = import.meta.glob<string>("../src/styles/empty-states/lottie/*.json", { query: "?raw", import: "default", eager: true });
const read = (name: string) => JSON.parse(FILES[`../src/styles/empty-states/lottie/${name}.json`]);

/** Every object in a Lottie document, depth first. */
function objects(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => objects(n, out));
  else if (node && typeof node === "object") {
    out.push(node as Record<string, unknown>);
    Object.values(node).forEach((n) => objects(n, out));
  }
  return out;
}

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 2e-3);

describe("empty-state colours", () => {
  test("parses the syntaxes the theme writes", () => {
    expect(close(parseCssColor("#3a3b45")!, [0x3a / 255, 0x3b / 255, 0x45 / 255, 1])).toBe(true);
    expect(close(parseCssColor("#fff")!, [1, 1, 1, 1])).toBe(true);
    expect(close(parseCssColor("hsl(0 0% 100% / 0.1)")!, [1, 1, 1, 0.1])).toBe(true);
    expect(close(parseCssColor("hsl(120, 100%, 25%)")!, [0, 0.5, 0, 1])).toBe(true);
    expect(close(parseCssColor("rgba(255, 0, 0, 50%)")!, [1, 0, 0, 0.5])).toBe(true);
    expect(parseCssColor("hsl()")).toBeNull();
    expect(parseCssColor("currentColor")).toBeNull();
  });

  test("resolves the var()s a token is written with", () => {
    const vars: Record<string, string> = { "--primary": "217 91% 60%", "--es-accent": "hsl(var(--primary))" };
    const get = (name: string) => vars[name] ?? "";
    expect(substituteVars(get("--es-accent"), get)).toBe("hsl(217 91% 60%)");
    expect(substituteVars("hsl(var(--muted, 0 0% 50%) / 0.4)", get)).toBe("hsl(0 0% 50% / 0.4)");
  });
});

describe("theming a converted file", () => {
  test("every converted file exists and carries no marker once themed", () => {
    const names = Object.keys(SVGS).map((p) => p.slice(p.lastIndexOf("/") + 1, -4));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const themed = themeEmptyState(read(name), () => [0.5, 0.5, 0.5, 1]);
      expect(objects(themed).filter((o) => "_es" in o), name).toEqual([]);
    }
  });

  test("a static token's alpha becomes the paint's opacity", () => {
    const source = read("no-sessions");
    const line: RGBA = [0.2, 0.4, 0.6, 0.42];
    const themed = themeEmptyState(source, (t) => (t === "es-line" ? line : null));
    const before = objects(source).filter((o) => o._es === "es-line");
    const after = objects(themed).filter((o) => (o.ty === "st" || o.ty === "fl") && close((o.c as { k: number[] }).k, [0.2, 0.4, 0.6, 1]));
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBe(before.length);
    for (const [i, paint] of after.entries()) {
      expect((paint.o as { k: number }).k).toBeCloseTo(((before[i].o as { k: number }).k * 0.42), 2);
    }
  });

  test("an animated colour writes each key's token, its alpha into the matching opacity key", () => {
    // no-hotkeys flashes a key cap from --es-line to --es-accent and back.
    const themed = themeEmptyState(read("no-hotkeys"), (t) =>
      t === "es-line" ? [0, 0, 1, 0.5] : t === "es-accent" ? [1, 0, 0, 1] : null,
    );
    const fills = objects(themed).filter((o) => o.ty === "fl" && (o.c as { a: number }).a === 1);
    expect(fills.length).toBe(3);
    for (const fill of fills) {
      const colors = (fill.c as { k: { s: number[] }[] }).k.map((k) => k.s);
      const opacities = (fill.o as { k: { s: number[] }[] }).k.map((k) => k.s[0]);
      expect(colors.length).toBe(opacities.length);
      colors.forEach((c, i) => expect(opacities[i]).toBeCloseTo(c[0] === 1 ? 100 : 50, 3));
    }
  });

  test("a gradient stop takes the token's colour, its opacity times the token's alpha", () => {
    const themed = themeEmptyState(read("updating"), (t) => (t === "es-accent-deep" ? [1, 0.5, 0, 0.5] : null));
    const gradient = objects(themed).find((o) => o.ty === "gf") as { g: { p: number; k: { k: number[] } } };
    const k = gradient.g.k.k;
    expect(k.slice(1, 4)).toEqual([1, 0.5, 0]);
    // Stop 0 is at 0.22 opacity in the SVG.
    expect(k[gradient.g.p * 4 + 1]).toBeCloseTo(0.11, 3);
  });

  test("a token that does not resolve keeps the SVG's own fallback colour", () => {
    const source = read("no-sessions");
    const themed = themeEmptyState(source, () => null);
    const colors = (doc: unknown) => objects(doc).filter((o) => o.ty === "fl" || o.ty === "st").map((o) => JSON.stringify(o.c));
    expect(colors(themed)).toEqual(colors(source));
  });
});
