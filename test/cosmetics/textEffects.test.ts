import { describe, expect, it } from "vitest";
import { parseTextEffectOptionPayload, textEffect, textEffects } from "@/cosmetics/kinds/option-text-effect";
import type { TextEffectContext } from "@/cosmetics/textEffect";

/**
 * The one family of option a catalogue row cannot carry on its own.
 *
 * A colour is a number and a face is a family name and a file, so an operator adds either from the
 * console. A treatment is rules and keyframes, which have to ship in the client — so the row and
 * the file find each other by slug, and a row whose slug this build has no file for is left out of
 * the picker rather than offered and then rendering as nothing.
 */
const context = (stops: string[]): TextEffectContext => ({
  stops,
  tint: stops[0] ?? null,
  lighten: (hex, amount) => `lighten(${hex}, ${amount})`,
  shade: (hex, amount) => `shade(${hex}, ${amount})`,
  gradient: (...laid) => ({ backgroundImage: `linear-gradient(90deg, ${laid.join(", ")})` }),
});

describe("the payload of a treatment row", () => {
  it("is an empty object and nothing else", () => {
    expect(parseTextEffectOptionPayload({})).toEqual({});

    // The server refuses a member the type does not declare, and this type declares none.
    expect(parseTextEffectOptionPayload({ css: "color: red" })).toBeNull();
    expect(parseTextEffectOptionPayload([])).toBeNull();
    expect(parseTextEffectOptionPayload(null)).toBeNull();
    expect(parseTextEffectOptionPayload("gradient")).toBeNull();
  });
});

describe("the treatments this build ships", () => {
  it("finds each one by its slug", () => {
    expect(textEffects().map(effect => effect.slug).sort())
      .toEqual(["glow", "gradient", "shimmer"]);
  });

  it("has nothing for a slug released after it", () => {
    expect(textEffect("prismatic")).toBeUndefined();
  });
});

describe("gradient", () => {
  it("paints the colours the wearer chose", () => {
    const style = textEffect("gradient")!.style(context(["#112233", "#445566"]));

    expect(style!.backgroundImage).toBe("linear-gradient(90deg, #112233, #445566)");
  });

  it("invents a second colour when there is only one", () => {
    const style = textEffect("gradient")!.style(context(["#112233"]));

    expect(style!.backgroundImage).toBe("linear-gradient(90deg, #112233, lighten(#112233, 0.45))");
  });

  it("does nothing at all with no colour to work from", () => {
    expect(textEffect("gradient")!.style(context([]))).toBeNull();
  });
});

describe("glow", () => {
  it("draws a halo behind the letters", () => {
    const style = textEffect("glow")!.style(context(["#112233"]));

    expect(style!.color).toBe("#112233");
    expect(style!.textShadow).toContain("color-mix(in srgb, #112233 50%, transparent)");
  });

  /**
   * The faint outer ring used to be written by tacking `80` onto the colour, which is only alpha
   * if the colour happens to be a six-digit hex — a role colour arrives as `rgb(…)` and made the
   * whole declaration invalid, silently.
   */
  it("fades a colour that is not a hex string", () => {
    const style = textEffect("glow")!.style(context(["rgb(17, 34, 51)"]));

    expect(style!.textShadow).toContain("color-mix(in srgb, rgb(17, 34, 51) 50%, transparent)");
  });

  it("keeps the wearer's own colours and haloes the middle one", () => {
    const style = textEffect("glow")!.style(context(["#111111", "#222222", "#333333"]));

    expect(style!.backgroundImage).toContain("#111111, #222222, #333333");
    expect(style!.textShadow).toContain("#222222");
  });
});

describe("shimmer", () => {
  it("lays the colours out twice so the sweep loops with no jump", () => {
    const style = textEffect("shimmer")!.style(context(["#111111", "#222222"]));

    expect(style!.backgroundImage).toBe("linear-gradient(90deg, #111111, #222222, #111111, #222222)");
    expect(style!.backgroundSize).toBe("250% 100%");
  });

  it("brings its own keyframes, which a still treatment does not", () => {
    expect(textEffect("shimmer")!.keyframes).toContain("@keyframes cosmetic-shimmer");
    expect(textEffect("gradient")!.keyframes).toBeUndefined();
  });
});
