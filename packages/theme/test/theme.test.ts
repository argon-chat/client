/**
 * Theme handling.
 *
 * hexToHSL feeds Tailwind's CSS custom properties, which expect bare `H S% L%` triples.
 * A wrong conversion does not fail loudly — it just tints the whole app slightly off,
 * so the tests pin known colours rather than checking the shape of the output.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import { hexToHSL, accentColors, useTheme } from "../src";

vi.mock("@argon/core", () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
});

describe("hexToHSL", () => {
  test("converts the achromatic ends", () => {
    expect(hexToHSL("#000000")).toBe("0 0% 0%");
    expect(hexToHSL("#ffffff")).toBe("0 0% 100%");
    expect(hexToHSL("#808080")).toBe("0 0% 50%");
  });

  test("puts the primaries on their standard hues", () => {
    expect(hexToHSL("#ff0000")).toBe("0 100% 50%");
    expect(hexToHSL("#00ff00")).toBe("120 100% 50%");
    expect(hexToHSL("#0000ff")).toBe("240 100% 50%");
  });

  test("puts the secondaries on theirs", () => {
    expect(hexToHSL("#ffff00")).toBe("60 100% 50%");
    expect(hexToHSL("#00ffff")).toBe("180 100% 50%");
    expect(hexToHSL("#ff00ff")).toBe("300 100% 50%");
  });

  test("accepts the hash as optional and is case-insensitive", () => {
    expect(hexToHSL("ff0000")).toBe("0 100% 50%");
    expect(hexToHSL("#FF0000")).toBe("0 100% 50%");
  });

  test("emits bare numbers, the format the CSS variables expect", () => {
    // hsl(var(--primary)) only works if the variable holds `H S% L%` with no wrapper.
    expect(hexToHSL("#3b82f6")).toMatch(/^\d+ \d+% \d+%$/);
  });

  test("falls back to a usable colour for anything unparseable", () => {
    // Returning an empty string would leave the variable unset and break the palette.
    for (const bad of ["", "#fff", "not-a-color", "#12345g", "#1234567"]) {
      expect(hexToHSL(bad), bad).toBe("240 5.9% 10%");
    }
  });

  test("every shipped accent colour converts to a real triple", () => {
    for (const [name, hex] of Object.entries(accentColors)) {
      expect(hexToHSL(hex), name).not.toBe("240 5.9% 10%");
      expect(hexToHSL(hex), name).toMatch(/^\d+ \d+% \d+%$/);
    }
  });

  test("lightness tracks brightness, not hue", () => {
    const dark = Number(hexToHSL("#1a1a2e").split(" ")[2].replace("%", ""));
    const light = Number(hexToHSL("#e8e8f5").split(" ")[2].replace("%", ""));
    expect(dark).toBeLessThan(light);
  });
});

describe("useTheme", () => {
  test("defaults to dark and marks the document", () => {
    const { currentTheme, applyTheme } = useTheme();
    applyTheme();

    expect(currentTheme.value).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("light removes the dark marker rather than adding its own", () => {
    const { applyTheme } = useTheme();
    applyTheme("dark");
    applyTheme("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  test("oled is dark plus inline overrides, so the base theme still applies", () => {
    const { applyTheme } = useTheme();
    applyTheme("oled");

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("0 0% 0%");
  });

  test("switching away from oled clears its overrides", () => {
    // Leaving them behind would keep the app pure black under every other theme.
    const { applyTheme } = useTheme();
    applyTheme("oled");
    applyTheme("dark");

    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  test("system follows the OS preference", () => {
    const { applyTheme } = useTheme();

    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("the choice survives a reload", async () => {
    useTheme().applyTheme("oled");
    const persisted = useTheme();
    persisted.applyTheme("oled");
    await nextTick();

    expect(useTheme().currentTheme.value).toBe("oled");
  });
});
