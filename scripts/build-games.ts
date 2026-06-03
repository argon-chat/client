/**
 * Build PlayFrame games.
 *
 * Bundles each game's TypeScript entry (which imports the real
 * `@argon/playframe-sdk`) into a single IIFE and INLINES it into the game's
 * HTML template, producing a self-contained `public/games/<id>/index.html`.
 *
 * Why inline + IIFE: the game iframe is sandboxed without `allow-same-origin`
 * (opaque origin). Module scripts and `'self'`/CORS-based loading don't work in
 * an opaque origin, and we deliver a strict CSP via <meta> in the template. An
 * inlined classic script sidesteps all of that.
 *
 *   bun run scripts/build-games.ts            # one-shot build
 *   bun run scripts/build-games.ts --watch    # rebuild on source change
 */

import { resolve } from "node:path";
import { watch as fsWatch } from "node:fs";

const root = resolve(import.meta.dir, "..");
const gamesDir = resolve(root, "games");

// Each game = a folder under client/games/ with `main.ts` + `index.html`.
const GAMES = ["pong", "snake"] as const;

const isWatch = process.argv.includes("--watch");
const PLACEHOLDER = "<!--PLAYFRAME_BUNDLE-->";

async function buildGame(id: string): Promise<boolean> {
  const entry = resolve(gamesDir, id, "main.ts");
  const templatePath = resolve(gamesDir, id, "index.html");
  const outPath = resolve(root, "public", "games", id, "index.html");

  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "iife",
    minify: !isWatch,
  });

  if (!result.success) {
    console.error(`[build-games] ${id} failed:`);
    for (const log of result.logs) console.error(log);
    return false;
  }

  const js = await result.outputs[0].text();
  const template = await Bun.file(templatePath).text();
  if (!template.includes(PLACEHOLDER)) {
    console.error(`[build-games] ${id}: template missing ${PLACEHOLDER}`);
    return false;
  }

  // Escape any literal </script> so the inline <script> can't be terminated early.
  const safeJs = js.replace(/<\/script>/gi, "<\\/script>");
  const html = template.replace(PLACEHOLDER, `<script>\n${safeJs}\n</script>`);

  await Bun.write(outPath, html);
  console.log(`[build-games] ${id} -> public/games/${id}/index.html (inlined, ${(js.length / 1024) | 0} KB js)`);
  return true;
}

async function buildAll(): Promise<boolean> {
  const results = await Promise.all(GAMES.map(buildGame));
  return results.every(Boolean);
}

const ok = await buildAll();

if (!isWatch) {
  if (!ok) process.exit(1);
} else {
  console.log("[build-games] watching games/ for changes...");
  let timer: ReturnType<typeof setTimeout> | null = null;
  fsWatch(gamesDir, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void buildAll(), 100);
  });
}
