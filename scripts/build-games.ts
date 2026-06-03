/**
 * Build PlayFrame games.
 *
 * Bundles each game's TypeScript entry (which imports the real
 * `@argon/playframe-sdk`) into a single browser ESM file served statically
 * from `public/games/<id>/bundle.js`. The SDK has zero runtime dependencies,
 * so each bundle is fully self-contained.
 *
 *   bun run scripts/build-games.ts            # one-shot build
 *   bun run scripts/build-games.ts --watch    # rebuild on source change
 */

import { resolve } from "node:path";
import { watch as fsWatch } from "node:fs";

const root = resolve(import.meta.dir, "..");
const gamesDir = resolve(root, "games");

// Each game = a folder under client/games/ with a `main.ts` entry.
const GAMES = ["pong", "snake"] as const;

const isWatch = process.argv.includes("--watch");

async function buildGame(id: string): Promise<boolean> {
  const entry = resolve(gamesDir, id, "main.ts");
  const outdir = resolve(root, "public", "games", id);

  const result = await Bun.build({
    entrypoints: [entry],
    outdir,
    target: "browser",
    // IIFE (classic script), NOT ESM: the game iframe is sandboxed without
    // allow-same-origin (opaque origin), and module scripts are always fetched
    // with CORS — which static game assets don't serve. Classic scripts load
    // cross-origin fine.
    format: "iife",
    minify: !isWatch,
    sourcemap: isWatch ? "linked" : "none",
    naming: { entry: "bundle.[ext]" },
  });

  if (!result.success) {
    console.error(`[build-games] ${id} failed:`);
    for (const log of result.logs) console.error(log);
    return false;
  }

  console.log(`[build-games] ${id} -> public/games/${id}/bundle.js`);
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
