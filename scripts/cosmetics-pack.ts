/**
 * The cosmetics pack: catalogue rows whose bytes ship inside this build.
 *
 * A cosmetic is born dynamic — an operator creates it in the admin console, people get it the same
 * day, and its files come off the CDN. When somebody gets round to a client release, the console
 * exports those files as a zip and they are unpacked here. From then on the app draws them out of
 * its own bundle: no CDN hop, no 302, nothing to lose after a cache is cleared.
 *
 * <b>Nothing here changes what the server sends.</b> A bundled file is used only when the server
 * names the same `fileId` for the same slot, so replacing an asset in the console (which mints a new
 * id) sends every client back to the network by itself, until a later release exports the new bytes.
 * That is why a stale pack can only ever be slower and never wrong — and why this check cares far
 * more about a file whose bytes do not match its entry than about one that is merely old.
 *
 *   bun run cosmetics:check            # verify what is in the pack; the build gate
 *   bun run cosmetics:check --json     # machine-readable, for anything downstream
 *   bun run cosmetics:import <zip>     # unpack an export from the admin console, then check
 *
 * A folder is the unit: `items/<kindKey>/<slug>/` holds `entry.json` and the files it names. Delete
 * the folder and the local copy ceases to exist — the row keeps working, off the CDN.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { unzipSync } from "fflate";

const root = resolve(import.meta.dir, "..");
const PACK_DIR = resolve(root, "packages", "cosmetics-pack");
const ITEMS_DIR = resolve(PACK_DIR, "items");
const KINDS_DIR = resolve(root, "src", "cosmetics", "kinds");

/**
 * What the pack may weigh before this fails.
 *
 * Every baked cosmetic is in the bundle forever — that is what "no longer switchable off" costs, and
 * unlike the CDN it is paid by everyone who downloads the app rather than by the people who wear the
 * thing. Bake what is evergreen; leave a limited drop on the CDN where it can also stop existing.
 */
const BUDGET_BYTES = 24 * 1024 * 1024;

/** Printed on every run, not only on a failure — the number is the point. */
const HEAVIEST = 5;

interface PackAsset {
  slot: string;
  fileId: string;
  file: string;
  bytes: number;
  sha256: string;
}

interface PackEntry {
  cosmeticId: string;
  kindKey: string;
  slug: string;

  /** Where the text comes from, and what it said in the fallback language at export time. */
  nameKey: string;
  name: string;

  version: number;
  exportedAt: string;
  exportedFrom: string;
  assets: PackAsset[];
}

interface CheckedUnit {
  unit: string;
  entry: PackEntry;
  bytes: number;
}

interface CheckReport {
  units: CheckedUnit[];
  files: number;
  bytes: number;
  failures: string[];
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Which kinds this build can draw, read the way the app reads them: the directory listing.
 *
 * A pack entry for a kind with no file here is dead weight — the renderer skips the row, so the
 * bytes are downloaded by every user and shown to none.
 */
function shippedKinds(): Set<string> {
  const keys = new Set<string>();

  for (const name of readdirSync(KINDS_DIR)) {
    if (!name.endsWith(".ts")) continue;

    const source = readFileSync(join(KINDS_DIR, name), "utf8");
    const declared = source.match(/^\s*key:\s*"([^"]+)"/m);

    if (declared) keys.add(declared[1]);
  }

  return keys;
}

function entryFiles(): string[] {
  if (!existsSync(ITEMS_DIR)) return [];

  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);

      if (statSync(path).isDirectory()) walk(path);
      else if (name === "entry.json") found.push(path);
    }
  };

  walk(ITEMS_DIR);

  return found.sort();
}

function check(): CheckReport {
  const kinds = shippedKinds();
  const failures: string[] = [];
  const units: CheckedUnit[] = [];
  const seenUnits = new Map<string, string>();
  const seenFileIds = new Map<string, string>();
  let files = 0;
  let bytes = 0;

  for (const path of entryFiles()) {
    const shown = relative(root, path);
    const folder = dirname(path);
    let entry: PackEntry;

    try {
      entry = JSON.parse(readFileSync(path, "utf8")) as PackEntry;
    } catch (error) {
      failures.push(`${shown}: not valid JSON (${(error as Error).message})`);
      continue;
    }

    // `name` and `nameKey` are labels nothing draws from — the client takes the name off the
    // catalogue — but they are required here all the same. This is the authoring gate, the export
    // always writes both, and an entry without them was hand-edited or came out of an older
    // exporter, which is worth knowing before it is committed.
    const missing = (["cosmeticId", "kindKey", "slug", "nameKey", "name", "version", "assets"] as const)
      .filter(field => entry[field] === undefined || entry[field] === null || entry[field] === "");

    if (missing.length > 0) {
      failures.push(`${shown}: missing ${missing.join(", ")}`);
      continue;
    }

    if (!Array.isArray(entry.assets)) {
      failures.push(`${shown}: assets is not a list`);
      continue;
    }

    const unit = `${entry.kindKey}/${entry.slug}`;
    const expected = resolve(ITEMS_DIR, entry.kindKey, entry.slug);

    if (folder !== expected) {
      failures.push(`${shown}: lives in ${relative(ITEMS_DIR, folder)} but declares ${unit}`);
      continue;
    }

    const twin = seenUnits.get(unit);

    if (twin) {
      failures.push(`${shown}: ${unit} is already declared by ${twin}`);
      continue;
    }

    seenUnits.set(unit, shown);

    if (!kinds.has(entry.kindKey)) {
      failures.push(`${shown}: this build ships no kind ${entry.kindKey}, so nothing would draw it`);
      continue;
    }

    let unitBytes = 0;

    for (const asset of entry.assets) {
      const file = join(folder, asset.file ?? "");

      if (!asset.file || !existsSync(file)) {
        failures.push(`${unit}: declares ${asset.file ?? "(no file)"}, which is not here`);
        continue;
      }

      const content = readFileSync(file);

      if (content.byteLength !== asset.bytes) {
        failures.push(`${unit}/${asset.file}: entry says ${asset.bytes} bytes, file is ${content.byteLength}`);
        continue;
      }

      const digest = createHash("sha256").update(content).digest("hex");

      if (digest !== asset.sha256) {
        failures.push(`${unit}/${asset.file}: sha256 is ${digest}, entry says ${asset.sha256}`);
        continue;
      }

      const owner = seenFileIds.get(asset.fileId);

      if (owner) {
        failures.push(`${unit}: file ${asset.fileId} is already claimed by ${owner}`);
        continue;
      }

      seenFileIds.set(asset.fileId, unit);
      files += 1;
      unitBytes += content.byteLength;
    }

    bytes += unitBytes;
    units.push({ unit, entry, bytes: unitBytes });
  }

  if (bytes > BUDGET_BYTES) {
    failures.push(`the pack is ${megabytes(bytes)} MB, over the ${megabytes(BUDGET_BYTES)} MB budget`);
  }

  return { units, files, bytes, failures };
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function report(result: CheckReport, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(
      {
        entries: result.units.length,
        files: result.files,
        bytes: result.bytes,
        budgetBytes: BUDGET_BYTES,
        units: result.units.map(({ unit, bytes, entry }) => ({ unit, name: entry.name, bytes })),
        failures: result.failures,
      },
      null,
      2,
    ));

    return;
  }

  console.log(
    `${result.units.length} entries, ${result.files} files, ` +
    `${megabytes(result.bytes)} MB of ${megabytes(BUDGET_BYTES)} MB`,
  );

  const heaviest = [...result.units].sort((left, right) => right.bytes - left.bytes).slice(0, HEAVIEST);

  for (const { unit, bytes, entry } of heaviest) {
    console.log(`  ${megabytes(bytes).padStart(6)} MB  ${unit}  ${entry.name}`);
  }

  for (const failure of result.failures) {
    console.error(`  ✗ ${failure}`);
  }
}

/**
 * Unpack an export from the admin console.
 *
 * A folder is replaced whole rather than merged: the export is what the operator approved, and a
 * file left behind from an earlier one is a file nothing declares and the check would reject.
 */
function importPack(zipPath: string): void {
  if (!existsSync(zipPath)) fail(`no such file: ${zipPath}`);

  const unpacked = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const paths = Object.keys(unpacked).filter(path => !path.endsWith("/"));
  const stray = paths.filter(path => !path.startsWith("items/") && path !== "pack.json");

  if (stray.length > 0) fail(`this zip is not a cosmetics pack — it holds ${stray[0]}`);

  const wanted = paths.filter(path => path.startsWith("items/"));

  if (wanted.length === 0) fail("this zip holds no items/");

  // A zip is a file handed over by somebody, and an entry named `items/../../…` starts with
  // `items/` while pointing anywhere on the disk. Since this both writes files and deletes whole
  // folders, every path is resolved and then checked to still be inside the pack before either.
  // `ITEMS_DIR` itself is refused along with everything above it. No real key can resolve to it —
  // every one of them is `items/<kind>/<slug>`, strictly below — so allowing it would only ever
  // admit a traversal, and the thing it admits is `rmSync` on the whole pack.
  const inside = (candidate: string): string => {
    const target = resolve(ITEMS_DIR, relative("items", candidate));

    if (!target.startsWith(`${ITEMS_DIR}${sep}`))
      fail(`this zip tries to write outside the pack: ${candidate}`);

    return target;
  };

  const folders = new Set(wanted.map(path => path.split("/").slice(0, 3).join("/")));

  for (const folder of folders) {
    const target = inside(folder);

    if (existsSync(target)) rmSync(target, { recursive: true });
  }

  for (const path of wanted) {
    const target = inside(path);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, unpacked[path]);
  }

  console.log(`unpacked ${folders.size} units, ${wanted.length} files into ${relative(root, ITEMS_DIR)}`);
}

const [command, ...rest] = process.argv.slice(2);

if (command === "import") {
  const zipPath = rest.find(argument => !argument.startsWith("--"));

  if (!zipPath) fail("usage: bun run cosmetics:import <zip>");

  importPack(resolve(process.cwd(), zipPath));
}

if (command !== "check" && command !== "import") {
  fail("usage: bun run scripts/cosmetics-pack.ts check|import [<zip>] [--json]");
}

const result = check();

report(result, rest.includes("--json"));

if (result.failures.length > 0) process.exit(1);
