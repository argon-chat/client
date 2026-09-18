/**
 * Turning a bundle name into something `<html lang>` is allowed to say.
 *
 * **Why this is not a formality.** The bundles are named the way files are — `ru_pt` — and BCP 47
 * has no underscore in it. A tag with one is invalid, and everything that reads `lang` rejects it
 * the same way: by ignoring it and assuming English. Those readers are all invisible in testing —
 * a screen reader picking a voice, the browser picking hyphenation and quote marks, the offer to
 * translate the page — so nothing here looks wrong while all of them are wrong.
 *
 * The bundle names are `am`, `en`, `jp`, `ru` and `ru_pt`, and only the last one has anything to
 * convert; the tests cover the shapes rather than the list, because the list grows.
 */
import { describe, it, expect } from "vitest";
import { documentLanguage } from "@/store/system/localeStore";

describe("locale key as a document language", () => {
  it.each(["en", "ru", "jp", "am"])("passes a plain language through: %s", (locale) => {
    expect(documentLanguage(locale)).toBe(locale);
  });

  /** The one bundle that would otherwise emit an invalid tag. */
  it("turns an underscore into the separator BCP 47 actually uses", () => {
    expect(documentLanguage("ru_pt")).toBe("ru-PT");
  });

  it("upper-cases the region, which is how tags are matched", () => {
    expect(documentLanguage("en-gb")).toBe("en-GB");
    expect(documentLanguage("pt_br")).toBe("pt-BR");
  });

  it("lower-cases the language, for the same reason", () => {
    expect(documentLanguage("EN")).toBe("en");
    expect(documentLanguage("RU_PT")).toBe("ru-PT");
  });

  it("leaves an already-correct tag alone", () => {
    expect(documentLanguage("ru-PT")).toBe("ru-PT");
  });

  /** Whatever comes out must be a tag, never an underscore smuggled through. */
  it.each(["ru_pt", "en_us", "pt_br"])("never emits an underscore: %s", (locale) => {
    expect(documentLanguage(locale)).not.toContain("_");
  });
});
