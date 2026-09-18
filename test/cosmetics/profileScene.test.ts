/**
 * What a scene's payload turns into on the way to being drawn.
 *
 * What these guard: this runs on somebody else's profile card, against a row that may have been
 * authored against a newer build than the one reading it. So the shape of the failure matters as
 * much as the shape of the success — an actor this build cannot read has to disappear while the rest
 * of the scene plays, and only a scene with nothing left in it may come back null. The alternative
 * is one bad number in a catalogue row taking a profile card down for everybody who opens it.
 *
 * The refusals mirror the server's, but they are not the same job: the server tells an operator what
 * is wrong, and this quietly draws less.
 */

import { describe, expect, test } from "vitest";
import kind from "@/cosmetics/kinds/profile-scene";
import type {
  ProfileScenePayload,
  SceneBandActor,
  SceneEmitterActor,
  SceneSpriteActor,
  SceneWashActor,
} from "@/cosmetics/kinds/profile-scene";

const ATLAS = { x: 0, y: 0, w: 64, h: 64 };

const sprite = (over: Record<string, unknown> = {}) => ({
  type: "sprite",
  source: "atlas",
  atlas: ATLAS,
  sizePct: 20,
  durationMs: 4000,
  from: { anchor: "topRight" },
  to: { anchor: "bottomLeft" },
  ...over,
});

const scene = (actors: unknown[], over: Record<string, unknown> = {}) =>
  ({ reach: "card", sheet: { w: 256, h: 128 }, actors, ...over });

const parse = (raw: unknown) => kind.parsePayload(raw) as ProfileScenePayload | null;

describe("scene payload", () => {
  test("a scene of one sprite comes through", () => {
    const payload = parse(scene([sprite()]));

    expect(payload?.actors).toHaveLength(1);
    expect(payload?.actors[0].type).toBe("sprite");
  });

  test("anything that is not an object is not a scene", () => {
    expect(parse(null)).toBeNull();
    expect(parse("scene")).toBeNull();
    expect(parse(42)).toBeNull();
  });

  test("a scene with no actors is nothing to draw", () => {
    expect(parse(scene([]))).toBeNull();
  });

  test("a reach outside the three words is refused", () => {
    expect(parse(scene([sprite()], { reach: "everything" }))).toBeNull();
  });

  test("an actor of an unknown type is dropped and the rest plays", () => {
    const payload = parse(scene([{ type: "hologram", source: "atlas", atlas: ATLAS }, sprite()]));

    expect(payload?.actors).toHaveLength(1);
  });

  test("a scene whose actors are all unreadable is null rather than empty", () => {
    expect(parse(scene([{ type: "hologram" }]))).toBeNull();
  });

  test("more actors than the cap are cut rather than refused", () => {
    const payload = parse(scene(Array.from({ length: 12 }, () => sprite())));

    expect(payload?.actors).toHaveLength(8);
  });
});

describe("defaults", () => {
  test("an actor that says nothing is over the content, reading the sheet, hidden by nothing", () => {
    const payload = parse(scene([sprite()]));
    const actor = payload!.actors[0];

    expect(actor.depth).toBe("over");
    expect(actor.source).toBe("atlas");
    expect(actor.slot).toBe("Primary");
    expect(actor.occlude).toEqual([]);
    expect(actor.delayMs).toBe(0);
  });

  test("a sheet rectangle with no frames is one picture", () => {
    const payload = parse(scene([sprite()]));

    expect(payload!.actors[0].atlas?.frames).toBe(1);
  });

  test("an actor reading the sheet without a rectangle is dropped", () => {
    expect(parse(scene([sprite({ atlas: undefined })]))).toBeNull();
  });

  test("an actor reading a sheet the scene never declared is dropped", () => {
    expect(parse({ reach: "card", actors: [sprite()] })).toBeNull();
  });

  test("a rectangle running off the right edge of the sheet is dropped", () => {
    expect(parse(scene([sprite({ atlas: { x: 224, y: 0, w: 64, h: 64 } })]))).toBeNull();
  });

  test("a rectangle running off the bottom of the sheet is dropped", () => {
    expect(parse(scene([sprite({ atlas: { x: 0, y: 96, w: 64, h: 64 } })]))).toBeNull();
  });

  test("the whole strip has to fit, not only its first frame", () => {
    // Four 64px frames from x=0 need 256px of sheet, which is exactly what there is; the same
    // rectangle one frame wider runs off the end, and only counting the first cell would miss it.
    const fits = { x: 0, y: 0, w: 64, h: 64, frames: 4, columns: 4 };
    const spills = { x: 64, y: 0, w: 64, h: 64, frames: 4, columns: 4 };

    expect(parse(scene([sprite({ atlas: fits })]))).not.toBeNull();
    expect(parse(scene([sprite({ atlas: spills })]))).toBeNull();
  });

  test("a part of the card this build cannot hide behind is dropped, not the actor", () => {
    const payload = parse(scene([sprite({ occlude: ["avatar", "conservatory"] })]));

    expect(payload!.actors[0].occlude).toEqual(["avatar"]);
  });
});

describe("envelopes", () => {
  test("a well-formed envelope comes through", () => {
    const payload = parse(scene([sprite({ opacity: [{ at: 0, v: 0 }, { at: 1, v: 1 }] })]));

    expect(payload!.actors[0].opacity).toHaveLength(2);
  });

  test("a non-monotonic envelope is fine — a curve may go up and come back", () => {
    const stops = [{ at: 0, v: 0 }, { at: 0.15, v: 1 }, { at: 0.8, v: 1 }, { at: 1, v: 0 }];
    const payload = parse(scene([sprite({ opacity: stops })]));

    expect(payload!.actors[0].opacity).toHaveLength(4);
  });

  test("one stop is a constant, and a constant is not an envelope", () => {
    const payload = parse(scene([sprite({ opacity: [{ at: 0, v: 1 }] })]));

    expect(payload!.actors[0].opacity).toBeNull();
  });

  test("an envelope that does not start at the beginning of the cycle is not animated", () => {
    const payload = parse(scene([sprite({ opacity: [{ at: 0.2, v: 0 }, { at: 1, v: 1 }] })]));

    expect(payload!.actors[0].opacity).toBeNull();
  });

  test("an envelope that does not reach the end of the cycle is not animated", () => {
    const payload = parse(scene([sprite({ opacity: [{ at: 0, v: 0 }, { at: 0.6, v: 1 }] })]));

    expect(payload!.actors[0].opacity).toBeNull();
  });

  test("stops that go backwards are not animated", () => {
    const stops = [{ at: 0, v: 0 }, { at: 0.7, v: 1 }, { at: 0.3, v: 0.5 }, { at: 1, v: 0 }];
    const payload = parse(scene([sprite({ opacity: stops })]));

    expect(payload!.actors[0].opacity).toBeNull();
  });

  test("a bad envelope costs the channel and not the actor", () => {
    const payload = parse(scene([sprite({ opacity: [{ at: 0.2, v: 0 }, { at: 1, v: 1 }] })]));

    expect(payload!.actors).toHaveLength(1);
  });
});

describe("sprites", () => {
  test("a sprite with no path is dropped", () => {
    expect(parse(scene([sprite({ from: undefined })]))).toBeNull();
  });

  test("a sprite anchored to a point that is not one is dropped", () => {
    expect(parse(scene([sprite({ from: { anchor: "middleish" } })]))).toBeNull();
  });

  test("nudges default to nothing and are read in per cent of the card's width", () => {
    const payload = parse(scene([sprite({ from: { anchor: "top", dxPct: 12, dyPct: -18 } })]));
    const actor = payload!.actors[0] as SceneSpriteActor;

    expect(actor.from).toEqual({ anchor: "top", dxPct: 12, dyPct: -18 });
    expect(actor.to.dxPct).toBe(0);
  });

  test("a size outside the range is dropped rather than clamped", () => {
    expect(parse(scene([sprite({ sizePct: 0 })]))).toBeNull();
    expect(parse(scene([sprite({ sizePct: 900 })]))).toBeNull();
  });
});

describe("bands", () => {
  const band = (over: Record<string, unknown> = {}) => ({
    type: "band",
    source: "file",
    slot: "Secondary",
    edge: "bottom",
    slice: [8, 8, 8, 8],
    thicknessPct: 12,
    ...over,
  });

  test("a band comes through with its tile mode", () => {
    const payload = parse(scene([band({ tile: "repeat" })]));

    expect((payload!.actors[0] as SceneBandActor).tile).toBe("repeat");
  });

  test("a band with no slice is dropped", () => {
    expect(parse(scene([band({ slice: undefined })]))).toBeNull();
  });

  test("a band on an edge that is not one is dropped", () => {
    expect(parse(scene([band({ edge: "corner" })]))).toBeNull();
  });

  test("a band reading the sheet is dropped: a nine-slice needs a whole picture", () => {
    expect(parse(scene([band({ source: "atlas", atlas: ATLAS })]))).toBeNull();
  });

  test("the end pieces default to the band's own thickness", () => {
    const payload = parse(scene([band({ thicknessPct: 16 })]));

    expect((payload!.actors[0] as SceneBandActor).cornerPct).toBe(16);
  });

  test("the end pieces can be set apart from the thickness", () => {
    const payload = parse(scene([band({ thicknessPct: 16, cornerPct: 9 })]));

    expect((payload!.actors[0] as SceneBandActor).cornerPct).toBe(9);
  });

  test("a growth that runs backwards is not a growth", () => {
    const payload = parse(scene([band({ grow: { fromPct: 100, toPct: 0, durationMs: 2000 } })]));

    expect((payload!.actors[0] as SceneBandActor).grow).toBeNull();
  });

  test("a growth that runs outwards comes through", () => {
    const payload = parse(scene([band({ grow: { fromPct: 0, toPct: 100, durationMs: 2600, holdMs: 4000 } })]));

    expect((payload!.actors[0] as SceneBandActor).grow?.holdMs).toBe(4000);
  });
});

describe("emitters", () => {
  const emitter = (over: Record<string, unknown> = {}) => ({
    type: "emitter",
    source: "atlas",
    atlas: { x: 128, y: 0, w: 32, h: 32 },
    edge: "top",
    count: 12,
    sizePct: 5,
    durationMs: 6000,
    ...over,
  });

  test("an emitter comes through with its count", () => {
    const payload = parse(scene([emitter()]));

    expect((payload!.actors[0] as SceneEmitterActor).count).toBe(12);
  });

  test("more copies than the cap are cut rather than refused", () => {
    const payload = parse(scene([emitter({ count: 400 })]));

    expect((payload!.actors[0] as SceneEmitterActor).count).toBe(48);
  });

  test("a self-animating file cannot be scattered, so it is dropped", () => {
    expect(parse(scene([emitter({ source: "file", slot: "Secondary", atlas: undefined })]))).toBeNull();
  });

  test("a spread wider than the middle is pulled back to it rather than making copies of no size", () => {
    const payload = parse(scene([emitter({ sizePct: 4, sizeVarPct: 9 })]));

    expect((payload!.actors[0] as SceneEmitterActor).sizeVarPct).toBe(4);
  });

  test("a duration spread wider than the duration is pulled back the same way", () => {
    const payload = parse(scene([emitter({ durationMs: 6000, durationVarMs: 20_000 })]));

    expect((payload!.actors[0] as SceneEmitterActor).durationVarMs).toBe(6000);
  });
});

describe("a scene of the three early sorts together", () => {
  /**
   * Once the scene the stand seeded, kept as a parse test of a band, a sprite and a scatter in one
   * row. The sakura below is what the stand seeds now, and it is there for the one failure mode
   * this engine has that nothing else catches: the server and the client hold the same vocabulary
   * in two languages, and a row the server publishes happily is a row this side may still refuse.
   * That comes out as a cosmetic somebody bought and cannot see, with nothing anywhere saying why.
   */
  const SEEDED = {
    reach: "choice",
    defaultReach: "card",
    minWidthPx: 0,
    sheet: { w: 256, h: 128 },
    actors: [
      {
        type: "band", source: "file", slot: "Secondary", depth: "over",
        edge: "bottom", slice: [0, 32, 0, 32], thicknessPct: 17, cornerPct: 11, tile: "round",
        grow: { fromPct: 0, toPct: 100, durationMs: 3200, holdMs: 5200, repeat: "pingPong" },
      },
      {
        type: "sprite", source: "atlas", depth: "over", occlude: ["avatar"],
        atlas: { x: 0, y: 0, w: 64, h: 64, frames: 4, columns: 4, fps: 9, still: 0 },
        sizePct: 13, durationMs: 9000, repeat: "loop", ease: "inOut", turn: "mirror",
        from: { anchor: "bottomRight", dxPct: 14, dyPct: -6 },
        to: { anchor: "topLeft", dxPct: -12, dyPct: 26 },
        scale: [{ at: 0, v: 0.8 }, { at: 0.5, v: 1.15 }, { at: 1, v: 0.8 }],
        opacity: [{ at: 0, v: 0 }, { at: 0.1, v: 1 }, { at: 0.88, v: 1 }, { at: 1, v: 0 }],
      },
      {
        type: "emitter", source: "atlas", depth: "deep", edge: "top",
        atlas: { x: 0, y: 64, w: 32, h: 32 },
        count: 14, seed: 41, sizePct: 4.5, sizeVarPct: 1.8,
        durationMs: 7400, durationVarMs: 2600,
        driftPct: 12, swayPct: 2.5, swayPeriodMs: 2800, spinDeg: 260,
        opacity: [{ at: 0, v: 0 }, { at: 0.12, v: 0.8 }, { at: 0.86, v: 0.8 }, { at: 1, v: 0 }],
      },
    ],
  };

  test("keeps all three of its actors", () => {
    const payload = parse(SEEDED);

    expect(payload?.actors.map(actor => actor.type)).toEqual(["band", "sprite", "emitter"]);
  });

  test("keeps all three of its depths, which is what it is there to show", () => {
    const payload = parse(SEEDED);

    expect(payload?.actors.map(actor => actor.depth)).toEqual(["over", "over", "deep"]);
    expect(payload?.actors[1].occlude).toEqual(["avatar"]);
  });

  test("keeps every envelope, rather than quietly dropping one to a stricter rule here", () => {
    const payload = parse(SEEDED);

    expect(payload?.actors[0].opacity).toBeNull();
    expect((payload?.actors[1] as SceneSpriteActor).scale).toHaveLength(3);
    expect(payload?.actors[1].opacity).toHaveLength(4);
    expect(payload?.actors[2].opacity).toHaveLength(4);
  });
});

describe("tuning", () => {
  const tuning = kind.tuning!;

  test("an untouched dial defers to the row", () => {
    expect(tuning.empty()).toEqual({ reach: null });
    expect(tuning.isEmpty(tuning.empty())).toBe(true);
  });

  test("a chosen reach is kept", () => {
    expect(tuning.parse({ reach: "content" })).toEqual({ reach: "content" });
  });

  test("anything else is deference rather than a throw", () => {
    expect(tuning.parse({ reach: "both" })).toEqual({ reach: null });
    expect(tuning.parse(null)).toEqual({ reach: null });
    expect(tuning.parse("card")).toEqual({ reach: null });
  });
});

describe("spill", () => {
  const wash = (over: Record<string, unknown> = {}) =>
    ({ type: "wash", source: "file", slot: "Secondary", ...over });

  test("a wash may show past the card's edge by a per cent of its width", () => {
    const payload = parse(scene([wash({ spillPct: 12 })]));

    expect((payload!.actors[0] as SceneWashActor).spillPct).toBe(12);
  });

  test("a wash that says nothing is clipped at the card, as everything always was", () => {
    expect((parse(scene([wash()]))!.actors[0] as SceneWashActor).spillPct).toBe(0);
    expect((parse(scene([sprite()]))!.actors[0] as SceneSpriteActor).spillPct).toBe(0);
  });

  test("a spill past the cap is pulled back to it", () => {
    expect((parse(scene([wash({ spillPct: 60 })]))!.actors[0] as SceneWashActor).spillPct).toBe(25);
  });

  test("a wash that does not cover the card cannot hang past it: the spill is dropped, not the wash", () => {
    // A picture fitted whole inside the card has an edge of its own inside the card, and letting it
    // hang past the card would show that edge in mid-air. The server refuses the pair; here it is a
    // row authored against an older rule, and a clipped wash beats a missing one.
    const payload = parse(scene([wash({ spillPct: 12, fit: "contain" })]));

    expect(payload!.actors).toHaveLength(1);
    expect((payload!.actors[0] as SceneWashActor).spillPct).toBe(0);
  });

  test("a sprite may spill too", () => {
    expect((parse(scene([sprite({ spillPct: 8 })]))!.actors[0] as SceneSpriteActor).spillPct).toBe(8);
  });
});

describe("replay", () => {
  const file = (over: Record<string, unknown> = {}) =>
    ({ type: "wash", source: "file", slot: "Secondary", ...over });

  test("a whole file may start over each time the card is shown", () => {
    expect(parse(scene([file({ replay: true })]))!.actors[0].replay).toBe(true);
  });

  test("nothing said is the shared clock every browser gives a picture", () => {
    expect(parse(scene([file()]))!.actors[0].replay).toBe(false);
  });

  test("a rectangle of the sheet has no clock of its own, so it never replays", () => {
    expect(parse(scene([sprite({ replay: true })]))!.actors[0].replay).toBe(false);
  });

  test("anything that is not exactly true is false", () => {
    expect(parse(scene([file({ replay: "yes" })]))!.actors[0].replay).toBe(false);
  });
});

describe("retreat", () => {
  const wash = (over: Record<string, unknown> = {}) =>
    ({ type: "wash", source: "file", slot: "Secondary", ...over });

  test("a full retreat comes through", () => {
    const payload = parse(scene([wash({
      retreat: { atMs: 9200, durationMs: 2800, edgePct: 9, footPct: 7, softPct: 6, remain: 0.1 },
    })]));

    expect((payload!.actors[0] as SceneWashActor).retreat).toEqual({
      atMs: 9200, durationMs: 2800, edgePct: 9, footPct: 7, softPct: 6, remain: 0.1,
    });
  });

  test("only when and how long are needed; the strips default to nothing and the edge to a little softness", () => {
    const payload = parse(scene([wash({ retreat: { atMs: 1000, durationMs: 1000 } })]));

    expect((payload!.actors[0] as SceneWashActor).retreat).toEqual({
      atMs: 1000, durationMs: 1000, edgePct: 0, footPct: 0, softPct: 4, remain: 0,
    });
  });

  test("a retreat with no moment to start is no retreat, and costs only itself", () => {
    const payload = parse(scene([wash({ retreat: { durationMs: 1000 } })]));

    expect(payload!.actors).toHaveLength(1);
    expect((payload!.actors[0] as SceneWashActor).retreat).toBeNull();
  });

  test("a retreat that leaves everything behind is dropped rather than installed to do nothing", () => {
    const payload = parse(scene([wash({ retreat: { atMs: 1000, durationMs: 1000, remain: 1 } })]));

    expect((payload!.actors[0] as SceneWashActor).retreat).toBeNull();
  });

  test("the strips and the softness are held to their caps", () => {
    const payload = parse(scene([wash({ retreat: { atMs: 0, durationMs: 240, edgePct: 80, footPct: -3, softPct: 40 } })]));

    expect((payload!.actors[0] as SceneWashActor).retreat).toEqual({
      atMs: 0, durationMs: 240, edgePct: 50, footPct: 0, softPct: 25, remain: 0,
    });
  });

  test("a sprite and a band may retreat as well", () => {
    const band = { type: "band", source: "file", slot: "Secondary", edge: "bottom", slice: [8, 8, 8, 8], thicknessPct: 12 };
    const payload = parse(scene([
      sprite({ retreat: { atMs: 500, durationMs: 500 } }),
      { ...band, retreat: { atMs: 500, durationMs: 500 } },
    ]));

    expect((payload!.actors[0] as SceneSpriteActor).retreat?.atMs).toBe(500);
    expect((payload!.actors[1] as SceneBandActor).retreat?.atMs).toBe(500);
  });
});

describe("a grow with nothing to uncover", () => {
  const wash = (over: Record<string, unknown> = {}) =>
    ({ type: "wash", source: "file", slot: "Secondary", ...over });

  test("is still a grow: equal ends are its extension, wobble, duration and breathing", () => {
    const payload = parse(scene([wash({
      grow: { fromPct: 100, toPct: 100, durationMs: 7600, repeat: "once", fromScale: 1, sway: { deg: 1.1, ms: 7400 } },
    })]));

    const grow = (payload!.actors[0] as SceneWashActor).grow;

    expect(grow?.fromPct).toBe(100);
    expect(grow?.toPct).toBe(100);
    expect(grow?.sway).toEqual({ deg: 1.1, ms: 7400 });
  });

  test("ends that run backwards are still not a grow", () => {
    const payload = parse(scene([wash({ grow: { fromPct: 100, toPct: 50, durationMs: 1000 } })]));

    expect((payload!.actors[0] as SceneWashActor).grow).toBeNull();
  });
});

describe("the sakura the stand seeds", () => {
  /**
   * Kept verbatim from `server/scipts/seed-dev-cosmetics.ps1` (the `sakura` row), for the one
   * failure mode this engine has that nothing else catches: the server and the client hold the same
   * vocabulary in two languages, and a row the server publishes happily is a row this side may
   * still refuse. That comes out as a cosmetic somebody wears and cannot see, with nothing anywhere
   * saying why. Every field the sakura leans on — spill, replay, retreat, the equal-ended grow —
   * is asserted by name.
   */
  const SAKURA = {
    "reach": "choice",
    "defaultReach": "card",
    "minWidthPx": 160,
    "sheet": {
      "w": 256,
      "h": 64
    },
    "actors": [
      {
        "type": "wash",
        "slot": "Quaternary",
        "source": "file",
        "depth": "deep",
        "fit": "cover",
        "periodMs": 12000,
        "repeat": "once",
        "opacity": [
          {
            "at": 0,
            "v": 0
          },
          {
            "at": 0.42,
            "v": 0
          },
          {
            "at": 0.75,
            "v": 0.85
          },
          {
            "at": 1,
            "v": 0.7
          }
        ]
      },
      {
        "type": "wash",
        "slot": "Secondary",
        "source": "file",
        "depth": "over",
        "fit": "cover",
        "spillPct": 12,
        "replay": true,
        "occlude": [
          "avatar"
        ],
        "periodMs": 8000,
        "repeat": "once",
        "grow": {
          "fromPct": 100,
          "toPct": 100,
          "durationMs": 8000,
          "repeat": "once",
          "fromScale": 1,
          "softness": 0,
          "from": "bottom",
          "sway": {
            "deg": 1.1,
            "ms": 7400
          }
        },
        "retreat": {
          "atMs": 9600,
          "durationMs": 2800,
          "edgePct": 9,
          "footPct": 7,
          "softPct": 6,
          "remain": 0
        },
        "shadow": {
          "dxPct": 0.8,
          "dyPct": 1.2,
          "blurPct": 1.4,
          "alpha": 0.32
        }
      },
      {
        "type": "emitter",
        "slot": "Primary",
        "source": "atlas",
        "atlas": {
          "x": 0,
          "y": 0,
          "w": 64,
          "h": 64
        },
        "depth": "deep",
        "edge": "top",
        "count": 16,
        "seed": 1207,
        "sizePct": 2.4,
        "sizeVarPct": 0.9,
        "durationMs": 9800,
        "durationVarMs": 3200,
        "driftPct": 22,
        "swayPct": 3.2,
        "swayPeriodMs": 2300,
        "swayVarMs": 900,
        "spinDeg": 220,
        "flutterDeg": 55,
        "bobPct": 1.2,
        "depthSpreadPct": 60,
        "delayMs": 26000,
        "opacity": [
          {
            "at": 0,
            "v": 0
          },
          {
            "at": 0.1,
            "v": 0.75
          },
          {
            "at": 0.85,
            "v": 0.75
          },
          {
            "at": 1,
            "v": 0
          }
        ]
      },
      {
        "type": "emitter",
        "slot": "Primary",
        "source": "atlas",
        "atlas": {
          "x": 64,
          "y": 0,
          "w": 64,
          "h": 64
        },
        "depth": "front",
        "edge": "top",
        "count": 26,
        "seed": 4471,
        "sizePct": 3.6,
        "sizeVarPct": 1.3,
        "durationMs": 7600,
        "durationVarMs": 2400,
        "driftPct": 28,
        "swayPct": 4.5,
        "swayPeriodMs": 1900,
        "swayVarMs": 800,
        "spinDeg": 300,
        "flutterDeg": 64,
        "bobPct": 1.8,
        "depthSpreadPct": 70,
        "delayMs": 22000,
        "opacity": [
          {
            "at": 0,
            "v": 0
          },
          {
            "at": 0.08,
            "v": 1
          },
          {
            "at": 0.88,
            "v": 1
          },
          {
            "at": 1,
            "v": 0
          }
        ]
      },
      {
        "type": "emitter",
        "slot": "Primary",
        "source": "atlas",
        "atlas": {
          "x": 128,
          "y": 0,
          "w": 64,
          "h": 64
        },
        "depth": "front",
        "edge": "top",
        "count": 30,
        "seed": 907,
        "sizePct": 3.4,
        "sizeVarPct": 1.2,
        "durationMs": 5200,
        "durationVarMs": 1800,
        "driftPct": 34,
        "swayPct": 5,
        "swayPeriodMs": 1700,
        "swayVarMs": 700,
        "spinDeg": 340,
        "flutterDeg": 70,
        "bobPct": 2,
        "depthSpreadPct": 60,
        "delayMs": 9600,
        "repeat": "once",
        "opacity": [
          {
            "at": 0,
            "v": 0
          },
          {
            "at": 0.06,
            "v": 1
          },
          {
            "at": 0.9,
            "v": 1
          },
          {
            "at": 1,
            "v": 0
          }
        ]
      },
      {
        "type": "band",
        "slot": "Tertiary",
        "source": "file",
        "depth": "over",
        "edge": "bottom",
        "slice": [
          0,
          24,
          0,
          24
        ],
        "thicknessPct": 3.5,
        "cornerPct": 3.5,
        "tile": "round",
        "delayMs": 12400,
        "opacity": [
          {
            "at": 0,
            "v": 0.9
          },
          {
            "at": 1,
            "v": 0.9
          }
        ],
        "grow": {
          "fromPct": 0,
          "toPct": 100,
          "durationMs": 7000,
          "repeat": "once",
          "fromScale": 1,
          "softness": 1,
          "from": "edge"
        }
      }
    ]
  };

  test("keeps all six of its actors, in order", () => {
    const payload = parse(SAKURA);

    expect(payload?.actors.map(actor => actor.type)).toEqual(["wash", "wash", "emitter", "emitter", "emitter", "band"]);
  });

  test("the tree spills, replays, retreats and only breathes", () => {
    const tree = parse(SAKURA)!.actors[1] as SceneWashActor;

    expect(tree.spillPct).toBe(12);
    expect(tree.replay).toBe(true);
    expect(tree.occlude).toEqual(["avatar"]);
    expect(tree.retreat).toEqual({ atMs: 9600, durationMs: 2800, edgePct: 9, footPct: 7, softPct: 6, remain: 0 });
    expect(tree.grow?.fromPct).toBe(100);
    expect(tree.grow?.toPct).toBe(100);
    expect(tree.grow?.sway).toEqual({ deg: 1.1, ms: 7400 });
    expect(tree.shadow?.alpha).toBe(0.32);
  });

  test("the scatters keep their onset delays and the shedding plays once", () => {
    const actors = parse(SAKURA)!.actors;

    expect((actors[2] as SceneEmitterActor).delayMs).toBe(26000);
    expect((actors[3] as SceneEmitterActor).delayMs).toBe(22000);
    expect((actors[4] as SceneEmitterActor).repeat).toBe("once");
    expect((actors[4] as SceneEmitterActor).flutterDeg).toBe(70);
  });

  test("the carpet is uncovered from the foot, once, with a soft edge", () => {
    const carpet = parse(SAKURA)!.actors[5] as SceneBandActor;

    expect(carpet.grow?.from).toBe("edge");
    expect(carpet.grow?.repeat).toBe("once");
    expect(carpet.grow?.softness).toBe(1);
    expect(carpet.thicknessPct).toBe(3.5);
  });
});
// end of the sakura
