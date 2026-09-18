/**
 * Where a scene's actors go, and what the browser is told so that it works the rest out.
 *
 * What these guard: every mistake this arithmetic can make is silent and none of it is visible in a
 * diff. A nudge measured against the card's height instead of its width stretches a figure by however
 * much somebody else's board has stretched the card. An envelope normalised the wrong way inverts a
 * fade. A scatter whose copies share a phase falls in a rank instead of scattering — which looks like
 * one animation repeated, not like snow.
 *
 * The unit split is the load-bearing one and it is asserted directly: an anchor's base is in `cqh`
 * down the card, and every amount a row carries is in `cqw`, always.
 */

import { describe, expect, test } from "vitest";
import {
  DEPTH_Z,
  drawBand,
  drawEmitter,
  drawSprite,
  drawWash,
  hangOf,
  nextReplay,
  placeX,
  placeY,
  replayUrl,
  scatter,
  SCENE_RULES,
  shape,
  spillBoxOf,
  stageOf,
  tornBand,
  veilOf,
} from "@/cosmetics/primitives/sceneGeometry";
import type {
  SceneBandActor,
  SceneEmitterActor,
  SceneGrow,
  SceneSheet,
  SceneSpriteActor,
  SceneStop,
  SceneWashActor,
} from "@/cosmetics/kinds/profile-scene";

const SHEET: SceneSheet = { w: 256, h: 128 };

const CELL = { x: 0, y: 0, w: 64, h: 64, frames: 1, columns: 1, fps: 12, still: 0 };

const common = {
  slot: "Primary",
  source: "atlas" as const,
  atlas: CELL,
  depth: "over" as const,
  occlude: [] as const,
  delayMs: 0,
  opacity: null,
  shadow: null,
  repeat: "loop" as const,
  replay: false,
};

/** A `grow` with everything the reveal used to be and nothing the extension added. */
const wipe = (over: Partial<SceneGrow> = {}): SceneGrow => ({
  fromPct: 0,
  toPct: 100,
  durationMs: 2000,
  holdMs: 0,
  repeat: "loop",
  from: "edge",
  fromScale: 1,
  leadAxis: "y",
  wobbleDeg: 0,
  softness: 0,
  sway: null,
  ...over,
});

const sprite = (over: Partial<SceneSpriteActor> = {}): SceneSpriteActor => ({
  ...common,
  type: "sprite",
  sizePct: 20,
  from: { anchor: "topRight", dxPct: 0, dyPct: 0 },
  to: { anchor: "bottomLeft", dxPct: 0, dyPct: 0 },
  durationMs: 4000,
  repeat: "loop",
  ease: "linear",
  turn: "none",
  scale: null,
  rotate: null,
  bowPct: 0,
  bowAxis: "auto",
  bankDeg: 0,
  bobPct: 0,
  spillPct: 0,
  retreat: null,
  ...over,
});

const wash = (over: Partial<SceneWashActor> = {}): SceneWashActor => ({
  ...common,
  type: "wash",
  fit: "cover",
  periodMs: 8000,
  scale: null,
  grow: null,
  spillPct: 0,
  retreat: null,
  ...over,
});

const band = (over: Partial<SceneBandActor> = {}): SceneBandActor => ({
  ...common,
  source: "file",
  atlas: null,
  slot: "Secondary",
  type: "band",
  edge: "bottom",
  slice: [24, 24, 24, 24],
  thicknessPct: 16,
  cornerPct: 16,
  outsetPct: 0,
  tile: "round",
  grow: null,
  retreat: null,
  ...over,
});

const emitter = (over: Partial<SceneEmitterActor> = {}): SceneEmitterActor => ({
  ...common,
  type: "emitter",
  edge: "top",
  count: 6,
  seed: 41,
  sizePct: 5,
  sizeVarPct: 2,
  durationMs: 6000,
  durationVarMs: 2000,
  driftPct: 8,
  swayPct: 0,
  swayPeriodMs: 2400,
  swayVarMs: 0,
  spinDeg: 0,
  flutterDeg: 0,
  bobPct: 0,
  depthSpreadPct: 0,
  ...over,
});

describe("the stage", () => {
  test("a scene that takes the whole card runs to its bottom edge", () => {
    expect(stageOf("over", "card").bottom).toBe("0");
  });

  test("a scene that leaves the board alone stops where the board starts", () => {
    expect(stageOf("over", "content").bottom).toBe("var(--cosmetic-board-height, 0px)");
  });

  test("only the top corners are rounded when the bottom edge is inside the card", () => {
    const inside = stageOf("over", "content");
    const whole = stageOf("over", "card");

    expect(inside.borderTopLeftRadius).toBe("inherit");
    expect(inside.borderBottomLeftRadius).toBeUndefined();
    expect(whole.borderBottomLeftRadius).toBe("inherit");
  });

  test("it clips, declares a container and takes no clicks", () => {
    const style = stageOf("front", "card");

    expect(style.overflow).toBe("hidden");
    expect(style.containerType).toBe("size");
    expect(style.pointerEvents).toBe("none");
  });

  test("the three depths are the card's own bands", () => {
    expect(DEPTH_Z).toEqual({ deep: "1", over: "3", front: "5" });
  });

  test("a depth is put on the stage rather than hard-coded in a stylesheet", () => {
    expect(stageOf("deep", "card").zIndex).toBe("1");
    expect(stageOf("front", "card").zIndex).toBe("5");
  });
});

describe("occlusion", () => {
  test("an actor hiding behind nothing gets no mask at all", () => {
    expect(veilOf(sprite())).toBeNull();
  });

  test("an actor hiding behind the face reads where the card says the face is", () => {
    const veil = veilOf(sprite({ occlude: ["avatar"] }))!;

    expect(veil.maskImage).toContain("--cosmetic-face-cx");
    expect(veil.maskImage).toContain("--cosmetic-face-r");
    expect(veil.WebkitMaskImage).toBe(veil.maskImage);
  });

  test("the mask is pinned to the stage, not to the actor that moves under it", () => {
    const veil = veilOf(sprite({ occlude: ["avatar"] }))!;

    expect(veil.position).toBe("absolute");
    expect(veil.inset).toBe("0");
  });
});

describe("envelopes", () => {
  const stops = (...pairs: [number, number][]): SceneStop[] =>
    pairs.map(([at, v]) => ({ at, v }));

  test("nothing to shape gives nothing", () => {
    expect(shape(null, "")).toBeNull();
    expect(shape(stops([0, 1]).slice(0, 1), "")).toBeNull();
  });

  test("the ends are the smallest and largest stop", () => {
    const shaped = shape(stops([0, 0.3], [1, 1.6]), "")!;

    expect(shaped.from).toBe("0.3");
    expect(shaped.to).toBe("1.6");
  });

  test("the stops become an easing function, in per cent of the cycle", () => {
    const shaped = shape(stops([0, 0], [1, 1]), "")!;

    expect(shaped.ease).toBe("linear(0 0%, 1 100%)");
  });

  test("a curve that goes up and comes back survives, because an easing function may too", () => {
    const shaped = shape(stops([0, 0], [0.15, 1], [0.8, 1], [1, 0]), "")!;

    expect(shaped.from).toBe("0");
    expect(shaped.to).toBe("1");
    expect(shaped.ease).toBe("linear(0 0%, 1 15%, 1 80%, 0 100%)");
  });

  test("a flat envelope is a constant rather than a division by nothing", () => {
    const shaped = shape(stops([0, 0.7], [1, 0.7]), "")!;

    expect(shaped.from).toBe("0.7");
    expect(shaped.to).toBe("0.7");
    expect(shaped.ease).toBe("linear");
  });

  test("degrees carry their unit into both ends and not into the easing", () => {
    const shaped = shape(stops([0, 0], [1, 540]), "deg")!;

    expect(shaped.from).toBe("0deg");
    expect(shaped.to).toBe("540deg");
    expect(shaped.ease).toBe("linear(0 0%, 1 100%)");
  });

  test("values are normalised against their own range, not against zero", () => {
    const shaped = shape(stops([0, 10], [0.5, 20], [1, 30]), "")!;

    expect(shaped.ease).toBe("linear(0 0%, 0.5 50%, 1 100%)");
  });
});

describe("places", () => {
  const at = (anchor: SceneSpriteActor["from"]["anchor"], dxPct = 0, dyPct = 0) =>
    ({ anchor, dxPct, dyPct });

  test("the corners are where the corners are", () => {
    expect(placeX(at("topLeft"))).toBe("0cqw");
    expect(placeY(at("topLeft"))).toBe("0cqh");
    expect(placeX(at("bottomRight"))).toBe("100cqw");
    expect(placeY(at("bottomRight"))).toBe("100cqh");
    expect(placeX(at("center"))).toBe("50cqw");
    expect(placeY(at("center"))).toBe("50cqh");
  });

  test("a nudge sideways is a per cent of the card's width", () => {
    expect(placeX(at("top", 12))).toBe("calc(50cqw + 12cqw)");
  });

  test("a nudge downwards is ALSO a per cent of the card's width, not of its height", () => {
    // The whole reason a scene survives a card the board has stretched: an anchor follows the
    // height, and everything the author measured follows the width.
    expect(placeY(at("top", 0, -18))).toBe("calc(0cqh + -18cqw)");
  });

  test("no nudge leaves no arithmetic behind", () => {
    expect(placeX(at("left"))).toBe("0cqw");
  });
});

describe("a sprite", () => {
  test("is sized in per cent of the card's width, with its height from the cell", () => {
    const drawn = drawSprite(sprite({ sizePct: 20 }), SHEET, "u", false);

    expect(drawn.box.width).toBe("20cqw");
    expect(drawn.box.height).toBe("20cqw");
  });

  test("keeps the cell's proportions rather than going square", () => {
    const tall = sprite({ sizePct: 20, atlas: { ...CELL, w: 64, h: 128 } });

    expect(drawSprite(tall, SHEET, "u", false).box.height).toBe("40cqw");
  });

  test("puts its own centre on the anchor", () => {
    const drawn = drawSprite(sprite(), SHEET, "u", false);

    expect(drawn.box.translate).toBe("calc(-50% + var(--cs-x0)) calc(-50% + var(--cs-y0))");
  });

  test("carries both ends of its path as custom properties", () => {
    const drawn = drawSprite(sprite(), SHEET, "u", false);

    expect(drawn.box["--cs-x0"]).toBe("100cqw");
    expect(drawn.box["--cs-y0"]).toBe("0cqh");
    expect(drawn.box["--cs-x1"]).toBe("0cqw");
    expect(drawn.box["--cs-y1"]).toBe("100cqh");
  });

  test("animates travel, scale, spin and fade as four separate tracks", () => {
    const drawn = drawSprite(sprite({
      scale: [{ at: 0, v: 0.3 }, { at: 1, v: 1.6 }],
      rotate: [{ at: 0, v: 0 }, { at: 1, v: 540 }],
      opacity: [{ at: 0, v: 0 }, { at: 1, v: 1 }],
    }), SHEET, "u", false);

    expect(drawn.box.animationName).toBe(
      "cosmetic-scene-travel, cosmetic-scene-scale, cosmetic-scene-spin, cosmetic-scene-fade");
  });

  test("gives each track its own easing, which is where a row's curve lives", () => {
    const drawn = drawSprite(sprite({
      ease: "inOut",
      opacity: [{ at: 0, v: 0 }, { at: 0.1, v: 1 }, { at: 1, v: 0 }],
    }), SHEET, "u", false);

    expect(drawn.box.animationTimingFunction)
      .toBe("ease-in-out, linear(0 0%, 1 10%, 0 100%)");
  });

  test("a once-through path fills forwards; a ping-pong alternates", () => {
    expect(drawSprite(sprite({ repeat: "once" }), SHEET, "u", false).box.animationFillMode).toBe("forwards");
    expect(drawSprite(sprite({ repeat: "pingPong" }), SHEET, "u", false).box.animationDirection).toBe("alternate");
  });

  test("stands entirely still when movement is off", () => {
    const drawn = drawSprite(sprite({ scale: [{ at: 0, v: 1 }, { at: 1, v: 2 }] }), SHEET, "u", true);

    expect(drawn.box.animationName).toBeUndefined();
  });

  test("cuts its rectangle out of the sheet by scaling the whole sheet to the cell", () => {
    // A 64px cell drawn 20cqw wide is 20/64 cqw per source pixel, so a 256x128 sheet is 80x40.
    const drawn = drawSprite(sprite({ sizePct: 20 }), SHEET, "u", false);

    expect(drawn.art.backgroundSize).toBe("80cqw 40cqw");
  });

  test("offsets to the rectangle in lengths, never in per cent of the room left over", () => {
    const off = sprite({ sizePct: 20, atlas: { ...CELL, x: 128, y: 64 } });
    const drawn = drawSprite(off, SHEET, "u", false);

    expect(drawn.art.backgroundPositionX).toBe("-40cqw");
    expect(drawn.art.backgroundPositionY).toBe("-20cqw");
  });

  test("walks a strip with two tracks, because a strip is read as a grid", () => {
    const strip = sprite({ atlas: { ...CELL, frames: 8, columns: 4, fps: 10 } });
    const drawn = drawSprite(strip, SHEET, "u", false);

    expect(drawn.art.animationName).toBe("cosmetic-scene-sheet-x, cosmetic-scene-sheet-y");
    expect(drawn.art.animationTimingFunction).toBe("steps(4), steps(2)");
    expect(drawn.art.animationDuration).toBe("400ms, 800ms");
  });

  test("freezes on the frame the author chose rather than on the first", () => {
    const strip = sprite({ sizePct: 20, atlas: { ...CELL, frames: 8, columns: 4, fps: 10, still: 5 } });
    const drawn = drawSprite(strip, SHEET, "u", true);

    // Frame five of a four-wide grid is the second frame of the second row.
    expect(drawn.art.backgroundPositionX).toBe("-20cqw");
    expect(drawn.art.backgroundPositionY).toBe("-20cqw");
    expect(drawn.art.animationName).toBeUndefined();
  });

  test("is mirrored only when its path actually runs the other way", () => {
    const left = sprite({ turn: "mirror" });
    const right = sprite({
      turn: "mirror",
      from: { anchor: "bottomLeft", dxPct: 0, dyPct: 0 },
      to: { anchor: "topRight", dxPct: 0, dyPct: 0 },
    });

    expect(drawSprite(left, SHEET, "u", false).art.transform).toBe("scaleX(-1)");
    expect(drawSprite(right, SHEET, "u", false).art.transform).toBeUndefined();
  });

  test("a whole file is an <img> rather than a background", () => {
    const own = sprite({ source: "file", atlas: null, slot: "Secondary" });
    const drawn = drawSprite(own, SHEET, "figure.png", false);

    expect(drawn.img).toBe("figure.png");
    expect(drawn.art.backgroundImage).toBeUndefined();
  });
});

describe("a wash", () => {
  test("covers the stage", () => {
    const drawn = drawWash(wash(), SHEET, "u", false);

    expect(drawn.box.inset).toBe("0");
  });

  test("crops rather than distorts by default, and stretches when asked", () => {
    expect(drawWash(wash(), SHEET, "u", false).art.backgroundSize).toBe("cover");
    expect(drawWash(wash({ fit: "stretch" }), SHEET, "u", false).art.backgroundSize).toBe("100% 100%");
    expect(drawWash(wash({ fit: "contain" }), SHEET, "u", false).art.backgroundSize).toBe("contain");
  });

  test("stands on the bottom of the card rather than floating in the middle of it", () => {
    // Weather does not care which way a crop falls; a tree does. Centred in a card shorter than the
    // picture, it is a tree with its roots cut off and hanging in the air.
    expect(drawWash(wash(), SHEET, "u", false).art.backgroundPosition).toBe("center bottom");
  });

  test("holds at its brightest when movement is off, not at whatever came first", () => {
    const fading = wash({ opacity: [{ at: 0, v: 0 }, { at: 0.5, v: 0.9 }, { at: 1, v: 0 }] });

    expect(drawWash(fading, SHEET, "u", true).box.opacity).toBe("0.9");
  });

  test("can play through once and stay, rather than being weather forever", () => {
    const arriving = wash({ repeat: "once", opacity: [{ at: 0, v: 0 }, { at: 1, v: 1 }] });
    const drawn = drawWash(arriving, SHEET, "u", false);

    expect(drawn.box.animationIterationCount).toBe("1");
    expect(drawn.box.animationFillMode).toBe("forwards");
  });
});

describe("a band", () => {
  test("lies along the edge it names, across the whole of it", () => {
    const drawn = drawBand(band({ edge: "bottom", thicknessPct: 16 }), "u", false);

    expect(drawn.box.left).toBe("0");
    expect(drawn.box.right).toBe("0");
    expect(drawn.box.height).toBe("16cqw");
    expect(drawn.box.bottom).toBe("0cqw");
  });

  test("turns on its side for a vertical edge", () => {
    const drawn = drawBand(band({ edge: "left", thicknessPct: 10 }), "u", false);

    expect(drawn.box.width).toBe("10cqw");
    expect(drawn.box.top).toBe("0");
    expect(drawn.box.bottom).toBe("0");
  });

  test("reaches outside the stage by a negative offset", () => {
    expect(drawBand(band({ outsetPct: 4 }), "u", false).box.bottom).toBe("-4cqw");
  });

  test("is a nine-slice with two widths at zero and the middle drawn", () => {
    const drawn = drawBand(band({ edge: "bottom", cornerPct: 9 }), "u", false);

    expect(drawn.art.borderImageSlice).toBe("24 24 24 24 fill");
    expect(drawn.art.borderImageWidth).toBe("0 9cqw 0 9cqw");
    expect(drawn.art.borderImageRepeat).toBe("round");
  });

  test("sets border-image-width and border-width both, because only the second is not enough", () => {
    const drawn = drawBand(band(), "u", false);

    expect(drawn.art.borderWidth).toBe(drawn.art.borderImageWidth);
    expect(drawn.art.borderStyle).toBe("solid");
  });

  test("swaps which pair of widths is zero on a vertical edge", () => {
    const drawn = drawBand(band({ edge: "left", cornerPct: 7 }), "u", false);

    expect(drawn.art.borderImageWidth).toBe("7cqw 0 7cqw 0");
  });

  test("grows by being uncovered from its own edge, not by being scaled up", () => {
    const grown = band({ grow: wipe({ durationMs: 2600, holdMs: 0, repeat: "loop", from: "edge" }) });
    const drawn = drawBand(grown, "u", false);

    expect(drawn.box.maskImage).toContain("to top");
    expect(drawn.box["--cs-g0"]).toBe("100% 0%");
    expect(drawn.box["--cs-g1"]).toBe("100% 100%");
    expect(drawn.box.animationName).toBe("cosmetic-scene-grow");
  });

  test("a reveal rooted at a point is radial, and never measured to the CLOSEST side", () => {
    // The centre is pinned to a corner of the mask's own box, and the side closest to a corner is
    // the one it stands on — so `closest-side` resolves to a radius of zero and the mask hides the
    // whole actor, for ever, with nothing reporting it. It shipped that way for one screenshot.
    const rooted = band({
      grow: wipe({ durationMs: 3000, holdMs: 0, repeat: "once", from: "bottomLeft" }),
    });
    const drawn = drawBand(rooted, "u", false);

    expect(drawn.box.maskImage).toContain("farthest-corner");
    expect(drawn.box.maskImage).not.toContain("closest-side");
    expect(drawn.box.maskImage).toContain("at left bottom");
    expect(drawn.box.maskPosition).toBe("left bottom");
  });

  test("a rooted reveal is calibrated to finish exactly when it has taken the card", () => {
    // The box is a per cent of the stage in both axes and the gradient is `farthest-corner`, so at
    // 100% the radius is precisely the distance from the root to the card's far corner — on a short
    // card and on one a board has stretched alike. A reach picked by eye covers a small card in a
    // third of its own duration and reads as a flash.
    const rooted = band({
      grow: wipe({ durationMs: 3000, holdMs: 0, repeat: "once", from: "center" }),
    });
    const drawn = drawBand(rooted, "u", false);

    expect(drawn.box["--cs-g0"]).toBe("0% 0%");
    expect(drawn.box["--cs-g1"]).toBe("100% 100%");
  });

  test("a whole-card picture can be grown too, because growing is not a nine-slice's business", () => {
    const tree = wash({
      grow: wipe({ durationMs: 3000, holdMs: 0, repeat: "once", from: "bottom" }),
    });
    const drawn = drawWash(tree, SHEET, "u", false);

    expect(drawn.box.maskImage).toContain("at center bottom");
    expect(drawn.box.animationName).toContain("cosmetic-scene-grow");
  });

  test("a root this build does not know falls back to the edge wipe, never into the gradient", () => {
    // `radial-gradient(circle farthest-corner at undefined, …)` is not a parse error — it is a
    // declaration the browser silently throws away, and an actor with no mask looks exactly like one
    // that finished growing before it started.
    const unknown = band({
      grow: wipe({ durationMs: 3000, holdMs: 0, repeat: "once", from: "root" as never }),
    });
    const drawn = drawBand(unknown, "u", false);

    expect(drawn.box.maskImage).toBe("linear-gradient(to top, #000 0 100%)");
    expect(drawn.box.maskImage).not.toContain("undefined");
    expect(drawn.box.maskPosition).toBe("bottom");
  });

  test("its mask is an image and nothing else, with the repeat said separately", () => {
    // `mask-image` takes an image. A `no-repeat` tacked onto the end of it does not make the mask
    // repeat once — it makes the whole declaration invalid and the element is not masked at all,
    // which looks exactly like a band that is always finished. It shipped that way once.
    const grown = band({ grow: wipe({ durationMs: 2600, holdMs: 0, repeat: "loop", from: "edge" }) });
    const drawn = drawBand(grown, "u", false);

    expect(drawn.box.maskImage).toBe("linear-gradient(to top, #000 0 100%)");
    expect(drawn.box.maskRepeat).toBe("no-repeat");
    expect(drawn.box.WebkitMaskImage).toBe(drawn.box.maskImage);
    expect(drawn.box.WebkitMaskRepeat).toBe("no-repeat");
  });

  test("buys the hold out of the cycle rather than with a second animation", () => {
    const grown = band({ grow: wipe({ durationMs: 2000, holdMs: 6000, repeat: "loop", from: "edge" }) });
    const drawn = drawBand(grown, "u", false);

    expect(drawn.box.animationDuration).toBe("8000ms");
    expect(drawn.box.animationTimingFunction).toBe("linear(0 0%, 1 25%, 1 100%)");
  });

  test("stands finished rather than unstarted when movement is off", () => {
    const grown = band({ grow: wipe({ durationMs: 2600, holdMs: 0, repeat: "loop", from: "edge" }) });
    const drawn = drawBand(grown, "u", true);

    expect(drawn.box.maskSize).toBe("100% 100%");
    expect(drawn.box.animationName).toBeUndefined();
  });
});

describe("a scatter", () => {
  test("is the same sequence every time from the same seed", () => {
    const one = scatter(41);
    const two = scatter(41);

    expect([one(), one(), one()]).toEqual([two(), two(), two()]);
  });

  test("is a different sequence from a different seed", () => {
    expect(scatter(41)()).not.toBe(scatter(42)());
  });

  test("stays inside nought and one", () => {
    const next = scatter(7);

    for (let draw = 0; draw < 200; draw++) {
      const value = next();

      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("gives exactly as many copies as the row asked for", () => {
    expect(drawEmitter(emitter({ count: 12 }), SHEET, "u", false)).toHaveLength(12);
  });

  test("puts every copy at a different point of its own cycle", () => {
    // Without this they start together and fall in a rank, which is one animation repeated rather
    // than snow — and it is the only reason an emitter carries a seed at all.
    const copies = drawEmitter(emitter({ count: 8 }), SHEET, "u", false);
    const delays = copies.map(copy => copy.box.animationDelay);

    expect(new Set(delays).size).toBe(8);
  });

  test("starts every copy already on its way, with a delay that runs backwards", () => {
    for (const copy of drawEmitter(emitter({ count: 6 }), SHEET, "u", false)) {
      expect(copy.box.animationDelay!.startsWith("-")).toBe(true);
    }
  });

  test("spreads the copies across the edge they fall from", () => {
    const copies = drawEmitter(emitter({ count: 8, edge: "top" }), SHEET, "u", false);
    const places = copies.map(copy => copy.box["--cs-x0"]);

    expect(new Set(places).size).toBe(8);
  });

  test("falls from the named edge and leaves by the far one", () => {
    const [copy] = drawEmitter(emitter({ count: 1, edge: "top" }), SHEET, "u", false);

    expect(copy.box["--cs-y0"]!.startsWith("-")).toBe(true);
    expect(copy.box["--cs-y1"]).toContain("100cqh");
  });

  test("blows sideways from a side edge instead", () => {
    const [copy] = drawEmitter(emitter({ count: 1, edge: "left" }), SHEET, "u", false);

    expect(copy.box["--cs-x0"]!.startsWith("-")).toBe(true);
    expect(copy.box["--cs-x1"]).toContain("100cqw");
  });

  test("flutters on the picture, not on the box that is already travelling", () => {
    const [copy] = drawEmitter(emitter({ count: 1, swayPct: 3 }), SHEET, "u", false);

    expect(copy.art.animationName).toContain("cosmetic-scene-flutter");
    expect(copy.box.animationName).not.toContain("cosmetic-scene-flutter");
  });

  test("draws nothing at all when movement is off", () => {
    expect(drawEmitter(emitter(), SHEET, "u", true)).toEqual([]);
  });

  test("a scatter that plays once staggers forwards instead of backwards", () => {
    // A looping scatter has to look as though it has been falling since before the card opened, so
    // every copy starts part-way through its cycle. One that ends has to look as though it started
    // when you arrived — and a negative delay there freezes half the copies at their end state
    // before the first frame, which is a card that opens with petals already lying on it.
    const copies = drawEmitter(emitter({ count: 8, repeat: "once" }), SHEET, "u", false);

    for (const copy of copies) {
      expect(copy.box.animationDelay!.startsWith("-")).toBe(false);
    }
  });

  test("a scatter that plays once holds where it landed", () => {
    // Travel and spin, so two tracks, and both have to hold: a copy that stopped spinning but kept
    // its landing place would snap back to zero degrees the moment it settled.
    const [copy] = drawEmitter(emitter({ count: 1, repeat: "once", spinDeg: 180 }), SHEET, "u", false);

    expect(copy.box.animationIterationCount).toBe("1, 1");
    expect(copy.box.animationFillMode).toBe("forwards, forwards");
  });

  test("its swing keeps going even when its fall does not", () => {
    // The swing is what a petal is doing, not where it is going, and the fill on a finished travel
    // holds the copy where it landed either way.
    const [copy] = drawEmitter(emitter({ count: 1, repeat: "once", swayPct: 3 }), SHEET, "u", false);

    expect(copy.art.animationIterationCount).toContain("infinite");
  });

  test("pitches on the same clock as it swings, because they are one motion", () => {
    // The whole physical claim of the flutter: a thing coming down through air is fastest sideways
    // exactly when it is edge-on. Give the pitch its own period and the two drift apart within a few
    // seconds, and the copy is then a picture being rocked while it happens to slide.
    const [copy] = drawEmitter(
      emitter({ count: 1, swayPct: 4, flutterDeg: 70, swayPeriodMs: 2600 }),
      SHEET, "u", false,
    );

    const names = copy.art.animationName!.split(", ");
    const durations = copy.art.animationDuration!.split(", ");
    const delays = copy.art.animationDelay!.split(", ");

    const swing = names.indexOf("cosmetic-scene-flutter");
    const pitch = names.indexOf("cosmetic-scene-pitch");

    expect(swing).toBeGreaterThanOrEqual(0);
    expect(pitch).toBeGreaterThanOrEqual(0);
    expect(durations[pitch]).toBe(durations[swing]);
    expect(delays[pitch]).toBe(delays[swing]);
  });

  test("carries its own perspective rather than asking an ancestor for one", () => {
    // A veil that cuts the avatar out of an actor carries a mask, and a mask forces `preserve-3d` to
    // flatten — so an inherited perspective reaches the copies of one emitter and not another's, for
    // a reason nothing on screen would explain.
    const [copy] = drawEmitter(emitter({ count: 1, flutterDeg: 60 }), SHEET, "u", false);

    expect(copy.art["--cs-eye"]).toMatch(/cqw$/);
    expect(SCENE_RULES).toContain("perspective(var(--cs-eye))");
  });

  test("gives every copy its own period, or the whole scatter pulses", () => {
    const copies = drawEmitter(
      emitter({ count: 8, swayPct: 4, swayPeriodMs: 2400, swayVarMs: 900 }),
      SHEET, "u", false,
    );

    const periods = new Set(copies.map(copy => copy.art.animationDuration));

    expect(periods.size).toBeGreaterThan(1);
  });

  test("turns its copies both ways rather than cranking them all one way", () => {
    const copies = drawEmitter(emitter({ count: 12, spinDeg: 220 }), SHEET, "u", false);
    const turns = copies.map(copy => copy.box["--cs-r1"]);

    expect(turns).toContain("220deg");
    expect(turns).toContain("-220deg");
  });

  test("reads a copy's distance off its size, so the three cannot disagree", () => {
    // Size, speed and weight all come from the one draw. Taking a second for any of them lets a copy
    // be large, slow and faint at once, which is three different distances at the same moment.
    const copies = drawEmitter(
      emitter({ count: 16, sizeVarPct: 2, depthSpreadPct: 100 }),
      SHEET, "u", false,
    );

    const read = copies.map(copy => ({
      size: Number.parseFloat(copy.box.width!),
      ms: Number.parseFloat(copy.box.animationDuration!),
      dim: Number.parseFloat(copy.art.opacity!),
    })).sort((one, two) => one.size - two.size);

    const near = read[read.length - 1];
    const far = read[0];

    expect(near.ms).toBeLessThan(far.ms);
    expect(near.dim).toBeGreaterThan(far.dim);
  });

  test("leaves speed and weight alone when no depth was asked for", () => {
    const copies = drawEmitter(emitter({ count: 8, sizeVarPct: 2 }), SHEET, "u", false);

    for (const copy of copies) {
      expect(copy.art.opacity).toBeUndefined();
    }
  });

  test("keeps the five draws it always made, so a seed still scatters the same way", () => {
    // The order is data. Three draws were appended for the flutter, and inserting any of them among
    // the original five would move every copy of every scene anybody has ever authored — which looks
    // exactly like a rendering bug and is not one.
    const before = drawEmitter(emitter({ count: 6 }), SHEET, "u", false);
    const after = drawEmitter(
      emitter({ count: 6, flutterDeg: 70, swayVarMs: 600, spinDeg: 120 }),
      SHEET, "u", false,
    );

    expect(after.map(copy => copy.box["--cs-x0"])).toEqual(before.map(copy => copy.box["--cs-x0"]));
    expect(after.map(copy => copy.box.width)).toEqual(before.map(copy => copy.box.width));
  });
});

describe("growing", () => {
  test("extends from its root instead of only being uncovered", () => {
    // The complaint this answers: a reveal shows a picture that was always its finished size, so
    // half a reveal of a tree is the lower half of a grown one. Half a life of a tree is a small
    // whole tree, and the extension is the only thing that says so.
    const tree = wash({ grow: wipe({ from: "bottom", fromScale: 0.08, durationMs: 3600 }) });
    const drawn = drawWash(tree, SHEET, "u", false);

    expect(drawn.box.animationName).toContain("cosmetic-scene-extend");
    expect(drawn.box.scale).toBe("0.044 0.08");
    expect(drawn.box.transformOrigin).toBe("center bottom");
  });

  test("starts its lagging axis smaller, so it reaches before it fills out", () => {
    const along = drawWash(wash({ grow: wipe({ from: "bottom", fromScale: 0.2, leadAxis: "x" }) }), SHEET, "u", false);
    const both = drawWash(wash({ grow: wipe({ from: "bottom", fromScale: 0.2, leadAxis: "both" }) }), SHEET, "u", false);

    expect(along.box.scale).toBe("0.2 0.11");
    expect(both.box.scale).toBe("0.2 0.2");
  });

  test("a row may still ask for the bare reveal it used to get", () => {
    const drawn = drawBand(band({ grow: wipe({ fromScale: 1 }) }), "u", false);

    expect(drawn.box.animationName).not.toContain("cosmetic-scene-extend");
    expect(drawn.box.scale).toBeUndefined();
  });

  test("goes on doing something once it has finished arriving", () => {
    // A tree that grows and then holds perfectly still is a photograph of a tree, and no care spent
    // on how it arrived survives that.
    const drawn = drawWash(
      wash({ grow: wipe({ from: "bottom", durationMs: 3600, sway: { deg: 1.4, ms: 7000 } }) }),
      SHEET, "u", false,
    );

    const names = drawn.box.animationName!.split(", ");
    const breath = names.indexOf("cosmetic-scene-breathe");

    expect(breath).toBeGreaterThanOrEqual(0);
    expect(drawn.box.animationDelay!.split(", ")[breath]).toBe("3600ms");
    expect(drawn.box.animationIterationCount!.split(", ")[breath]).toBe("infinite");
  });

  test("its wobble and its breathing are on different properties, so neither waits", () => {
    const drawn = drawWash(
      wash({ grow: wipe({ from: "bottom", wobbleDeg: 6, sway: { deg: 1.4, ms: 7000 } }) }),
      SHEET, "u", false,
    );

    expect(drawn.box.animationName).toContain("cosmetic-scene-wobble");
    expect(drawn.box.animationName).toContain("cosmetic-scene-breathe");
    expect(drawn.box["--cs-wob"]).toBe("6deg");
    expect(drawn.box["--cs-sway-deg"]).toBe("1.4deg");
  });

  test("stands finished and still when movement is off", () => {
    const drawn = drawWash(
      wash({ grow: wipe({ from: "bottom", fromScale: 0.08, wobbleDeg: 6, sway: { deg: 1.4, ms: 7000 } }) }),
      SHEET, "u", true,
    );

    expect(drawn.box.animationName).toBeUndefined();
    expect(drawn.box.scale).toBeUndefined();
    expect(drawn.box.maskSize).toBe("100% 100%");
  });

  test("a soft reveal fades at its edge and a hard one says so by saying nothing", () => {
    const soft = drawBand(band({ grow: wipe({ softness: 0.5 }) }), "u", false);
    const hard = drawBand(band({ grow: wipe({ softness: 0 }) }), "u", false);

    expect(soft.box.maskImage).toBe("linear-gradient(to top, #000 0 75%, transparent 100%)");
    expect(hard.box.maskImage).toBe("linear-gradient(to top, #000 0 100%)");
  });
});

describe("a bowed path", () => {
  test("bows across the way it mostly runs, and only across it", () => {
    const across = drawSprite(sprite({
      from: { anchor: "left", dxPct: 0, dyPct: 0 },
      to: { anchor: "right", dxPct: 0, dyPct: 0 },
      bowPct: 12,
    }), SHEET, "u", false);

    const climbing = drawSprite(sprite({
      from: { anchor: "bottom", dxPct: 0, dyPct: 0 },
      to: { anchor: "top", dxPct: 0, dyPct: 0 },
      bowPct: 12,
    }), SHEET, "u", false);

    // The midpoint carries the bow on one axis and is the plain average on the other, so the path
    // is pushed off its chord without being lengthened along it.
    expect(across.box["--cs-ym"]).toBe("calc((50cqh + 50cqh) / 2 + 12cqw)");
    expect(across.box["--cs-xm"]).toBe("calc((0cqw + 100cqw) / 2)");
    expect(climbing.box["--cs-xm"]).toBe("calc((50cqw + 50cqw) / 2 + 12cqw)");
    expect(climbing.box["--cs-ym"]).toBe("calc((100cqh + 0cqh) / 2)");
  });

  test("a straight path is left on the plain travel rather than given a midpoint", () => {
    // A scatter and an unbowed figure share that rule, and it has two stops. An arc rule reading a
    // midpoint nobody set would not be a straight line — it would be a keyframe the browser throws
    // away, which is a figure that stops where it started.
    const drawn = drawSprite(sprite(), SHEET, "u", false);

    expect(drawn.box.animationName).toContain("cosmetic-scene-travel");
    expect(drawn.box["--cs-xm"]).toBeUndefined();
  });

  test("a row that disagrees with the guess gets its own answer", () => {
    const drawn = drawSprite(sprite({
      from: { anchor: "left", dxPct: 0, dyPct: 0 },
      to: { anchor: "right", dxPct: 0, dyPct: 0 },
      bowPct: 12,
      bowAxis: "x",
    }), SHEET, "u", false);

    expect(drawn.box["--cs-xm"]).toBe("calc((0cqw + 100cqw) / 2 + 12cqw)");
  });

  test("a mirrored figure banks the other way, because the mirror is applied after the lean", () => {
    // `rotate` is applied before `transform`, so a figure sent the other way and flipped would turn
    // a climb into a dive without anything in the row changing.
    const right = drawSprite(sprite({
      from: { anchor: "left", dxPct: 0, dyPct: 0 },
      to: { anchor: "right", dxPct: 0, dyPct: 0 },
      turn: "mirror",
      bankDeg: 9,
    }), SHEET, "u", false);

    const left = drawSprite(sprite({
      from: { anchor: "right", dxPct: 0, dyPct: 0 },
      to: { anchor: "left", dxPct: 0, dyPct: 0 },
      turn: "mirror",
      bankDeg: 9,
    }), SHEET, "u", false);

    expect(right.art["--cs-bank"]).toBe("9deg");
    expect(left.art["--cs-bank"]).toBe("-9deg");
    expect(left.art.transform).toBe("scaleX(-1)");
  });

  test("takes its wingbeat from the strip and refuses to invent one", () => {
    const winged = drawSprite(sprite({
      atlas: { x: 0, y: 0, w: 64, h: 64, frames: 4, columns: 4, fps: 8, still: 0 },
      bobPct: 2,
    }), SHEET, "u", false);

    const still = drawSprite(sprite({ bobPct: 2 }), SHEET, "u", false);

    const names = winged.art.animationName!.split(", ");
    const bob = names.indexOf("cosmetic-scene-bob");

    expect(winged.art.animationDuration!.split(", ")[bob]).toBe("500ms");
    expect(still.art.animationName ?? "").not.toContain("cosmetic-scene-bob");
  });
});

describe("the air between the bands", () => {
  test("a far band is duller and a near one is not", () => {
    expect(stageOf("deep", "card").filter).toBe("saturate(0.88) brightness(0.92)");
    expect(stageOf("over", "card").filter).toBeUndefined();
    expect(stageOf("front", "card").filter).toBe("saturate(1.03) brightness(1.03)");
  });

  test("a shadow follows the actor's own outline and is never installed unasked", () => {
    const grounded = drawWash(
      wash({ shadow: { dxPct: 1, dyPct: 2, blurPct: 3, alpha: 0.4 } }),
      SHEET, "u", false,
    );

    expect(grounded.art.filter).toBe("drop-shadow(1cqw 2cqw 3cqw rgb(0 0 0 / 0.4))");
    expect(drawWash(wash(), SHEET, "u", false).art.filter).toBeUndefined();
  });
});

describe("the rules", () => {
  test("carry no number from any catalogue row", () => {
    // Every amount arrives as a custom property these read. A rule built from a row's numbers would
    // be CSS coming out of a database onto everybody who opens a profile.
    //
    // A bare zero is exempt and only a bare zero: `rotate3d(x, y, 0, 0deg)` needs an angle to say
    // "not turned", and there is no amount in it to have come from anywhere. Anything else carrying
    // a unit is a number that was decided here instead of in the row, which is the thing this
    // guards.
    const amounts = SCENE_RULES.match(/\b(?!0(?:px|ms|deg|cqw|cqh)\b)\d+(\.\d+)?(px|ms|deg|cqw|cqh)\b/g);

    expect(amounts).toBeNull();
  });

  test("name every animation the drawings ask for", () => {
    for (const name of [
      "cosmetic-scene-travel",
      "cosmetic-scene-scale",
      "cosmetic-scene-spin",
      "cosmetic-scene-fade",
      "cosmetic-scene-grow",
      "cosmetic-scene-flutter",
      "cosmetic-scene-pitch",
      "cosmetic-scene-extend",
      "cosmetic-scene-wobble",
      "cosmetic-scene-breathe",
      "cosmetic-scene-arc",
      "cosmetic-scene-bank",
      "cosmetic-scene-bob",
      "cosmetic-scene-sheet-x",
      "cosmetic-scene-sheet-y",
    ]) {
      expect(SCENE_RULES).toContain(`@keyframes ${name}`);
    }
  });

  test("never put two of an actor's own channels on one property", () => {
    // The whole reason this kind needs no wrapper per channel: `translate`, `rotate`, `scale` and
    // `transform` are four independent properties, and every rule here claims exactly one of them.
    // Two rules writing the same property do not compose — the later one silently replaces the
    // earlier — so a collision would be a channel that simply stops happening on some rows.
    const claims = new Map<string, string[]>();

    // `--cs-yield` is the veil's own: the withdrawal is a registered property the veil's mask reads,
    // on a third element that carries nothing else, so it can collide with none of the box's channels.
    for (const block of SCENE_RULES.matchAll(/@keyframes (cosmetic-scene-[\w-]+) \{([\s\S]*?)\n\}/g)) {
      const written = new Set(
        [...block[2].matchAll(/(?:^|[{;]|\s)(translate|rotate|scale|transform|opacity|mask-size|background-position-[xy]|--cs-yield):/g)]
          .map(hit => hit[1]),
      );

      for (const property of written) {
        claims.set(property, [...(claims.get(property) ?? []), block[1]]);
      }

      expect(written.size).toBe(1);
    }

    // The pairs that deliberately share a property are on different elements, never on one: the box
    // travels while its picture flutters, and a growing thing extends on the box while a wash's own
    // breath rides the picture.
    expect(claims.get("transform")).toEqual([
      "cosmetic-scene-pitch",
      "cosmetic-scene-breathe",
    ]);
  });
});

describe("a stage that spills", () => {
  test("a loose stage does not clip and does not contain its paint, and still declares the container", () => {
    const loose = stageOf("over", "card", true);

    expect(loose.overflow).toBe("visible");
    expect(loose.contain).toBe("none");
    expect(loose.containerType).toBe("size");
    expect(loose.borderTopLeftRadius).toBeUndefined();
    expect(loose.zIndex).toBe("3");
  });

  test("the ordinary stage is unchanged by the third argument being absent", () => {
    expect(stageOf("over", "card").overflow).toBe("hidden");
    expect(stageOf("over", "card").contain).toBeUndefined();
  });

  test("the spill box reaches past every edge by the spill, in per cent of the card's width, and clips there", () => {
    const box = spillBoxOf(12, "card");

    expect(box.top).toBe("-12cqw");
    expect(box.left).toBe("-12cqw");
    expect(box.right).toBe("-12cqw");
    expect(box.bottom).toBe("-12cqw");
    expect(box.overflow).toBe("hidden");
    expect(box.pointerEvents).toBe("none");
  });

  test("a scene that leaves the board alone does not hang over it either", () => {
    // The stage already stops at the board, so the box's bottom is the stage's own — not the board's
    // height again, which stood a tree on the top of the card on the stand.
    expect(spillBoxOf(12, "content").bottom).toBe("0");
    expect(spillBoxOf(12, "content").top).toBe("-12cqw");
  });

  test("the hang of a spilling actor is its spill on three sides, and on the fourth only over the whole card", () => {
    expect(hangOf(wash({ spillPct: 12 }), "card")).toEqual({ x: 12, top: 12, bottom: 12 });
    expect(hangOf(wash({ spillPct: 12 }), "content")).toEqual({ x: 12, top: 12, bottom: 0 });
    expect(hangOf(wash(), "card")).toEqual({ x: 0, top: 0, bottom: 0 });
    expect(hangOf(emitter(), "card")).toEqual({ x: 0, top: 0, bottom: 0 });
  });

  test("a spilling sprite's anchors still name points of the card, not of the larger box", () => {
    const hung = drawSprite(sprite({ spillPct: 12 }), SHEET, "u", false, { x: 12, top: 12, bottom: 12 });
    const flat = drawSprite(sprite(), SHEET, "u", false);

    expect(flat.box["--cs-x0"]).toBe("100cqw");
    expect(hung.box["--cs-x0"]).toBe("calc(100cqw + 12cqw)");
    expect(hung.box["--cs-y0"]).toBe("calc(0cqh + 12cqw)");
    expect(hung.box["--cs-x1"]).toBe("calc(0cqw + 12cqw)");
    expect(hung.box["--cs-y1"]).toBe("calc(100cqh + 12cqw)");
  });

  test("a spilling wash needs no arithmetic at all: its box is the larger one and cover fills it", () => {
    const drawn = drawWash(wash({ spillPct: 12, source: "file", atlas: null }), null, "u", false);

    expect(drawn.box.inset).toBe("0");
    expect(drawn.art.objectFit).toBe("cover");
    expect(drawn.art.objectPosition).toBe("center bottom");
  });
});

describe("retreat", () => {
  const withdrawing = (over: Partial<SceneWashActor> = {}) => wash({
    retreat: { atMs: 9200, durationMs: 2800, edgePct: 9, footPct: 7, softPct: 6, remain: 0 },
    ...over,
  });

  test("an actor that neither hides nor retreats gets no veil at all", () => {
    expect(veilOf(wash())).toBeNull();
  });

  test("is a mask on the veil, cut from the card's own glass line and the strips the row keeps", () => {
    const veil = veilOf(withdrawing())!;

    expect(veil.maskImage).toContain("var(--cosmetic-glass-top, 0px)");
    expect(veil.maskImage).toContain("6cqw");
    expect(veil.maskSize).toContain("15cqw 100%");
    expect(veil.maskSize).toContain("100% 13cqw");
    expect(veil.WebkitMaskImage).toBe(veil.maskImage);
    expect(veil.maskRepeat).toBe("no-repeat");
  });

  test("its interior is the registered property, so the withdrawal interpolates", () => {
    const veil = veilOf(withdrawing())!;

    expect(veil.maskImage).toContain("calc(var(--cs-yield) * (1 - 0))");
    expect(SCENE_RULES).toContain("@property --cs-yield");
    expect(SCENE_RULES).toContain("@keyframes cosmetic-scene-retreat");
  });

  test("what remains is written into the interior rather than into a second animation", () => {
    const veil = veilOf(withdrawing({
      retreat: { atMs: 1, durationMs: 240, edgePct: 0, footPct: 0, softPct: 4, remain: 0.25 },
    }))!;

    expect(veil.maskImage).toContain("calc(var(--cs-yield) * (1 - 0.25))");
  });

  test("is the exact complement of the reading zone: a solid layer XOR the zone, never a union of partial alphas", () => {
    const veil = veilOf(withdrawing())!;

    expect(veil.maskImage.startsWith("linear-gradient(#000, #000)")).toBe(true);
    expect(veil.maskComposite).toBe("exclude, subtract, add, add, add, add");
  });

  test("the zone is the card and not the veil, so what has spilled past the card is never withdrawn", () => {
    const veil = veilOf(withdrawing({ spillPct: 12 }), { x: 12, top: 12, bottom: 12 })!;

    expect(veil.maskSize.split(", ")[1]).toBe("calc(100% - 2 * var(--cs-hang-x)) calc(100% - var(--cs-hang-top) - var(--cs-hang-bottom))");
    expect(veil.maskPosition.split(", ")[1]).toBe("var(--cs-hang-x) var(--cs-hang-top)");
  });

  test("the strips it keeps are torn, not ruled, and each is solid at the edge it keeps", () => {
    const veil = veilOf(withdrawing())!;

    expect(veil.maskImage.match(/url\("data:image\/svg\+xml/g)).toHaveLength(3);

    // The left strip fades towards the interior, which is the band that is solid on its left.
    expect(veil.maskImage.indexOf(tornBand("right"))).toBeLessThan(veil.maskImage.indexOf(tornBand("left")));
    expect(veil.maskPosition).toContain("calc(100% - var(--cs-hang-x)) 0");
    expect(veil.maskPosition).toContain("0 calc(100% - var(--cs-hang-bottom))");
  });

  test("a face hole intersects on top of it", () => {
    const veil = veilOf(withdrawing({ occlude: ["avatar"] }))!;

    expect(veil.maskImage.startsWith("radial-gradient(")).toBe(true);
    expect(veil.maskComposite).toBe("intersect, exclude, subtract, add, add, add, add");
  });

  test("plays once, from the moment the row names, and holds", () => {
    const veil = veilOf(withdrawing())!;

    expect(veil.animationName).toBe("cosmetic-scene-retreat");
    expect(veil.animationDuration).toBe("2800ms");
    expect(veil.animationDelay).toBe("9200ms");
    expect(veil.animationIterationCount).toBe("1");
    expect(veil.animationFillMode).toBe("forwards");
  });

  test("stands withdrawn when movement is off", () => {
    const veil = veilOf(withdrawing(), { x: 0, top: 0, bottom: 0 }, true)!;

    expect(veil["--cs-yield"]).toBe("1");
    expect(veil.animationName).toBeUndefined();
  });

  test("reads the card's edges through the hang, so a spilling actor retreats from the card and not from its own larger box", () => {
    const veil = veilOf(withdrawing({ occlude: ["avatar"], spillPct: 12 }), { x: 12, top: 12, bottom: 12 })!;

    expect(veil["--cs-hang-x"]).toBe("12cqw");
    expect(veil["--cs-hang-top"]).toBe("12cqw");
    expect(veil["--cs-hang-bottom"]).toBe("12cqw");
    expect(veil.maskImage).toContain("at calc(var(--cs-hang-x) + var(--cosmetic-face-cx, 50%))");
    expect(veil.maskImage).toContain("var(--cs-hang-top) + var(--cosmetic-glass-top, 0px)");
  });

  test("a hole alone is what it always was", () => {
    const veil = veilOf(sprite({ occlude: ["avatar"] }))!;

    expect(veil.maskImage.startsWith("radial-gradient(")).toBe(true);
    expect(veil.maskComposite).toBeUndefined();
    expect(veil.animationName).toBeUndefined();
  });
});

describe("a grow with nothing to uncover", () => {
  test("installs no mask and no reveal, and still breathes", () => {
    const breathing = wash({
      grow: wipe({ fromPct: 100, toPct: 100, durationMs: 7600, repeat: "once", sway: { deg: 1.1, ms: 7400 } }),
    });
    const drawn = drawWash(breathing, null, "u", false);

    expect(drawn.box.maskImage).toBeUndefined();
    expect(drawn.box.animationName).not.toContain("cosmetic-scene-grow");
    expect(drawn.box.animationName).toContain("cosmetic-scene-breathe");
    expect(drawn.box.animationDelay).toContain("7600ms");
  });

  test("still turns about its root", () => {
    const breathing = wash({ grow: wipe({ fromPct: 100, toPct: 100, from: "bottom" }) });

    expect(drawWash(breathing, null, "u", false).box.transformOrigin).toBe("center bottom");
  });
});

describe("replaying a file", () => {
  test("marks the request so the browser gives this showing its own picture and its own clock", () => {
    expect(replayUrl("https://api/files/abc", 3)).toBe("https://api/files/abc?replay=3");
    expect(replayUrl("https://api/files/abc?x=1", 3)).toBe("https://api/files/abc?x=1&replay=3");
  });

  test("leaves a blob or a data URL alone, because a query would not survive either", () => {
    expect(replayUrl("blob:https://api/uuid", 3)).toBe("blob:https://api/uuid");
    expect(replayUrl("data:image/svg+xml;base64,AAA", 3)).toBe("data:image/svg+xml;base64,AAA");
  });

  test("every mounting draws a different number", () => {
    const first = nextReplay();

    expect(nextReplay()).not.toBe(first);
  });
});

describe("a shadow on a self-animating file", () => {
  const shadow = { dxPct: 1, dyPct: 1.5, blurPct: 2, alpha: 0.3 };

  test("rides the box rather than the picture, because Chromium does not repaint a file animating behind its own filter", () => {
    const drawn = drawWash(wash({ source: "file", atlas: null, shadow }), null, "u", false);

    expect(drawn.art.filter).toBeUndefined();
    expect(drawn.box.filter).toContain("drop-shadow(");
  });

  test("the same for a figure drawn from a whole file", () => {
    const drawn = drawSprite(sprite({ source: "file", atlas: null, shadow }), null, "u", false);

    expect(drawn.art.filter).toBeUndefined();
    expect(drawn.box.filter).toContain("drop-shadow(");
  });

  test("a rectangle of the sheet keeps its shadow on the picture, where it follows the flutter", () => {
    const drawn = drawSprite(sprite({ shadow }), SHEET, "u", false);

    expect(drawn.art.filter).toContain("drop-shadow(");
    expect(drawn.box.filter).toBeUndefined();
  });
});

describe("the torn edge of a spill", () => {
  test("a spill box is masked along its margin by four torn bands and a solid interior, all unioned", () => {
    const box = spillBoxOf(12, "card");
    const layers = box.maskImage.split("), ").length;

    expect(layers).toBe(5);
    expect(box.maskImage.match(/url\("data:image\/svg\+xml/g)).toHaveLength(4);
    expect(box.maskImage.endsWith("linear-gradient(#000, #000)")).toBe(true);
    expect(box.maskComposite).toBe("add");
    expect(box.maskRepeat).toBe("no-repeat");
    expect(box.WebkitMaskImage).toBe(box.maskImage);
  });

  test("the bands are the spill wide and the interior is the card, so the tear lives only in the margin", () => {
    const box = spillBoxOf(12, "card");

    expect(box.maskSize).toBe("12cqw 100%, 12cqw 100%, 100% 12cqw, 100% 12cqw, calc(100% - 24cqw) calc(100% - 24cqw)");
    expect(box.maskPosition).toBe("left top, right top, left top, left bottom, 12cqw 12cqw");
  });

  test("a scene that stops at the board has no bottom band and its interior runs to the bottom", () => {
    const box = spillBoxOf(12, "content");

    expect(box.maskImage.match(/url\("data:image\/svg\+xml/g)).toHaveLength(3);
    expect(box.maskSize).toBe("12cqw 100%, 12cqw 100%, 100% 12cqw, calc(100% - 24cqw) calc(100% - 12cqw)");
    expect(box.maskPosition).toBe("left top, right top, left top, 12cqw 12cqw");
  });

  test("a band is the same tear every time and a different tear on every side", () => {
    expect(tornBand("left")).toBe(tornBand("left"));
    expect(new Set([tornBand("left"), tornBand("right"), tornBand("top"), tornBand("bottom")]).size).toBe(4);
  });

  test("a band is solid at the card's edge, fades and blurs outward, and is drawn past its own inner edge so the blur cannot thin the card's edge", () => {
    const band = decodeURIComponent(tornBand("left").replace(/^data:image\/svg\+xml,/, ""));

    expect(band).toContain("feGaussianBlur");
    expect(band).toContain("<linearGradient");
    expect(band).toContain('viewBox="0 0 100 1000"');

    // The polygon's inner side lies outside the viewBox, at 160 rather than 100.
    expect(band).toContain("M160 0");
  });
});
