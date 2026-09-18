import { describe, expect, it } from "vitest";
import { buildPack, type PackEntry } from "@argon/cosmetics-pack/build";

// `fileStorage` reaches `cdnCache`, which reads localStorage while it is being imported. This
// environment has none, which is the same gap the other nine suites die on — stubbed here so the
// module can be loaded at all, and dynamically imported afterwards so the stub is in place first.
if (!globalThis.localStorage) {
  const stored = new Map<string, string>();

  const stub = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, String(value)),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() {
      return stored.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });

  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
  }
}

const { cdnUrl, registerBundledFiles, setFileUrlOverride } = await import("@/store/system/fileStorage");

const entry: PackEntry = {
  cosmeticId: "3f6b1c2e-0000-0000-0000-000000000001",
  kindKey: "profile.background",
  slug: "sakura",
  nameKey: "cosmetic_sakura",
  name: "Sakura",
  version: 3,
  exportedAt: "2026-09-18T10:00:00Z",
  exportedFrom: "https://api.argon.gl",
  assets: [{ slot: "Primary", fileId: "file-1", file: "Primary.webm", bytes: 10, sha256: "a" }],
};

describe("buildPack", () => {
  it("maps a declared fileId onto the bundled url", () => {
    const pack = buildPack(
      { "../items/profile.background/sakura/entry.json": entry },
      { "../items/profile.background/sakura/Primary.webm": "/assets/Primary-abc123.webm" },
    );

    expect(pack.urlByFileId.get("file-1")).toBe("/assets/Primary-abc123.webm");
    expect(pack.entries).toHaveLength(1);
    expect(pack.problems).toEqual([]);
  });

  it("drops an asset whose file is not in the bundle", () => {
    const pack = buildPack({ "../items/profile.background/sakura/entry.json": entry }, {});

    expect(pack.urlByFileId.size).toBe(0);
    expect(pack.problems[0]).toContain("Primary.webm");
  });

  it("keeps the first of two entries claiming one fileId and reports the clash", () => {
    const other: PackEntry = { ...entry, slug: "rain" };

    const pack = buildPack(
      {
        "../items/profile.background/rain/entry.json": other,
        "../items/profile.background/sakura/entry.json": entry,
      },
      {
        "../items/profile.background/rain/Primary.webm": "/assets/rain.webm",
        "../items/profile.background/sakura/Primary.webm": "/assets/sakura.webm",
      },
    );

    expect(pack.urlByFileId.get("file-1")).toBe("/assets/rain.webm");
    expect(pack.problems.some(problem => problem.includes("file-1"))).toBe(true);
  });

  it("refuses a file the bundler handed back as something other than a url", () => {
    const pack = buildPack(
      { "../items/profile.background/sakura/entry.json": entry },
      // What `vite-svg-loader` returns for an `.svg` imported without `?url`.
      { "../items/profile.background/sakura/Primary.webm": { render: () => null } as unknown as string },
    );

    expect(pack.urlByFileId.size).toBe(0);
    expect(pack.problems[0]).toContain("not in the bundle as a url");
  });

  it("refuses an asset with no fileId, which would match anything", () => {
    const nameless: PackEntry = {
      ...entry,
      assets: [{ slot: "Primary", fileId: "", file: "Primary.webm", bytes: 10, sha256: "a" }],
    };

    const pack = buildPack(
      { "../items/profile.background/sakura/entry.json": nameless },
      { "../items/profile.background/sakura/Primary.webm": "/assets/sakura.webm" },
    );

    expect(pack.urlByFileId.size).toBe(0);
    expect(pack.problems[0]).toContain("no fileId");
  });

  it("reports a folder holding something that is not an entry", () => {
    const pack = buildPack(
      { "../items/profile.background/sakura/entry.json": { kindKey: "" } as unknown as PackEntry },
      {},
    );

    expect(pack.entries).toHaveLength(0);
    expect(pack.problems[0]).toContain("is not a pack entry");
  });
});

describe("bundled files in cdnUrl", () => {
  it("answers a registered fileId from the bundle without asking the api", () => {
    registerBundledFiles(new Map([["file-1", "/assets/Primary-abc123.webm"]]));

    expect(cdnUrl("file-1")).toBe("/assets/Primary-abc123.webm");

    registerBundledFiles(new Map());
  });

  it("steps out of the way when the cdn cache is switched off for diagnosis", async () => {
    const { createPinia, setActivePinia } = await import("pinia");
    const { cdnCacheEnabled } = await import("@/store/system/cdnCache");

    setActivePinia(createPinia());

    registerBundledFiles(new Map([["file-1", "/assets/Primary-abc123.webm"]]));
    cdnCacheEnabled.value = false;

    // The switch promises no layers between the screen and the server's answer, so the bundle has
    // to be one of the layers it removes — it is the one most likely to be holding wrong bytes.
    expect(cdnUrl("file-1")).toBe("https://api.argon.gl/files/file-1");

    cdnCacheEnabled.value = true;

    expect(cdnUrl("file-1")).toBe("/assets/Primary-abc123.webm");

    registerBundledFiles(new Map());
  });

  it("lets the preview override win over the bundle", () => {
    registerBundledFiles(new Map([["file-1", "/assets/Primary-abc123.webm"]]));
    setFileUrlOverride(fileId => `https://stand.local/files/${fileId}`);

    expect(cdnUrl("file-1")).toBe("https://stand.local/files/file-1");

    setFileUrlOverride(null);
    registerBundledFiles(new Map());
  });
});
