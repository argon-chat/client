/**
 * Reading a frame's payload off the wire.
 *
 * What these guard: a frame is now a list of parts rather than four numbers, and the payload arrives
 * as text an operator typed into a console this repository does not contain. So this is the only
 * place a frame is checked before it is drawn onto somebody's profile — and the rule it has to keep
 * is that a row it cannot read costs that row and nothing else. A frame authored against a newer
 * build has to lose a piece, not take a card down.
 */

import { describe, expect, test } from "vitest";
import frame from "@/cosmetics/kinds/profile-frame";
import type { FramePropPart, FrameSurroundPart, ProfileFramePayload } from "@/cosmetics/kinds/profile-frame";
import type { ResolvedCosmetic } from "@/cosmetics/types";

const parse = (raw: unknown) => frame.parsePayload(raw) as ProfileFramePayload | null;

/** The row the local stand seeds, byte for byte as the database holds it. */
const THORNS = JSON.parse(`{"parts":[
  {"type":"surround","slot":"Primary","slice":[40,40,40,40],"width":[30,30,30,30],
   "outset":[26,26,26,26],"repeat":"round","inset":[0,0,8,0],
   "motion":{"kind":"glimmer","amount":0.4,"periodMs":5200,"phaseMs":0}},
  {"type":"prop","slot":"Secondary","anchor":"top","w":72,"h":62,"dy":18,
   "motion":{"kind":"bob","amount":3,"periodMs":3600,"phaseMs":0}},
  {"type":"prop","slot":"Tertiary","anchor":"bottom","w":52,"h":56,"dx":-108,"dy":-12,
   "motion":{"kind":"sway","amount":5,"periodMs":4400,"phaseMs":0}},
  {"type":"prop","slot":"Tertiary","anchor":"bottom","w":52,"h":56,"dx":108,"dy":-12,
   "motion":{"kind":"sway","amount":5,"periodMs":4400,"phaseMs":1700}}
]}`);

describe("the shipped rows", () => {
  test("the four-part frame comes back whole", () => {
    const payload = parse(THORNS);

    expect(payload?.parts).toHaveLength(4);

    const band = payload!.parts[0] as FrameSurroundPart;

    expect(band.type).toBe("surround");
    expect(band.width).toEqual([30, 30, 30, 30]);
    expect(band.outset).toEqual([26, 26, 26, 26]);
    expect(band.repeat).toBe("round");
    expect(band.motion).toEqual({ kind: "glimmer", amount: 0.4, periodMs: 5200, phaseMs: 0 });

    const skull = payload!.parts[1] as FramePropPart;

    expect(skull.anchor).toBe("top");
    expect(skull.dx).toBe(0);
    expect(skull.dy).toBe(18);
    expect(skull.sprite).toBeNull();
  });

  test("a plain coloured edge is a list of one", () => {
    const payload = parse({
      parts: [{ type: "ring", thickness: 3, colors: [-7708394, -605101], angle: 135, glow: 0 }],
    });

    expect(payload?.parts).toHaveLength(1);
    expect(payload?.parts[0]).toMatchObject({ type: "ring", thickness: 3, angle: 135 });
  });

  /**
   * The shape a frame used to be. It is refused rather than quietly adapted: the rows were migrated
   * with the change, so anything still carrying it is a cache from before — and drawing a guess at
   * what it meant is worse than drawing nothing until the row is fetched again.
   */
  test("the payload a frame used to have is not one any more", () => {
    expect(parse({ width: 3, colors: [-7708394], angle: 135, glow: 0 })).toBeNull();
  });
});

describe("what a part has to carry", () => {
  test("a band with no thickness on any side is drawn nowhere, so it is not a part", () => {
    expect(parse({ parts: [{ type: "surround", slot: "Primary", slice: [40, 40, 40, 40], width: [0, 0, 0, 0] }] }))
      .toBeNull();
  });

  test("a picture part with no file named is not a part", () => {
    expect(parse({ parts: [{ type: "prop", anchor: "top", w: 20, h: 20 }] })).toBeNull();
  });

  test("an anchor this build does not know is not a part", () => {
    expect(parse({ parts: [{ type: "prop", slot: "Primary", anchor: "middleish", w: 20, h: 20 }] })).toBeNull();
  });

  test("a ring with no colours is not a ring", () => {
    expect(parse({ parts: [{ type: "ring", thickness: 2, colors: [] }] })).toBeNull();
  });
});

describe("degrading", () => {
  /**
   * The rule the whole design rests on. A frame whose fourth piece this build cannot read is far
   * more likely than a frame that is wholly unreadable, and its band is closer to what its wearer
   * chose than an empty card is.
   */
  test("a part it cannot read costs that part and nothing else", () => {
    const payload = parse({
      parts: [
        { type: "ring", thickness: 2, colors: [-1] },
        { type: "sculpture", slot: "Primary" },
        { type: "prop", slot: "Secondary", anchor: "top", w: 30, h: 30 },
      ],
    });

    expect(payload?.parts.map(part => part.type)).toEqual(["ring", "prop"]);
  });

  test("nothing readable at all is nothing to draw", () => {
    expect(parse({ parts: [{ type: "sculpture" }] })).toBeNull();
    expect(parse({ parts: [] })).toBeNull();
    expect(parse({})).toBeNull();
    expect(parse("a frame")).toBeNull();
  });

  test("a movement released after this build leaves the part standing still, not missing", () => {
    const payload = parse({
      parts: [{ type: "ring", thickness: 2, colors: [-1], motion: { kind: "cartwheel", amount: 2, periodMs: 1000 } }],
    });

    expect(payload?.parts).toHaveLength(1);
    expect(payload?.parts[0].motion?.kind).toBe("cartwheel");
  });
});

describe("the limits", () => {
  test("a reach past the ceiling is pulled back to it rather than refused", () => {
    const payload = parse({
      parts: [{ type: "surround", slot: "Primary", slice: [40, 40, 40, 40], width: [999, 0, 0, 0], outset: [999, 0, 0, 0] }],
    });

    const band = payload!.parts[0] as FrameSurroundPart;

    expect(band.width[0]).toBe(64);
    expect(band.outset[0]).toBe(96);
  });

  test("a strip whose frames do not fill its rows is not a strip", () => {
    const payload = parse({
      parts: [{
        type: "prop", slot: "Primary", anchor: "top", w: 20, h: 20,
        sprite: { frames: 7, columns: 4, fps: 12, still: 0 },
      }],
    });

    expect((payload!.parts[0] as FramePropPart).sprite).toBeNull();
  });

  test("a strip that does fill them is kept", () => {
    const payload = parse({
      parts: [{
        type: "prop", slot: "Primary", anchor: "top", w: 20, h: 20,
        sprite: { frames: 8, columns: 4, fps: 12, still: 3 },
      }],
    });

    expect((payload!.parts[0] as FramePropPart).sprite).toEqual({ frames: 8, columns: 4, fps: 12, still: 3 });
  });

  test("more parts than a frame may have are cut, not refused", () => {
    const ring = { type: "ring", thickness: 1, colors: [-1] };

    expect(parse({ parts: Array.from({ length: 20 }, () => ring) })?.parts).toHaveLength(8);
  });
});

describe("the room it asks the card for", () => {
  const worn = (payload: ProfileFramePayload) => ({ payload } as ResolvedCosmetic<ProfileFramePayload>);

  /**
   * Side by side, not added up. Two parts both wanting to be clear of the bottom are both clear of
   * it once the deeper one is — summing would indent a card by two overlapping branches.
   */
  test("two parts asking for the same side ask for the deeper of the two", () => {
    const payload = parse({
      parts: [
        { type: "ring", thickness: 2, colors: [-1], inset: [4, 0, 12, 0] },
        { type: "ring", thickness: 2, colors: [-1], inset: [9, 0, 6, 0] },
      ],
    })!;

    expect(frame.insetsOf!(worn(payload))).toEqual({ top: 9, right: 0, bottom: 12, left: 0 });
  });

  test("a frame that asks for nothing changes no layout", () => {
    expect(frame.insetsOf!(worn(parse({ parts: [{ type: "ring", thickness: 2, colors: [-1] }] })!)))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("the shipped frame keeps its words clear of the band under them", () => {
    expect(frame.insetsOf!(worn(parse(THORNS)!))).toEqual({ top: 0, right: 0, bottom: 8, left: 0 });
  });
});

/**
 * The other half, and the one every preview needs. A popover lets a frame overhang onto the page; a
 * settings column and a picker grid reserve this much room instead, and both ask the same question.
 */
describe("the room it takes outside", () => {
  const worn = (payload: ProfileFramePayload) => ({ payload } as ResolvedCosmetic<ProfileFramePayload>);
  const reach = (raw: unknown) => frame.outsetsOf!(worn(parse(raw)!));

  test("a band reaches as far as it was told to hang out", () => {
    expect(reach({
      parts: [{ type: "surround", slot: "Primary", slice: [40, 40, 40, 40], width: [30, 30, 30, 30], outset: [12, 4, 8, 4] }],
    })).toEqual({ top: 12, right: 4, bottom: 8, left: 4 });
  });

  /**
   * What is bounded is the reach, not the nudge: a piece 62px tall pulled 18px down still hangs 44px
   * over the card, and a host reserving room for 18 would clip the other 44.
   */
  test("a piece reaches by its size less however far it was pulled in", () => {
    expect(reach({ parts: [{ type: "prop", slot: "Primary", anchor: "top", w: 72, h: 62, dy: 18 }] }))
      .toEqual({ top: 44, right: 0, bottom: 0, left: 0 });

    expect(reach({ parts: [{ type: "prop", slot: "Primary", anchor: "bottom", w: 52, h: 56, dy: -12 }] }))
      .toEqual({ top: 0, right: 0, bottom: 44, left: 0 });
  });

  test("a piece pulled entirely onto the card reaches nowhere", () => {
    expect(reach({ parts: [{ type: "prop", slot: "Primary", anchor: "top", w: 30, h: 30, dy: 40 }] }))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("a ring reaches only as far as its glow spreads", () => {
    expect(reach({ parts: [{ type: "ring", thickness: 3, colors: [-1], glow: 0.5 }] }))
      .toEqual({ top: 9, right: 9, bottom: 9, left: 9 });

    expect(reach({ parts: [{ type: "ring", thickness: 3, colors: [-1], glow: 0 }] }))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("the shipped frame needs room above it for the piece sitting on its edge", () => {
    expect(reach(THORNS)).toEqual({ top: 44, right: 26, bottom: 44, left: 26 });
  });
});

/**
 * A frame is the card's edge, not a thing lying on one. Art has gaps in it, and a card that goes on
 * drawing its own hairline puts a thin rule through every space between the thorns.
 */
describe("the edges it takes over", () => {
  const worn = (payload: ProfileFramePayload) => ({ payload } as ResolvedCosmetic<ProfileFramePayload>);
  const covers = (raw: unknown) => frame.hidesEdges!(worn(parse(raw)!));

  test("a band covers the sides it is thick on and no others", () => {
    expect(covers({
      parts: [{ type: "surround", slot: "Primary", slice: [40, 40, 40, 40], width: [30, 0, 30, 0] }],
    })).toEqual({ top: true, right: false, bottom: true, left: false });
  });

  test("a ring is the edge, so it covers all four", () => {
    expect(covers({ parts: [{ type: "ring", thickness: 2, colors: [-1] }] }))
      .toEqual({ top: true, right: true, bottom: true, left: true });
  });

  /**
   * A piece sits at one point and the card's edge runs on past it in both directions, so hiding an
   * edge for it would take away more than the piece puts back.
   */
  test("a piece hung off an edge covers nothing", () => {
    expect(covers({ parts: [{ type: "prop", slot: "Primary", anchor: "top", w: 40, h: 40 }] }))
      .toEqual({ top: false, right: false, bottom: false, left: false });
  });

  test("the shipped frame takes the whole edge", () => {
    expect(covers(THORNS)).toEqual({ top: true, right: true, bottom: true, left: true });
  });
});
