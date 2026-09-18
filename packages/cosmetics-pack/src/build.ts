/**
 * One asset of a baked cosmetic: the slot it fills, and the file the export wrote for it.
 *
 * <b>`fileId` is the whole safety mechanism.</b> A bundled file is used only when the server names
 * that same id for that slot, and re-uploading an asset in the admin console mints a new one. So a
 * replaced asset makes every client miss this map and fall back to the network, by itself, with no
 * invalidation anywhere — until a later release exports the new bytes.
 */
export interface PackAsset {
  slot: string;
  fileId: string;
  file: string;
  bytes: number;
  sha256: string;
}

/**
 * One catalogue row whose bytes ship inside this build, as its `entry.json` declares it.
 *
 * `cosmeticId` and `version` are for people and for diagnostics: guids differ between a stand and
 * production, and nothing at runtime compares them. `kindKey`/`slug` name the folder. Only `fileId`
 * decides anything.
 */
export interface PackEntry {
  cosmeticId: string;
  kindKey: string;
  slug: string;

  /**
   * Where the row's text comes from, and what it said in the fallback language when it was exported.
   *
   * Both, because neither alone identifies a unit to somebody reading the folder: `Thorns` says what
   * it is, `cosmetic_frame_thorns` says where to go and change it. <b>Nothing here reads either.</b>
   * The client takes the name off the catalogue, which carries every locale an operator has written
   * — so `name` is a label in a repository, and it is allowed to go stale without anything caring.
   */
  nameKey: string;
  name: string;

  version: number;
  exportedAt: string;
  exportedFrom: string;
  assets: PackAsset[];
}

export interface Pack {
  entries: readonly PackEntry[];
  urlByFileId: ReadonlyMap<string, string>;
  problems: readonly string[];
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/**
 * Turn the two directory listings into the one map the app needs.
 *
 * Kept apart from the globbing so it can be read and tested without a bundler. A malformed or
 * half-copied entry is dropped and reported rather than thrown on: a pack is content somebody
 * unzipped into a folder, and one bad unit must not take the application with it.
 */
export function buildPack(
  entryModules: Record<string, PackEntry>,
  fileModules: Record<string, string>,
): Pack {
  const entries: PackEntry[] = [];
  const urlByFileId = new Map<string, string>();
  const ownerByFileId = new Map<string, string>();
  const problems: string[] = [];
  const seen = new Set<string>();

  // Plain `sort`, matching `cosmetics:check`: which of two entries claiming one file id wins has to
  // be the same answer in both places, and `localeCompare` is collation, which is neither stable
  // across environments nor the order the check reports.
  const listed = Object.entries(entryModules).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  for (const [path, entry] of listed) {
    if (!entry?.kindKey || !entry?.slug || !Array.isArray(entry?.assets)) {
      problems.push(`${path} is not a pack entry`);
      continue;
    }

    const unit = `${entry.kindKey}/${entry.slug}`;

    if (seen.has(unit)) {
      problems.push(`two entries claim ${unit}`);
      continue;
    }

    seen.add(unit);
    entries.push(entry);

    const folder = folderOf(path);

    for (const asset of entry.assets) {
      if (typeof asset?.fileId !== "string" || asset.fileId === "") {
        problems.push(`${unit} has an asset with no fileId, which could match anything`);
        continue;
      }

      const url = fileModules[`${folder}${asset.file}`];

      // A string, not merely truthy: a misconfigured glob can hand back a module object, and storing
      // one would put "[object Object]" in an `img src` rather than report anything.
      if (typeof url !== "string" || url === "") {
        problems.push(`${unit} declares ${asset.file}, which is not in the bundle as a url`);
        continue;
      }

      const owner = ownerByFileId.get(asset.fileId);

      if (owner) {
        problems.push(`${unit} and ${owner} both claim file ${asset.fileId}`);
        continue;
      }

      ownerByFileId.set(asset.fileId, unit);
      urlByFileId.set(asset.fileId, url);
    }
  }

  return { entries, urlByFileId, problems };
}
