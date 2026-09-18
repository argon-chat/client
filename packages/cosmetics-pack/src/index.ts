import { buildPack, type Pack, type PackEntry } from "./build";

/**
 * Every cosmetic whose bytes ship inside this build: one folder per catalogue row.
 *
 * The directory listing is the manifest — the same arrangement `kinds/*.ts` and `@argon/inventory`
 * use, and for the same reason. Delete a folder and the local copy ceases to exist: the row keeps
 * working, its files simply come from the CDN again. Nothing lists them by hand, so nothing can be
 * out of date.
 *
 * A pack is exported from a stand by the admin console and unzipped here, which is why every entry
 * is treated as untrusted content: `buildPack` reports a broken unit instead of throwing.
 */
const entryModules = import.meta.glob("../items/**/entry.json", {
  eager: true,
  import: "default",
}) as Record<string, PackEntry>;

/**
 * The bytes themselves, as urls Vite has already emitted.
 *
 * Anything small enough lands inline as a `data:` uri and costs no request at all; the rest becomes
 * a hashed file served from the application's own origin, which a browser caches immutably and a
 * desktop build reads off disk.
 *
 * <b>`?url` is load-bearing, not tidiness.</b> This app builds with `vite-svg-loader`, which turns a
 * plain `.svg` import into a Vue component object — and since the glob is cast to strings, that
 * object would be stored as if it were a url and end up in an `img src`. An svg badge that worked
 * over the network would break the moment it was baked, with nothing reporting it.
 */
const fileModules = import.meta.glob(
  "../items/**/*.{png,jpg,jpeg,webp,avif,gif,svg,webm,mp4,woff,woff2,ttf,otf}",
  { eager: true, import: "default", query: "?url" },
) as Record<string, string>;

export const pack: Pack = buildPack(entryModules, fileModules);

export { buildPack } from "./build";
export type { Pack, PackAsset, PackEntry } from "./build";
