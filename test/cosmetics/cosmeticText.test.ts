import { describe, expect, it } from "vitest";

import { cosmeticDescription, cosmeticName } from "@/lib/cosmeticText";

function item(text: Array<{ locale: string; name: string; description: string | null }> | null) {
  return { nameKey: "cosmetic_background_sakura", text } as never;
}

describe("cosmeticText", () => {
  it("prefers the reader's own language", () => {
    const subject = item([
      { locale: "en", name: "Sakura", description: null },
      { locale: "am", name: "Սակուրա", description: null },
    ]);

    expect(cosmeticName(subject, "am")).toBe("Սակուրա");
  });

  it("falls back to english when the language is not written", () => {
    const subject = item([{ locale: "en", name: "Sakura", description: null }]);

    expect(cosmeticName(subject, "jp")).toBe("Sakura");
  });

  it("falls back to the key when nothing is written", () => {
    expect(cosmeticName(item(null), "am")).toBe("cosmetic_background_sakura");
    expect(cosmeticName(item([]), "am")).toBe("cosmetic_background_sakura");
  });

  it("does not take english text for a language that has its own name but no description", () => {
    const subject = item([
      { locale: "en", name: "Sakura", description: "A tree" },
      { locale: "am", name: "Սակուրա", description: null },
    ]);

    expect(cosmeticDescription(subject, "am")).toBeNull();
  });

  it("has no description when nothing is written", () => {
    expect(cosmeticDescription(item(null), "en")).toBeNull();
  });
});
