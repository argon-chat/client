import { describe, expect, it } from "vitest";
import { AppByBotUser, AppById, type LocalizedText } from "@argon/glue";
import { appRefByBotUser, appRefById, fingerprintLocalized, pickLocalized, toAppRef } from "@/lib/appTexts";

const texts: LocalizedText[] = [
  { key: "motd", locale: "en", value: "Type /help" },
  { key: "motd", locale: "ru", value: "Напиши /help" },
  { key: "description", locale: "de", value: "Ein Bot" },
];

describe("pickLocalized", () => {
  it("takes the reader's own language", () => {
    expect(pickLocalized(texts, "motd", "ru")).toBe("Напиши /help");
  });

  it("falls back to the language without its variant", () => {
    expect(pickLocalized(texts, "motd", "ru_pt")).toBe("Напиши /help");
    expect(pickLocalized(texts, "motd", "en_tengwar")).toBe("Type /help");
  });

  it("falls back to English, and never borrows another key's value", () => {
    expect(pickLocalized(texts, "motd", "de")).toBe("Type /help");
    expect(pickLocalized(texts, "description", "jp")).toBeNull();
  });

  it("has nothing for an application without the key", () => {
    expect(pickLocalized([], "motd", "en")).toBeNull();
  });
});

describe("fingerprintLocalized", () => {
  it("is the same for the same values in any order, and moves when any locale does", () => {
    const same = fingerprintLocalized([...texts].reverse(), "motd");
    const edited = fingerprintLocalized(
      texts.map((t) => (t.locale === "ru" ? { ...t, value: "Напиши /помощь" } : t)),
      "motd",
    );

    expect(fingerprintLocalized(texts, "motd")).toBe(same);
    expect(edited).not.toBe(same);
  });

  it("ignores other keys, and has nothing for a key without values", () => {
    const withoutDescription = texts.filter((t) => t.key !== "description");

    expect(fingerprintLocalized(withoutDescription, "motd")).toBe(fingerprintLocalized(texts, "motd"));
    expect(fingerprintLocalized(texts, "missing")).toBeNull();
  });
});

describe("app refs", () => {
  it("round-trip to the union the server takes", () => {
    const bot = toAppRef(appRefByBotUser("ABC-1"));
    const app = toAppRef(appRefById("DEF-2"));

    expect(bot).toBeInstanceOf(AppByBotUser);
    expect((bot as AppByBotUser).userId).toBe("abc-1");
    expect(app).toBeInstanceOf(AppById);
    expect((app as AppById).appId).toBe("def-2");
  });
});
