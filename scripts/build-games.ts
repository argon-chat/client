/**
 * Build PlayFrame games.
 *
 * Bundles each game's TypeScript entry (which imports the real
 * `@argon/playframe-sdk`) into a single IIFE and embeds it into the game's
 * HTML template, producing a self-contained `public/games/<id>/index.html`.
 *
 * Why embedded (not external): the game iframe is sandboxed without
 * `allow-same-origin` (opaque origin). Module scripts and `'self'`/CORS-based
 * loading don't work in an opaque origin, and we deliver a strict CSP via <meta>
 * in the template, so the bundle must travel inside the HTML itself.
 *
 * How it's embedded: as a **base64 string** decoded by a tiny fixed bootstrap at
 * runtime. Putting raw minified JS directly inside an HTML `<script>` is a trap —
 * any `</script`, `<!--`, `<script`, or `$`-replacement sequence in the bundle can
 * silently corrupt the page, and escaping arbitrary JS safely is not possible.
 * Base64's alphabet (A–Z a–z 0–9 + / =) contains none of those characters, so the
 * bundle can never break out of the page no matter how it's minified. The bootstrap
 * decodes it and runs it as a DOM-created inline script — allowed by the template's
 * `script-src 'unsafe-inline'` CSP; no eval, no external fetch.
 *
 *   bun run scripts/build-games.ts            # one-shot build
 *   bun run scripts/build-games.ts --watch    # rebuild on source change
 */

import { resolve } from "node:path";
import { watch as fsWatch } from "node:fs";

const root = resolve(import.meta.dir, "..");
const gamesDir = resolve(root, "games");

// Each game = a folder under client/games/ with `main.ts` + `index.html`.
const GAMES = ["pong", "snake", "battleship"] as const;

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

  // Embed the bundle as base64 (HTML-inert) and decode + run it at load time. See the
  // file header for why raw inlining is unsafe. The bootstrap is fixed and hand-written,
  // so it has no characters that could break the page.
  const b64 = Buffer.from(js, "utf8").toString("base64");
  const bootstrap =
    `<script>(function(){` +
    `var b="${b64}",s=atob(b),u=new Uint8Array(s.length);` +
    `for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);` +
    `var e=document.createElement("script");` +
    `e.textContent=new TextDecoder().decode(u);` +
    `document.head.appendChild(e);` +
    `})();</script>`;

  // Function replacer (not a string) so nothing in the payload is reinterpreted.
  const html = template.replace(PLACEHOLDER, () => bootstrap);

  // Guard: the embedded payload must round-trip back to the exact bundle, and base64
  // must be clean — a broken or partial inline can never silently ship.
  const roundTrip = Buffer.from(b64, "base64").toString("utf8");
  if (roundTrip !== js) {
    console.error(`[build-games] ${id}: payload round-trip mismatch — refusing to write`);
    return false;
  }

  await Bun.write(outPath, html);
  console.log(`[build-games] ${id} -> public/games/${id}/index.html (base64, ${(js.length / 1024) | 0} KB js)`);
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
