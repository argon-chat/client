/**
 * Per-package coverage.
 *
 * A single aggregate number is not available here: each package project has its own
 * root, so vitest reports their files package-relative and the root config's include
 * patterns cannot see them. Packages are also split across two runners — the playframe
 * family is bun:test, everything else is vitest. So the honest report is per package,
 * measured with whichever runner owns it, which is also how the work gets prioritised.
 *
 *   bun run test:coverage            print the table
 *   bun run test:coverage --enforce  also exit non-zero if a package is below target
 *
 * Under GitHub Actions it additionally appends a markdown table to the job summary, so
 * coverage is visible on the run page without opening artifacts or logs.
 */

import { readdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = 50;
const ENFORCE = process.argv.includes("--enforce");
const PACKAGES = join(import.meta.dir, "..", "packages");

type Row = { name: string; runner: string; lines: number | null; note?: string };

const pct = (s: string, label: string): number | null => {
  const m = s.match(new RegExp(`${label}\\s*:\\s*([\\d.]+)%`));
  return m ? Number.parseFloat(m[1]) : null;
};

async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return out + err;
}

const root = join(import.meta.dir, "..");
const rows: Row[] = [];

for (const name of readdirSync(PACKAGES).sort()) {
  const dir = join(PACKAGES, name);
  if (!existsSync(join(dir, "package.json"))) continue;

  const hasVitest = existsSync(join(dir, "vitest.config.ts"));
  const hasBunTests = !hasVitest && existsSync(join(dir, "test"));

  if (hasVitest) {
    const out = await run(["npx", "vitest", "run", "--coverage"], dir);
    rows.push({ name, runner: "vitest", lines: pct(out, "Lines") });
  } else if (hasBunTests) {
    // bun's summary is a table, not a "Lines: x%" line — pull the All files row.
    const out = await run(["bun", "test", name, "--coverage"], root);
    const m = out.match(/All files\s*\|[^|]*\|\s*([\d.]+)/);
    rows.push({ name, runner: "bun", lines: m ? Number.parseFloat(m[1]) : null });
  } else {
    rows.push({ name, runner: "—", lines: null, note: "no tests" });
  }
}

const width = Math.max(...rows.map((r) => r.name.length));
console.log("");
console.log(`${"package".padEnd(width)}  runner  lines   target ${TARGET}%`);
console.log("-".repeat(width + 30));

let met = 0;
for (const r of rows) {
  const value = r.lines === null ? "—" : `${r.lines.toFixed(1)}%`;
  const status = r.lines === null ? r.note ?? "" : r.lines >= TARGET ? "ok" : "below";
  if (r.lines !== null && r.lines >= TARGET) met++;
  console.log(
    `${r.name.padEnd(width)}  ${r.runner.padEnd(6)}  ${value.padStart(6)}  ${status}`,
  );
}

const measured = rows.filter((r) => r.lines !== null).length;
const below = rows.filter((r) => r.lines !== null && r.lines < TARGET);

console.log("-".repeat(width + 30));
console.log(`${met}/${measured} measured packages at or above ${TARGET}% lines\n`);

// GitHub Actions job summary: rendered on the run page itself, so nobody has to
// download an artifact or scroll the log to see where coverage stands.
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const icon = (r: Row) => (r.lines === null ? "⚪" : r.lines >= TARGET ? "🟢" : "🔴");
  const lines = [
    `## Coverage — ${met}/${measured} packages at or above ${TARGET}% lines`,
    "",
    "| | Package | Runner | Lines |",
    "|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${icon(r)} | \`${r.name}\` | ${r.runner} | ${r.lines === null ? r.note ?? "—" : `${r.lines.toFixed(1)}%`} |`,
    ),
    "",
    "<sub>Packages without tests are not counted. The playframe family runs under " +
      "`bun test`; everything else under vitest, each from its own config.</sub>",
    "",
  ];
  appendFileSync(summaryPath, lines.join("\n"));
}

if (ENFORCE && below.length > 0) {
  console.error(
    `below ${TARGET}%: ${below.map((r) => `${r.name} (${r.lines!.toFixed(1)}%)`).join(", ")}`,
  );
  process.exit(1);
}
