/**
 * The treatments a display name can be drawn with.
 *
 * What these guard: a treatment that has nothing to say returns null, and the renderer then draws
 * the name plainly — so a treatment which is broken and a treatment which is subtle look exactly the
 * same from outside. That is how the whole axis came to do nothing for anybody who had chosen two or
 * more colours of their own, with no error anywhere: it was never asked.
 *
 * So the rule is simply that a treatment handed colours must produce something, in every form a
 * colour arrives in.
 */

import { describe, expect, test } from "vitest";
import { textEffect, textEffects } from "@/cosmetics/kinds/option-text-effect";
import { mixToward } from "@/cosmetics/chips/types";
import type { TextEffectContext } from "@/cosmetics/textEffect";

function context(stops: readonly string[]): TextEffectContext {
  return {
    stops,
    tint: stops[0] ?? null,
    lighten: (hex, amount) => mixToward(hex, 255, amount),
    shade: (hex, amount) => mixToward(hex, 0, amount),
    gradient: (...list) => ({
      backgroundImage: `linear-gradient(90deg, ${list.join(", ")})`,
      backgroundClip: "text",
      color: "transparent",
    }),
  };
}

const ALL = ["gradient", "glow", "shimmer"];

describe("every treatment this build ships", () => {
  test("is one of the three, and the registry finds each by slug", () => {
    expect(textEffects().map(effect => effect.slug).sort()).toEqual([...ALL].sort());

    for (const slug of ALL) {
      expect(textEffect(slug), slug).toBeDefined();
    }
  });

  /**
   * The case that was broken for everybody who had picked their own colours: the renderer skipped
   * the treatment outright, so all three looked identical and changing them did nothing.
   */
  test("paints something when handed several colours", () => {
    for (const slug of ALL) {
      const painted = textEffect(slug)!.style(context(["#7c5cff", "#22d3ee", "#f43f5e"]));

      expect(painted, slug).not.toBeNull();
      expect(Object.keys(painted!).length, slug).toBeGreaterThan(0);
    }
  });

  test("paints something when handed one", () => {
    for (const slug of ALL) {
      expect(textEffect(slug)!.style(context(["#7c5cff"])), slug).not.toBeNull();
    }
  });

  /**
   * A role colour does not arrive as hex. The glow used to tack `80` onto it for the outer ring,
   * which is alpha only on a six-digit hex — on `rgb(…)` it made the whole `text-shadow` invalid and
   * the browser dropped the treatment without a word.
   */
  test("survives a colour that is not a hex", () => {
    for (const slug of ALL) {
      const painted = textEffect(slug)!.style(context(["rgb(124, 92, 255)"]));

      expect(painted, slug).not.toBeNull();
      expect(JSON.stringify(painted), slug).not.toContain("rgb(124, 92, 255)80");
    }
  });

  test("has nothing to paint with no colours at all, and says so", () => {
    for (const slug of ALL) {
      expect(textEffect(slug)!.style(context([])), slug).toBeNull();
    }
  });
});

describe("what each of the three is for", () => {
  const three = ["#7c5cff", "#22d3ee", "#f43f5e"];

  /** With several colours there is nothing to invent — they are the blend. */
  test("blend paints the colours as given", () => {
    expect(textEffect("gradient")!.style(context(three))!.backgroundImage)
      .toBe("linear-gradient(90deg, #7c5cff, #22d3ee, #f43f5e)");
  });

  /** With one, it makes the second, which is the whole point of it. */
  test("blend makes a second colour out of a single one", () => {
    const painted = textEffect("gradient")!.style(context(["#000000"]))!;

    expect(painted.backgroundImage).toContain("#000000");
    expect(painted.backgroundImage).not.toBe("linear-gradient(90deg, #000000)");
  });

  test("glow adds a halo and keeps the colours", () => {
    const painted = textEffect("glow")!.style(context(three))!;

    expect(painted.textShadow).toBeTruthy();
    expect(painted.backgroundImage).toContain("#22d3ee");
  });

  /** The sheen travels, which is what makes it not the same switch as the wearer's own "travelling". */
  test("sheen lays the colours out twice and moves them", () => {
    const painted = textEffect("shimmer")!.style(context(three))!;

    expect(painted.animation).toContain("cosmetic-shimmer");
    expect(painted.backgroundImage.match(/#7c5cff/g)).toHaveLength(2);
  });
});
