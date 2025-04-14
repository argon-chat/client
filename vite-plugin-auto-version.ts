import { Plugin } from "vite";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function parseVersion(version: string) {
  const [major, minor, patch, build = "0"] = version
    .split(".")
    .map((part) => Number(part) || 0);
  return { major, minor, patch, build };
}

function stringifyVersion({ major, minor, patch, build }: any) {
  return `${major}.${minor}.${patch}.${build}`;
}

function getCurrentBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
    } catch (e) {
      return 'unknown'
    }
  }

export default function AutoVersionPlugin(): Plugin {
  return {
    name: "vite-plugin-auto-version",
    buildStart() {
      const pkgPath = path.resolve(process.cwd(), "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const currentVersion = parseVersion(pkg.version);

      const log = execSync("git log --pretty=%B").toString().toLowerCase();

      const countMatches = (pattern: RegExp) =>
        (log.match(pattern) || []).length;

      const minorWords = /(add|update|change|remove)/g;
      const patchWords = /(fix|try|missed|revert|do|unused|refactor|drop|upd)/g;

      const minorIncrement = countMatches(minorWords);
      const patchIncrement = countMatches(patchWords);
      const branch = getCurrentBranch();

      const newVersion = {
        major: currentVersion.major,
        minor: currentVersion.minor,
        patch: patchIncrement + minorIncrement,
        build: Number(currentVersion.build) + 1,
      };

      pkg.version = stringifyVersion(newVersion);
      pkg.fullVersion = `${newVersion.major}.${newVersion.minor}.${newVersion.patch}.${newVersion.build}-${branch}`;
      pkg.branch = branch;
      pkg.lastBuildTime = new Date().toISOString();

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
      console.log(`📦 Version updated to: ${pkg.version}`);
    },
  };
}
