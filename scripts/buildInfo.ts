/**
 * What this build is — GitVersion's answer, worked out here instead of by GitVersion.
 *
 * **Why this exists.** The version, branch and commit used to reach the app through `package.json`:
 * `"{branch}"` and `"0.0.0"` were literal placeholders, and a NUKE target rewrote them from
 * `GitVersion` before vite ran. That works for exactly one pipeline. Every other way of building —
 * the dev server, `bun run build`, Cloudflare Pages — never ran it, so the placeholders shipped and
 * the console said `ARGON v0.0.0 {branch}`. With NUKE going away there would be no pipeline left
 * that filled them in at all.
 *
 * **What it reproduces.** `GitVersion.yml`, read at build time, and the two format strings it
 * declares — which are the only ones the app ever used:
 *
 *   assembly-file-versioning-format    {Major}.{Minor}.{Patch}.{CommitsSinceVersionSource}
 *   assembly-informational-format      …-{BranchName}+{ShortSha}
 *
 * **Why there are no tags in any of this.** `tag-prefix: 'IGNORE'` — no tag can match it, so
 * GitVersion never finds a version source in this repository, and `next-version` is the whole of
 * the base version. `CommitsSinceVersionSource` is then simply the depth of history. Anything that
 * reaches for `git describe --tags` here is answering a question this configuration does not ask.
 *
 * **What it does not reproduce.** `commit-message-incrementing` with `patch-version-bump-message`.
 * Those increments apply on top of a version *source*, and with tags ignored there is never one —
 * the patch stays where `next-version` puts it and the commit count is what moves. Add a version
 * source and this file needs revisiting; until then the rule is configured and inert.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BuildInfo {
  /** `{Major}.{Minor}.{Patch}.{CommitsSinceVersionSource}` — what GitVersion calls AssemblySemFileVer. */
  version: string;
  /** The informational format, branch and short sha included. */
  fullVersion: string;
  branch: string;
  /** Short sha, eight characters, as the old pipeline cut it. */
  commit: string;
  /** ISO 8601, UTC, second precision. */
  builtAt: string;
  /** The working tree had uncommitted changes — a local build, not a reproducible one. */
  dirty: boolean;
}

/** Asks git, and returns null rather than failing the build when git cannot answer. */
function git(...args: string[]): string | null {
  try {
    const out = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    // No git, no repository, or a command this repository cannot serve. All mean the same to a
    // caller: fall through to the next source.
    return null;
  }
}

const firstOf = (...values: (string | undefined | null)[]): string | null =>
  values.find((v) => typeof v === "string" && v.trim().length > 0)?.trim() ?? null;

/**
 * The handful of keys this needs out of `GitVersion.yml`.
 *
 * Not a YAML parser, and not pretending to be: the file is a flat map of scalars, the project has
 * no YAML dependency, and adding one to read five keys at build time is a poor trade. Anything it
 * cannot parse falls back to the defaults below, which are the values the file carries today — so a
 * reformatted config produces a wrong-but-working version rather than a failed build.
 */
function readGitVersionConfig(root: string) {
  const defaults = {
    nextVersion: "2.255.0",
    tagPrefix: "IGNORE",
    fileFormat: "{Major}.{Minor}.{Patch}.{CommitsSinceVersionSource}",
    informationalFormat: "{Major}.{Minor}.{Patch}.{CommitsSinceVersionSource}-{BranchName}+{ShortSha}",
  };

  let text: string;
  try {
    text = readFileSync(join(root, "GitVersion.yml"), "utf8");
  } catch {
    return defaults;
  }

  const read = (key: string): string | null => {
    // Top level only, value optionally quoted. A leading BOM is why the line anchor allows one.
    const match = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, "m").exec(text);
    if (!match) return null;
    return match[1].replace(/^['"]|['"]$/g, "").trim() || null;
  };

  return {
    nextVersion: read("next-version") ?? defaults.nextVersion,
    tagPrefix: read("tag-prefix") ?? defaults.tagPrefix,
    fileFormat: read("assembly-file-versioning-format") ?? defaults.fileFormat,
    informationalFormat: read("assembly-informational-format") ?? defaults.informationalFormat,
  };
}

/** `{Token}` substitution, the way GitVersion's format strings work. */
const render = (format: string, variables: Record<string, string>): string =>
  format.replace(/\{(\w+)\}/g, (whole, name: string) => variables[name] ?? whole);

export function resolveBuildInfo(root: string): BuildInfo {
  const env = process.env;
  const config = readGitVersionConfig(root);

  const branch =
    firstOf(
      env.ARGON_BUILD_BRANCH,
      // Cloudflare Pages, GitHub Actions, GitLab. On a pull request `GITHUB_HEAD_REF` is the source
      // branch, which is what GitVersion would have seen; `GITHUB_REF_NAME` would be "<n>/merge".
      env.CF_PAGES_BRANCH,
      env.GITHUB_HEAD_REF,
      env.GITHUB_REF_NAME,
      env.CI_COMMIT_REF_NAME,
      git("rev-parse", "--abbrev-ref", "HEAD"),
    ) ?? "unknown";

  const sha =
    firstOf(
      env.ARGON_BUILD_COMMIT,
      env.CF_PAGES_COMMIT_SHA,
      env.GITHUB_SHA,
      env.CI_COMMIT_SHA,
      git("rev-parse", "HEAD"),
    ) ?? "unknown";

  // WITH NO VERSION SOURCE THIS IS THE WHOLE HISTORY. It is also the one number a shallow clone
  // gets wrong — and wrong quietly, because a truncated history still counts. Said out loud below
  // rather than left to be discovered from a version that went backwards between two builds.
  const shallow = git("rev-parse", "--is-shallow-repository") === "true";
  const commitCount = git("rev-list", "--count", "HEAD") ?? "0";

  if (shallow) {
    console.warn(
      "[build-info] this is a shallow clone, so CommitsSinceVersionSource is the depth of the " +
      "clone rather than of the history — the version will be too low. Clone with full history, " +
      "or pass ARGON_BUILD_VERSION.",
    );
  }

  const [major = "0", minor = "0", patch = "0"] = config.nextVersion.split(".");

  const variables: Record<string, string> = {
    Major: major,
    Minor: minor,
    Patch: patch,
    CommitsSinceVersionSource: commitCount,
    BranchName: branch,
    EscapedBranchName: branch.replace(/[^\w-]/g, "-"),
    ShortSha: sha.slice(0, 8),
    Sha: sha,
    SemVer: `${major}.${minor}.${patch}`,
  };

  return {
    version: firstOf(env.ARGON_BUILD_VERSION, render(config.fileFormat, variables))!,
    fullVersion: render(config.informationalFormat, variables),
    branch: branch === "HEAD" ? "detached" : branch,
    commit: variables.ShortSha,
    builtAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    // Only ever true locally: CI checks out clean, so this is how a build from somebody's laptop
    // says that its commit does not describe what is actually in it.
    dirty: (git("status", "--porcelain") ?? "") !== "",
  };
}
