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

import { readdirSync, existsSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const TARGET = 50;
const ENFORCE = process.argv.includes("--enforce");
const PACKAGES = join(import.meta.dir, "..", "packages");

type Row = {
  name: string;
  runner: string;
  lines: number | null;
  /** Set when a package has no tests at all — distinct from a measurement that broke. */
  untested?: boolean;
  /** Set when the runner failed or its output could not be read. */
  error?: string;
};

/**
 * Line coverage from vitest's json-summary report.
 *
 * Deliberately not scraped from the console table: the text summary is a rendering
 * detail that depends on the reporter set and on whether a TTY is attached, and on CI
 * it simply was not there — every package reported "no summary in output" while the
 * runner exited cleanly. A machine-readable file has no such ambiguity.
 */
const readSummary = (dir: string): number | null => {
  const file = join(dir, "coverage", "coverage-summary.json");
  if (!existsSync(file)) return null;
  try {
    const total = JSON.parse(readFileSync(file, "utf8"))?.total?.lines?.pct;
    return typeof total === "number" ? total : null;
  } catch {
    return null;
  }
};

async function run(cmd: string[], cwd: string): Promise<{ output: string; code: number }> {
  try {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { output: out + err, code };
  } catch (e) {
    // Spawn itself failed — usually a missing binary.
    return { output: String(e), code: -1 };
  }
}

/** Last few meaningful lines of a failed run, for the error column. */
const tail = (output: string) =>
  output.split("\n").map((l) => l.trim()).filter(Boolean).slice(-2).join(" / ").slice(0, 160) ||
  "no output";

const root = join(import.meta.dir, "..");
const rows: Row[] = [];

for (const name of readdirSync(PACKAGES).sort()) {
  const dir = join(PACKAGES, name);
  if (!existsSync(join(dir, "package.json"))) continue;

  const hasVitest = existsSync(join(dir, "vitest.config.ts"));
  const hasBunTests = !hasVitest && existsSync(join(dir, "test"));

  if (hasVitest) {
    // bunx, not npx: this script already runs under bun, so bun is guaranteed to be on
    // PATH while Node is not. html is kept alongside json-summary so the uploaded
    // artifact stays browsable rather than being a single JSON file.
    rmSync(join(dir, "coverage"), { recursive: true, force: true });
    const { output, code } = await run(
      [
        "bunx", "vitest", "run", "--coverage",
        "--coverage.reporter=json-summary",
        "--coverage.reporter=html",
      ],
      dir,
    );
    const lines = readSummary(dir);
    rows.push(
      lines !== null
        ? { name, runner: "vitest", lines }
        : {
            name,
            runner: "vitest",
            lines: null,
            error: code === 0 ? `no coverage-summary.json written — ${tail(output)}` : tail(output),
          },
    );
  } else if (hasBunTests) {
    // bun's summary is a table, not a "Lines: x%" line — pull the All files row.
    const { output, code } = await run(["bun", "test", name, "--coverage"], root);
    const m = output.match(/All files\s*\|[^|]*\|\s*([\d.]+)/);
    rows.push(
      m
        ? { name, runner: "bun", lines: Number.parseFloat(m[1]) }
        : { name, runner: "bun", lines: null, error: code === 0 ? "no summary in output" : tail(output) },
    );
  } else {
    rows.push({ name, runner: "—", lines: null, untested: true });
  }
}

const width = Math.max(...rows.map((r) => r.name.length));
console.log("");
console.log(`${"package".padEnd(width)}  runner  lines   target ${TARGET}%`);
console.log("-".repeat(width + 30));

const statusOf = (r: Row) => {
  if (r.error) return "FAILED";
  if (r.untested) return "no tests";
  return r.lines! >= TARGET ? "ok" : "below";
};

let met = 0;
for (const r of rows) {
  const value = r.lines === null ? "—" : `${r.lines.toFixed(1)}%`;
  if (r.lines !== null && r.lines >= TARGET) met++;
  console.log(
    `${r.name.padEnd(width)}  ${r.runner.padEnd(6)}  ${value.padStart(6)}  ${statusOf(r)}`,
  );
}

const measured = rows.filter((r) => r.lines !== null).length;
const below = rows.filter((r) => r.lines !== null && r.lines < TARGET);
const failed = rows.filter((r) => r.error);

console.log("-".repeat(width + 30));
console.log(`${met}/${measured} measured packages at or above ${TARGET}% lines`);
if (failed.length > 0) {
  console.log("");
  for (const r of failed) console.log(`  ! ${r.name}: ${r.error}`);
}
console.log("");

// GitHub Actions job summary: rendered on the run page itself, so nobody has to
// download an artifact or scroll the log to see where coverage stands.
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  // A broken measurement gets its own marker. It previously shared the blank circle
  // with "no tests", which made a completely failed run look like a deliberate gap.
  const icon = (r: Row) => (r.error ? "⚠️" : r.untested ? "⚪" : r.lines! >= TARGET ? "🟢" : "🔴");
  const cell = (r: Row) =>
    r.error ? `failed — ${r.error}` : r.untested ? "no tests" : `${r.lines!.toFixed(1)}%`;

  const heading = failed.length
    ? `## Coverage — ${failed.length} package${failed.length > 1 ? "s" : ""} failed to measure`
    : `## Coverage — ${met}/${measured} packages at or above ${TARGET}% lines`;

  appendFileSync(
    summaryPath,
    [
      heading,
      "",
      "| | Package | Runner | Lines |",
      "|---|---|---|---|",
      ...rows.map((r) => `| ${icon(r)} | \`${r.name}\` | ${r.runner} | ${cell(r)} |`),
      "",
      "<sub>Packages without tests are not counted. The playframe family runs under " +
        "`bun test`; everything else under vitest, each from its own config.</sub>",
      "",
    ].join("\n"),
  );
}

// A measurement that silently reports nothing is worse than no report: it reads as
// "this package has no tests". Always fail on it, regardless of --enforce.
if (failed.length > 0) {
  console.error(`coverage could not be measured for: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}

if (ENFORCE && below.length > 0) {
  console.error(
    `below ${TARGET}%: ${below.map((r) => `${r.name} (${r.lines!.toFixed(1)}%)`).join(", ")}`,
  );
  process.exit(1);
}
