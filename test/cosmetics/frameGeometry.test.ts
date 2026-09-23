import { describe, expect, it } from "vitest";
import { animationOf, originOf, paintOf, placementOf } from "@/cosmetics/primitives/frameGeometry";
import { parseProfileFramePayload, type FramePart } from "@/cosmetics/kinds/profile-frame";

/**
 * The arithmetic between a payload and a style attribute.
 *
 * An anchor whose signs run the wrong way puts somebody's ornament on the far side of their card,
 * and a nine-slice whose widths and outsets are swapped draws the band inside the card instead of
 * around it. Neither is a type error and neither shows up in a diff, which is the whole reason this
 * is a plain function with a test rather than a computed property in a component.
 */
const part = (raw: Record<string, unknown>): FramePart => {
  const payload = parseProfileFramePayload({ parts: [raw] });

  expect(payload).not.toBeNull();

  return payload!.parts[0];
};

/** A 40 by 20 piece hung off the top edge, with only what a test is about overridden. */
const prop = (over: Record<string, unknown> = {}) =>
  part({ type: "prop", slot: "primary", anchor: "top", w: 40, h: 20, ...over });

/** A thin one-colour ring with no glow, with only what a test is about overridden. */
const ring = (over: Record<string, unknown> = {}) =>
  part({ type: "ring", thickness: 2, colors: [0xff112233], ...over });

/** A band four pixels thick on every side, with only what a test is about overridden. */
const surround = (over: Record<string, unknown> = {}) =>
  part({ type: "surround", slot: "primary", slice: [8, 8, 8, 8], width: [4, 4, 4, 4], ...over });

describe("placementOf", () => {
  it("turns whole-percent opacity back into the fraction CSS wants", () => {
    expect(placementOf(ring({ opacityPct: 40 })).opacity).toBe("0.4");
    expect(placementOf(ring()).opacity).toBe("1");
  });

  it("puts a part over or under the card's own content", () => {
    expect(placementOf(ring()).zIndex).toBe("4");
    expect(placementOf(ring({ over: false })).zIndex).toBe("0");
  });

  it("rests a top-anchored piece on the card's upper edge", () => {
    const style = placementOf(prop());

    expect(style.bottom).toBe("100%");
    expect(style.left).toBe("50%");
    expect(style.transform).toBe("translateX(-50%)");
  });

  it("reads a nudge the way a screen does — right and down are positive", () => {
    // A positive dy on a top anchor drags the piece down onto the card.
    expect(placementOf(prop({ dy: 8 })).bottom).toBe("calc(100% - 8px)");

    // And on a bottom anchor drags it further off.
    expect(placementOf(prop({ anchor: "bottom", dy: 8 })).top).toBe("calc(100% + 8px)");

    expect(placementOf(prop({ anchor: "left", dx: 6 })).right).toBe("calc(100% - 6px)");
    expect(placementOf(prop({ anchor: "right", dx: 6 })).left).toBe("calc(100% + 6px)");
  });

  it("scales the pixels and leaves the percentages alone", () => {
    const style = placementOf(prop({ dy: 10 }), 0.5);

    expect(style.width).toBe("20px");
    expect(style.height).toBe("10px");
    expect(style.bottom).toBe("calc(100% - 5px)");
  });

  it("spreads a glow only when the ring is glowing", () => {
    expect(placementOf(ring({ thickness: 3 })).filter).toBeUndefined();
  });

  it("spreads a glow as far as it is strong", () => {
    expect(placementOf(ring({ thickness: 3, glowPct: 100 })).filter).toContain("drop-shadow(0 0 9px");
    expect(placementOf(ring({ thickness: 3, glowPct: 60 })).filter).toContain("drop-shadow(0 0 5.4px");

    // And shrinks with the frame, like every other measurement.
    expect(placementOf(ring({ thickness: 3, glowPct: 60 }), 0.5).filter).toContain("drop-shadow(0 0 2.7px");
  });
});

describe("originOf", () => {
  it("turns a piece about the edge it is attached to, not its middle", () => {
    expect(originOf(prop({ anchor: "top" }))).toBe("50% 100%");
    expect(originOf(prop({ anchor: "bottomLeft" }))).toBe("100% 0%");
    expect(originOf(ring())).toBe("50% 50%");
  });
});

describe("paintOf", () => {
  it("draws nothing for a picture whose file has not been uploaded", () => {
    expect(paintOf(surround(), null, false)).toBeNull();
    expect(paintOf(prop(), null, false)).toBeNull();
  });

  it("paints a ring with no file at all", () => {
    const style = paintOf(ring(), null, false);

    expect(style).not.toBeNull();
    expect(style!.background).toContain("linear-gradient");
  });

  it("blends a ring's colours in the order they were given", () => {
    const style = paintOf(ring({ colors: [0xff112233, 0xff445566], angle: 90 }), null, false);

    expect(style!.background).toBe("linear-gradient(90deg, rgb(17, 34, 51), rgb(68, 85, 102))");
  });

  it("writes a band as a nine-slice, with the cut unscaled", () => {
    const style = paintOf(surround({ outset: [6, 6, 6, 6] }), "https://cdn/x.png", false, 0.5)!;

    expect(style.borderImageWidth).toBe("2px 2px 2px 2px");
    expect(style.borderImageOutset).toBe("3px 3px 3px 3px");

    // The slice says where to cut the source picture, in that picture's own pixels.
    expect(style.borderImageSlice).toBe("8 8 8 8");
  });

  it("stands a strip on its chosen frame under a reduced-motion preference", () => {
    const sprite = prop({ w: 32, h: 32, sprite: { frames: 8, columns: 4, still: 5 } });
    const style = paintOf(sprite, "https://cdn/x.png", true, 1)!;

    expect(style.backgroundPositionX).toBe("-32px");
    expect(style.backgroundPositionY).toBe("-32px");
  });
});

describe("animationOf", () => {
  it("runs nothing at all under a reduced-motion preference", () => {
    const moving = prop({ motion: { kind: "bob", amount: 4, periodMs: 3000 } });

    expect(animationOf(moving, true)).toEqual({});
  });

  it("starts a movement already underway, by its phase", () => {
    const moving = prop({ motion: { kind: "bob", amount: 4, periodMs: 3000, phaseMs: 400 } });
    const style = animationOf(moving, false);

    expect(style.animation).toBe("cosmetic-frame-bob 3000ms ease-in-out -400ms infinite");
    expect(style["--cf-amount"]).toBe("4");
  });

  it("stands still for a movement this build has no file for", () => {
    const moving = prop({ motion: { kind: "cartwheel", amount: 4, periodMs: 3000 } });

    expect(animationOf(moving, false)).toEqual({});
  });

  it("runs a movement and a strip at the same time", () => {
    const both = prop({
      motion: { kind: "sway", amount: 2, periodMs: 4000 },
      sprite: { frames: 8, columns: 4, fps: 8 },
    });

    const running = animationOf(both, false).animation.split(", ");

    expect(running).toHaveLength(3);
    expect(running[0]).toContain("cosmetic-frame-sway");
    expect(running[1]).toContain("cosmetic-frame-sprite-x");
    expect(running[2]).toContain("cosmetic-frame-sprite-y");
  });
});
