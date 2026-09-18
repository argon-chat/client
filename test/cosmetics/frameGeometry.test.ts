/**
 * Where a frame's parts land, and what they are painted with.
 *
 * What these guard: this arithmetic is the whole of a frame's appearance, and every mistake it can
 * make is silent. An anchor whose signs run the wrong way puts somebody's ornament on the far side
 * of their card; a nine-slice whose widths and outsets are swapped puts the band inside the card
 * instead of around it. None of that is a type error and none of it is visible in a diff — but all
 * of it is a truth table.
 */

import { describe, expect, test } from "vitest";
import { animationOf, originOf, paintOf, placementOf } from "@/cosmetics/primitives/frameGeometry";
import type { FramePart, FramePropPart, FrameRingPart, FrameSurroundPart } from "@/cosmetics/kinds/profile-frame";

const common = { over: true, opacity: 1, inset: [0, 0, 0, 0] as const, motion: null };

const prop = (over: Partial<FramePropPart> = {}): FramePropPart => ({
  ...common,
  type: "prop",
  slot: "Primary",
  anchor: "top",
  w: 56,
  h: 48,
  dx: 0,
  dy: 0,
  sprite: null,
  ...over,
});

const band = (over: Partial<FrameSurroundPart> = {}): FrameSurroundPart => ({
  ...common,
  type: "surround",
  slot: "Primary",
  slice: [40, 40, 40, 40],
  width: [30, 30, 30, 30],
  outset: [12, 12, 12, 12],
  repeat: "round",
  fill: false,
  ...over,
});

const ring = (over: Partial<FrameRingPart> = {}): FrameRingPart => ({
  ...common,
  type: "ring",
  thickness: 3,
  colors: [0xff8844, 0xff4422],
  angle: 135,
  glow: 0,
  ...over,
});

describe("where a part lands", () => {
  test("a band covers the card and a piece is a box of its own size", () => {
    expect(placementOf(band())).toMatchObject({ position: "absolute", inset: "0", borderRadius: "inherit" });
    expect(placementOf(prop())).toMatchObject({ width: "56px", height: "48px" });
  });

  /**
   * The rule: a piece is placed outside its anchor, touching. Anchored to the top, its lower edge
   * rests on the card's upper edge — so with no offset it is entirely above the card.
   */
  test("with no offset a piece sits outside the edge it names", () => {
    expect(placementOf(prop({ anchor: "top" }))).toMatchObject({ bottom: "100%", left: "50%" });
    expect(placementOf(prop({ anchor: "bottom" }))).toMatchObject({ top: "100%", left: "50%" });
    expect(placementOf(prop({ anchor: "left" }))).toMatchObject({ right: "100%", top: "50%" });
    expect(placementOf(prop({ anchor: "right" }))).toMatchObject({ left: "100%", top: "50%" });
    expect(placementOf(prop({ anchor: "topLeft" }))).toMatchObject({ bottom: "100%", right: "100%" });
    expect(placementOf(prop({ anchor: "bottomRight" }))).toMatchObject({ top: "100%", left: "100%" });
  });

  /**
   * The table that is easy to get backwards. Down and right are positive wherever the piece hangs,
   * so the same offset drags a top piece onto the card and a bottom piece further off it.
   */
  test("a positive offset always moves a piece right and down", () => {
    expect(placementOf(prop({ anchor: "top", dy: 14 }))).toMatchObject({ bottom: "calc(100% - 14px)" });
    expect(placementOf(prop({ anchor: "bottom", dy: 14 }))).toMatchObject({ top: "calc(100% + 14px)" });
    expect(placementOf(prop({ anchor: "left", dx: 14 }))).toMatchObject({ right: "calc(100% - 14px)" });
    expect(placementOf(prop({ anchor: "right", dx: 14 }))).toMatchObject({ left: "calc(100% + 14px)" });

    expect(placementOf(prop({ anchor: "bottom", dy: -10, dx: -90 })))
      .toMatchObject({ top: "calc(100% - 10px)", left: "calc(50% - 90px)" });
  });

  test("a piece drawn under the card sits above its background and below its words", () => {
    expect(placementOf(prop({ over: true })).zIndex).toBe("4");
    expect(placementOf(prop({ over: false })).zIndex).toBe("0");
  });

  test("a ring's glow is put beside the part rather than on its paint", () => {
    // The paint may be running a movement that animates `filter`, and one element cannot hold both.
    expect(placementOf(ring({ glow: 0.5 })).filter).toBe("drop-shadow(0 0 9px rgb(255, 68, 34))");
    expect(placementOf(ring({ glow: 0 })).filter).toBeUndefined();
  });

  test("a piece turns about the edge it is attached to, not about its middle", () => {
    expect(originOf(prop({ anchor: "top" }))).toBe("50% 100%");
    expect(originOf(prop({ anchor: "bottom" }))).toBe("50% 0%");
    expect(originOf(prop({ anchor: "bottomLeft" }))).toBe("100% 0%");
    expect(originOf(band())).toBe("50% 50%");
  });
});

describe("what a part is painted with", () => {
  test("a band is a nine-slice and nothing else", () => {
    expect(paintOf(band(), "/f/band.svg", false)).toMatchObject({
      borderStyle: "solid",
      borderWidth: "30px 30px 30px 30px",
      borderImageSource: 'url("/f/band.svg")',
      borderImageSlice: "40 40 40 40",
      borderImageWidth: "30px 30px 30px 30px",
      borderImageOutset: "12px 12px 12px 12px",
      borderImageRepeat: "round",
    });
  });

  /**
   * The property that actually decides the shape is `border-image-width`, not `border-width` —
   * setting only the second leaves the image drawn on all four sides whatever the border says. Both
   * come off the same four numbers here so they cannot drift, and this is the assertion that says so.
   */
  test("a side with no thickness is a side with no band, which is where a frame's shape comes from", () => {
    expect(paintOf(band({ width: [30, 0, 30, 0] }), "/f/band.svg", false)).toMatchObject({
      borderWidth: "30px 0px 30px 0px",
      borderImageWidth: "30px 0px 30px 0px",
    });
  });

  test("asking for the middle of the nine adds the one keyword that draws it", () => {
    expect(paintOf(band({ fill: true }), "/f/band.svg", false)).toMatchObject({ borderImageSlice: "40 40 40 40 fill" });
  });

  test("a ring is a sheet of paint with its middle cut out", () => {
    const paint = paintOf(ring(), null, false)!;

    expect(paint.background).toBe("linear-gradient(135deg, rgb(255, 136, 68), rgb(255, 68, 34))");
    expect(paint.padding).toBe("3px");
    expect(paint.maskComposite).toBe("exclude");
    expect(paint.borderRadius).toBe("inherit");
  });

  test("one colour is a flat edge rather than a gradient of one stop", () => {
    expect(paintOf(ring({ colors: [0xff8844] }), null, false)!.background)
      .toBe("linear-gradient(rgb(255, 136, 68), rgb(255, 136, 68))");
  });

  /**
   * The ordinary way this happens is an operator midway through authoring: the row names a slot and
   * the upload into it has not happened. A broken image on a stranger's profile is worse than a
   * frame with a piece missing.
   */
  test("a picture part with no file behind it draws nothing", () => {
    expect(paintOf(band(), null, false)).toBeNull();
    expect(paintOf(prop(), null, false)).toBeNull();
  });
});

describe("a strip of frames", () => {
  const walking = prop({ w: 40, h: 44, sprite: { frames: 8, columns: 4, fps: 12, still: 5 } });

  test("the sheet is laid out as a grid of cells the size of the part", () => {
    const paint = paintOf(walking, "/f/walk.png", false)!;

    expect(paint.backgroundSize).toBe("400% 200%");

    // Pixels, not per cent: a percentage background position is a fraction of the room left over,
    // so the same value would land on a different frame for every strip length.
    expect(paint["--cf-sprite-x"]).toBe("-160px");
    expect(paint["--cf-sprite-y"]).toBe("-88px");
  });

  test("the columns cycle inside each row and the rows step once per cycle", () => {
    expect(animationOf(walking, false).animation)
      .toBe("cosmetic-frame-sprite-x 333.3333333333333ms steps(4) infinite, "
        + "cosmetic-frame-sprite-y 666.6666666666666ms steps(2) infinite");
  });

  test("with movement off it stands on the frame the row chose, not on the first one", () => {
    const paint = paintOf(walking, "/f/walk.png", true)!;

    // Frame 5 of an eight-frame sheet four wide: second row, second column.
    expect(paint.backgroundPositionX).toBe("-40px");
    expect(paint.backgroundPositionY).toBe("-44px");
  });
});

/**
 * A frame is authored in pixels against a real card, and a picker draws the same row in a tile a
 * third the size. Every measurement shrinks with it — except the slice, which says where to cut the
 * source picture and does not move when the frame gets smaller.
 */
describe("at a smaller size", () => {
  test("the band thins and pulls in, and the cut stays where it was", () => {
    expect(paintOf(band(), "/f/band.svg", false, 0.5)).toMatchObject({
      borderWidth: "15px 15px 15px 15px",
      borderImageWidth: "15px 15px 15px 15px",
      borderImageOutset: "6px 6px 6px 6px",
      borderImageSlice: "40 40 40 40",
    });
  });

  test("a piece shrinks and stays against the edge it was pinned to", () => {
    expect(placementOf(prop({ anchor: "top", dy: 14 }), 0.5))
      .toMatchObject({ width: "28px", height: "24px", bottom: "calc(100% - 7px)" });
  });

  test("a ring thins with everything else, glow included", () => {
    expect(paintOf(ring(), null, false, 0.5)!.padding).toBe("1.5px");
    expect(placementOf(ring({ glow: 0.5 }), 0.5).filter).toBe("drop-shadow(0 0 4.5px rgb(255, 68, 34))");
  });

  test("a strip walks by the cell it is drawn at, not by the cell it was authored at", () => {
    const walking = prop({ w: 40, h: 44, sprite: { frames: 8, columns: 4, fps: 12, still: 0 } });

    expect(paintOf(walking, "/f/walk.png", false, 0.5)!["--cf-sprite-x"]).toBe("-80px");
  });

  test("full size is left exactly alone", () => {
    expect(paintOf(band(), "/f/band.svg", false, 1)).toEqual(paintOf(band(), "/f/band.svg", false));
  });
});

describe("movement", () => {
  const swaying = (over: Partial<FramePart> = {}) =>
    prop({ motion: { kind: "sway", amount: 4, periodMs: 4400, phaseMs: 1700 }, ...over } as Partial<FramePropPart>);

  test("the row supplies the numbers and the file supplies the keyframes", () => {
    const style = animationOf(swaying(), false);

    expect(style.animation).toBe("cosmetic-frame-sway 4400ms ease-in-out -1700ms infinite");
    expect(style["--cf-amount"]).toBe("4");
  });

  /**
   * A phase is a negative delay: the animation begins already underway rather than waiting, which is
   * what makes two copies of one picture read as two things in the same draught.
   */
  test("a phase starts the movement partway through rather than after a pause", () => {
    expect(animationOf(swaying(), false).animation).toContain("-1700ms");
  });

  test("a movement released after this build leaves the part still, and still drawn", () => {
    expect(animationOf(prop({ motion: { kind: "cartwheel", amount: 2, periodMs: 1000, phaseMs: 0 } }), false))
      .toEqual({});
  });

  test("moving and walking a strip at once are two animations, not a choice", () => {
    const both = animationOf(
      prop({ motion: { kind: "bob", amount: 3, periodMs: 3600, phaseMs: 0 }, sprite: { frames: 4, columns: 4, fps: 8, still: 0 } }),
      false,
    );

    expect(both.animation?.split(", ")).toHaveLength(3);
  });

  /**
   * Off, not paused. The app's own reduced-motion rule flattens every keyframe to a single frame
   * anyway, so a paused animation would leave the choice of which frame to the cascade.
   */
  test("nothing moves when movement is off", () => {
    expect(animationOf(swaying(), true)).toEqual({});
  });
});
