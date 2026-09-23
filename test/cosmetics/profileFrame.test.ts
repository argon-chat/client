import { describe, expect, it } from "vitest";
import {
  frameHidesEdges,
  frameInsets,
  frameOutsets,
  parseProfileFramePayload,
  type ProfileFramePayload,
} from "@/cosmetics/kinds/profile-frame";

/**
 * What arrives in the payload column, and what this build is willing to draw from it.
 *
 * <b>Nothing here throws and nothing here trusts.</b> The payload is text the server stored against
 * a schema this build may be older than, so every case below is really the same question asked
 * about a different field: does a value this build cannot use cost the wearer their whole frame, or
 * just that part of it.
 */
const parsed = (payload: unknown): ProfileFramePayload => {
  const read = parseProfileFramePayload(payload);

  expect(read).not.toBeNull();

  return read as ProfileFramePayload;
};

const ring = (over: Record<string, unknown> = {}) => ({
  type: "ring",
  thickness: 2,
  colors: [0xff112233],
  ...over,
});

describe("parseProfileFramePayload", () => {
  it("refuses anything that is not a list of parts", () => {
    expect(parseProfileFramePayload(null)).toBeNull();
    expect(parseProfileFramePayload("parts")).toBeNull();
    expect(parseProfileFramePayload({})).toBeNull();
    expect(parseProfileFramePayload({ parts: {} })).toBeNull();
    expect(parseProfileFramePayload({ parts: [] })).toBeNull();
  });

  it("drops a part it cannot read and keeps the rest", () => {
    const frame = parsed({ parts: [{ type: "sculpture" }, ring()] });

    expect(frame.parts).toHaveLength(1);
    expect(frame.parts[0].type).toBe("ring");
  });

  it("stops at the eighth part", () => {
    const frame = parsed({ parts: Array.from({ length: 12 }, () => ring()) });

    expect(frame.parts).toHaveLength(8);
  });

  it("reads opacity as whole percent and never lets a part vanish", () => {
    expect(parsed({ parts: [ring({ opacityPct: 40 })] }).parts[0].opacityPct).toBe(40);
    expect(parsed({ parts: [ring({ opacityPct: 0 })] }).parts[0].opacityPct).toBe(5);
    expect(parsed({ parts: [ring({ opacityPct: 900 })] }).parts[0].opacityPct).toBe(100);
    expect(parsed({ parts: [ring()] }).parts[0].opacityPct).toBe(100);
  });

  it("takes colours as integers and caps a ring at four", () => {
    const four = parsed({ parts: [ring({ colors: [1, 2, 3, 4] })] });

    expect(four.parts[0]).toMatchObject({ colors: [1, 2, 3, 4] });
    expect(parseProfileFramePayload({ parts: [ring({ colors: [1, 2, 3, 4, 5] })] })).toBeNull();
    expect(parseProfileFramePayload({ parts: [ring({ colors: ["#ff0000"] })] })).toBeNull();
    expect(parseProfileFramePayload({ parts: [ring({ colors: [] })] })).toBeNull();
  });

  it("refuses a slot outside the four the item can carry", () => {
    const surround = (slot: unknown) => ({
      type: "surround",
      slot,
      slice: [8, 8, 8, 8],
      width: [4, 4, 4, 4],
    });

    expect(parsed({ parts: [surround("secondary")] }).parts[0]).toMatchObject({ slot: "secondary" });
    expect(parseProfileFramePayload({ parts: [surround("Primary")] })).toBeNull();
    expect(parseProfileFramePayload({ parts: [surround("banner")] })).toBeNull();
    expect(parseProfileFramePayload({ parts: [surround(undefined)] })).toBeNull();
  });

  it("refuses a band that is drawn nowhere", () => {
    const flat = {
      type: "surround",
      slot: "primary",
      slice: [8, 8, 8, 8],
      width: [0, 0, 0, 0],
    };

    expect(parseProfileFramePayload({ parts: [flat] })).toBeNull();
  });

  it("falls back to stretching a band whose repeat it does not know", () => {
    const band = parsed({
      parts: [{ type: "surround", slot: "primary", slice: [8, 8, 8, 8], width: [4, 4, 4, 4], repeat: "tile" }],
    });

    expect(band.parts[0]).toMatchObject({ repeat: "stretch" });
  });

  it("refuses a strip that does not divide into rows", () => {
    const prop = (sprite: unknown) => ({
      type: "prop", slot: "primary", anchor: "top", w: 32, h: 32, sprite,
    });

    expect(parsed({ parts: [prop({ frames: 8, columns: 4 })] }).parts[0]).toMatchObject({
      sprite: { frames: 8, columns: 4, fps: 12, still: 0 },
    });

    // Not a whole frame lost: the strip is dropped and the piece draws still.
    expect(parsed({ parts: [prop({ frames: 7, columns: 4 })] }).parts[0]).toMatchObject({ sprite: null });
  });
});

describe("what a frame asks of the card around it", () => {
  it("reserves the widest inset any part asks for, per side", () => {
    const frame = parsed({
      parts: [
        ring({ inset: [10, 0, 0, 4] }),
        ring({ inset: [2, 6, 0, 0] }),
      ],
    });

    expect(frameInsets(frame)).toEqual({ top: 10, right: 6, bottom: 0, left: 4 });
  });

  it("counts a band's outset and a piece's own size as reach", () => {
    const frame = parsed({
      parts: [
        { type: "surround", slot: "primary", slice: [8, 8, 8, 8], width: [4, 4, 4, 4], outset: [12, 0, 0, 0] },
        { type: "prop", slot: "secondary", anchor: "bottomRight", w: 40, h: 24, dx: 6, dy: 2 },
      ],
    });

    expect(frameOutsets(frame)).toEqual({ top: 12, right: 46, bottom: 26, left: 0 });
  });

  it("counts a ring's reach only when it is glowing", () => {
    expect(frameOutsets(parsed({ parts: [ring({ thickness: 3 })] })))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("reaches as far as its glow is strong", () => {
    const full = frameOutsets(parsed({ parts: [ring({ thickness: 3, glowPct: 100 })] }));
    const half = frameOutsets(parsed({ parts: [ring({ thickness: 3, glowPct: 50 })] }));

    expect(full).toEqual({ top: 9, right: 9, bottom: 9, left: 9 });

    // 4.5 drawn, 5 reserved: the room kept is never a fraction short of the glow.
    expect(half).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });
  });

  it("hides the card's own edge only where something covers it", () => {
    const along = parsed({
      parts: [{ type: "surround", slot: "primary", slice: [8, 8, 8, 8], width: [6, 0, 0, 0] }],
    });

    expect(frameHidesEdges(along)).toEqual({ top: true, right: false, bottom: false, left: false });

    // A ring is the edge itself, so it covers all four.
    expect(frameHidesEdges(parsed({ parts: [ring()] })))
      .toEqual({ top: true, right: true, bottom: true, left: true });

    // A piece hung off a corner sits at one point; the edge runs on past it both ways.
    const hanging = parsed({ parts: [{ type: "prop", slot: "primary", anchor: "topRight", w: 32, h: 32 }] });

    expect(frameHidesEdges(hanging)).toEqual({ top: false, right: false, bottom: false, left: false });
  });
});
