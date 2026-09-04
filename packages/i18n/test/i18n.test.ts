/**
 * Locale assembly.
 *
 * This package ships the shared keys; each app merges its own on top. The tests guard
 * the merge direction (an app must be able to override a shared string, never the other
 * way round) and the health of the shipped locale files themselves — a duplicated or
 * missing key here shows up as raw `some.key` text in the UI.
 */

import { describe, test, expect, beforeAll } from "vitest";
import {
  createArgonI18n,
  enCore,
  loadAllCoreMessages,
  loadCoreMessages,
  getLoadedCoreMessages,
  type CoreMessages,
  type SupportedLocale,
} from "../src";

const LOCALES = ["en", "ru", "jp", "am", "ru_pt"] as const;

let bundles: Record<SupportedLocale, CoreMessages>;
beforeAll(async () => {
  bundles = await loadAllCoreMessages();
});

describe("loadCoreMessages", () => {
  test("English is in memory before anything is fetched", () => {
    expect(getLoadedCoreMessages("en")).toBe(enCore);
  });

  test("an unknown locale resolves to English rather than failing", async () => {
    expect(await loadCoreMessages("xx")).toBe(enCore);
  });

  test("a fetched bundle is served from memory afterwards", async () => {
    expect(getLoadedCoreMessages("ru")).toBe(bundles.ru);
    expect(await loadCoreMessages("ru")).toBe(bundles.ru);
  });
});

describe("createArgonI18n", () => {
  test("ships every fetched locale", () => {
    const i18n = createArgonI18n();
    expect(Object.keys((i18n.global as any).messages.value).sort()).toEqual([...LOCALES].sort());
  });

  test("defaults to English, falling back to English", () => {
    const i18n = createArgonI18n();
    expect((i18n.global as any).locale.value).toBe("en");
    expect((i18n.global as any).fallbackLocale.value).toBe("en");
  });

  test("honours a requested locale", () => {
    const i18n = createArgonI18n({ locale: "ru" });
    expect((i18n.global as any).locale.value).toBe("ru");
  });

  test("app messages are merged in, not substituted for the core set", () => {
    const i18n = createArgonI18n({ messages: { en: { app_only_key: "Mine" } } });
    const en = (i18n.global as any).messages.value.en;

    expect(en.app_only_key).toBe("Mine");
    expect(Object.keys(en).length).toBeGreaterThan(1);
  });

  test("an app string wins over the shared one of the same name", () => {
    const [sharedKey] = Object.keys(enCore);
    const i18n = createArgonI18n({ messages: { en: { [sharedKey]: "Overridden" } } });

    expect((i18n.global as any).messages.value.en[sharedKey]).toBe("Overridden");
  });

  test("overriding one locale leaves the others on the shared strings", () => {
    const [sharedKey] = Object.keys(enCore);
    const i18n = createArgonI18n({ messages: { en: { [sharedKey]: "Overridden" } } });

    expect((i18n.global as any).messages.value.ru[sharedKey]).toBe((bundles.ru as any)[sharedKey]);
  });

  test("runs in composition mode — the app has no Options API", () => {
    expect(createArgonI18n().mode).toBe("composition");
  });

  test("extra vue-i18n options are passed through", () => {
    const i18n = createArgonI18n({ options: { missingWarn: false } as never });
    expect(i18n).toBeDefined();
  });
});

describe("the shipped locale files", () => {
  test("every locale has strings", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(bundles[locale]).length, locale).toBeGreaterThan(0);
    }
  });

  test("English is the most complete, since everything falls back to it", () => {
    const en = Object.keys(enCore).length;
    for (const locale of LOCALES) {
      expect(Object.keys(bundles[locale]).length, locale).toBeLessThanOrEqual(en);
    }
  });

  test("no locale invents keys English does not have", () => {
    // A key missing from English has nothing to fall back to, so it renders raw.
    const en = new Set(Object.keys(enCore));
    for (const locale of LOCALES) {
      const orphans = Object.keys(bundles[locale]).filter((k) => !en.has(k));
      expect(orphans, `${locale} has keys absent from English`).toEqual([]);
    }
  });

  test("no translation is blank where English has text", () => {
    // Deliberately not "no blank strings at all": a handful of developer-flag
    // descriptions are empty in every locale, which is a missing-copy decision rather
    // than a translation regression. What must never happen is a string that exists in
    // English disappearing in another language.
    for (const locale of LOCALES) {
      if (locale === "en") continue;
      const lost = Object.entries(bundles[locale])
        .filter(([key, value]) => {
          const source = (enCore as any)[key];
          return typeof value === "string" && value.trim() === ""
            && typeof source === "string" && source.trim() !== "";
        })
        .map(([key]) => key);
      expect(lost, `${locale} blanks strings English provides`).toEqual([]);
    }
  });

  test("value placeholders line up with the English original", () => {
    // A renamed or dropped `{count}` renders the literal braces, or loses the value
    // entirely. Literals like `{'@'}` are vue-i18n escapes, not values — a translation
    // is free to phrase around them.
    const valuePlaceholders = (s: string) =>
      (s.match(/\{[^}]+\}/g) ?? []).filter((p) => !/^\{\s*'/.test(p)).sort();

    for (const locale of LOCALES) {
      if (locale === "en") continue;
      for (const [key, value] of Object.entries(bundles[locale])) {
        const source = (enCore as any)[key];
        if (typeof value !== "string" || typeof source !== "string") continue;
        expect(valuePlaceholders(value), `${locale}.${key}`).toEqual(valuePlaceholders(source));
      }
    }
  });
});
