import type {
  SceneActor,
  SceneAnchor,
  SceneAtlas,
  SceneBandActor,
  SceneDepth,
  SceneEmitterActor,
  SceneEdge,
  ScenePoint,
  SceneReach,
  SceneRepeat,
  SceneRetreat,
  SceneSheet,
  SceneShadow,
  SceneSpriteActor,
  SceneStop,
  SceneWashActor,
  SceneWrapActor,
  SceneGrow,
} from "@/cosmetics/kinds/profile-scene";

/**
 * Where a scene's actors are at every moment, and what the browser is told so that it works that out
 * for itself.
 *
 * <b>Nothing below runs per frame.</b> There is a fixed set of keyframe rules, installed once, and
 * not one number in any of them comes from a catalogue row. What a row carries arrives as inline custom
 * properties the rules read, and as an easing function that shapes the path between them — so a
 * scene costs a handful of style objects and no JavaScript at all.
 *
 * <b>An envelope is an easing function, not a generated rule.</b> The obvious way to give each row
 * its own curve is to write it a `@keyframes` and put that on the page, and that is CSS arriving
 * from a database onto everybody who opens a profile. `linear()` says the same thing as a value
 * instead of as a rule: it rides on the element, it is made of numbers, and nothing is installed.
 *
 * <b>Two container units do all the work.</b> The stage declares `container-type: size`, so `cqw` is
 * a per cent of the card's width and `cqh` a per cent of its height. Every size and every nudge a row
 * carries is in `cqw`; only an anchor's own base is in `cqh`. That is the whole reason a scene
 * survives a card the board has stretched by four hundred pixels — a figure stays the size it was
 * drawn and an edge stays an edge, because nothing measured sideways is measured against the height.
 */

type Style = Record<string, string>;

/**
 * Which band of the card an actor is drawn in.
 *
 * The numbers are the profile card's own, not this file's invention: its background sits at 0, its
 * spacer at 1, its glass at 2, and anything laid over the whole card at 4. So `deep` is above the
 * background and behind the glass — where an actor sinks out of sight as it passes the glass line,
 * which is depth for free and without a mask — `over` is above the card's own words and below a worn
 * frame, and `front` is above everything including the frame.
 */
export const DEPTH_Z: Readonly<Record<SceneDepth, string>> = {
  deep: "1",
  over: "3",
  front: "5",
};

/** Drawn low to high, so a stage of each band comes out in the right order. */
export const DEPTHS: readonly SceneDepth[] = ["deep", "over", "front"];

/**
 * What a band of depth does to the light, which is the difference between an order and a distance.
 *
 * <b>Fixed in code, and deliberately not a field.</b> What `deep` <i>means</i> is the kind's
 * vocabulary; a row that could set its own haze could put its background in front of its foreground
 * and nothing would be able to tell it apart from an author's intent. Air between the viewer and a
 * thing drains its colour and its contrast, so the far band is duller and darker and the near one
 * marginally crisper.
 *
 * <b>Contrast and not blur.</b> A blur on the band would haze a background wash that is meant to be
 * sharp, and it costs a compositing layer on every card in a member list. The contrast cue carries
 * the reading by itself, and `over` — which is where most actors are — takes no filter at all, so
 * the ordinary case costs nothing.
 */
const DEPTH_AIR: Readonly<Record<SceneDepth, string | null>> = {
  deep: "saturate(0.88) brightness(0.92)",
  over: null,
  front: "saturate(1.03) brightness(1.03)",
};

const ANCHOR_X: Readonly<Record<SceneAnchor, number>> = {
  topLeft: 0, top: 50, topRight: 100,
  left: 0, center: 50, right: 100,
  bottomLeft: 0, bottom: 50, bottomRight: 100,
};

const ANCHOR_Y: Readonly<Record<SceneAnchor, number>> = {
  topLeft: 0, top: 0, topRight: 0,
  left: 50, center: 50, right: 50,
  bottomLeft: 100, bottom: 100, bottomRight: 100,
};

/**
 * Where a radial reveal is rooted, as CSS says it — used twice for the same point: once for the
 * centre of the gradient, once for the corner of the box it is painted in.
 */
const ANCHOR_SPOT: Readonly<Record<SceneAnchor, string>> = {
  topLeft: "left top", top: "center top", topRight: "right top",
  left: "left center", center: "center center", right: "right center",
  bottomLeft: "left bottom", bottom: "center bottom", bottomRight: "right bottom",
};

/**
 * A radial reveal is calibrated so that it finishes exactly when it has taken the card, on a card of
 * any shape — which is why its box is a per cent of the stage in both axes and its gradient is
 * `farthest-corner`.
 *
 * At a size of 100% the mask's box is the card, and the corner of that box farthest from the root is
 * the corner of the card farthest from the root. So the radius at the end of the reveal is exactly
 * the distance it had to cover, and the same row lands the same way on a short card and on one a
 * board has stretched to twice the height. A reach picked by eye instead — three hundred per cent of
 * the width was the first guess — covers a small card in a third of its own duration and reads as a
 * flash rather than as growth.
 */
const RADIAL_FULL = 100;

/** The travel easing a row names. Separate from an envelope, which shapes a channel rather than a path. */
const EASES: Readonly<Record<string, string>> = {
  linear: "linear",
  in: "ease-in",
  out: "ease-out",
  inOut: "ease-in-out",
};

/**
 * How a thing extends when it grows, as progress against its own clock.
 *
 * Fixed here rather than taken from a row, for the reason every other shape in this file is: the row
 * says how far, the code says what it is like. It overshoots a little and settles, because something
 * pushing itself up against its own weight arrives slightly past where it stops.
 */
const EXTEND_STOPS: readonly (readonly [number, number])[] = [
  [0, 0], [0.28, 18], [0.63, 38], [0.88, 58], [1.045, 78], [0.985, 90], [1, 100],
];

/**
 * That shape, squeezed into its share of a longer cycle.
 *
 * <b>The extension has to ride the reveal's cycle and not its own.</b> A reveal buys its hold out of
 * the cycle — it finishes in its share and the rest of the cycle is the thing standing — and a
 * `pingPong` reveal then runs the whole cycle backwards. An extension on a separate clock would
 * drift out of step with the mask within one lap, and a thing whose outline and whose size disagree
 * about how grown it is does not read as anything.
 */
function extendEase(share: number): string {
  const points = EXTEND_STOPS.map(([value, at]) => `${n(value)} ${n(at * share)}%`);

  if (share < 1) points.push("1 100%");

  return `linear(${points.join(", ")})`;
}

/**
 * How far behind the lagging axis of a growing thing starts, against the leading one.
 *
 * A shoot reaches before it thickens. Both axes finish together on one easing, so starting the
 * lagging one smaller is the whole of the lag — it has further to travel in the same time.
 */
const LEAD_LAG = 0.55;

/**
 * How a thing that has come loose falls.
 *
 * Not `linear`: a petal that has just let go is still picking up speed for the first breath, and
 * then it is at terminal velocity for the rest of the way down. The whole correction lives in the
 * first tenth of the path, which is the only part of it that is not terminal.
 */
const FALL_EASE = "linear(0 0%, 0.028 9%, 0.22 26%, 0.5 51%, 1 100%)";

/**
 * How far off the horizontal a copy's pitch axis may lean, in radians.
 *
 * <b>This is why a tumble needs no channel.</b> A copy pitching about a truly horizontal axis rocks
 * like a shutter; lean the axis and the same rocking reads as a tumble, and every copy leaning
 * differently is a scatter of things falling rather than a rank of them.
 */
const TILT_SPREAD = 0.9;

/** How far away the eye is from a falling copy, as a multiple of the copy's own width. */
const EYE_DISTANCE = 3.2;

/**
 * How much of a copy's size, speed and weight its distance is allowed to account for, at full
 * spread. Three numbers off one draw, so a copy cannot be near and slow or far and heavy.
 */
const DEPTH_SIZE = 0.35;
const DEPTH_SPEED = 0.55;
const DEPTH_FADE = 0.45;

interface Cycle {
  readonly count: string;
  readonly direction: string;
  readonly fill: string;
}

const CYCLES: Readonly<Record<SceneRepeat, Cycle>> = {
  loop: { count: "infinite", direction: "normal", fill: "none" },
  once: { count: "1", direction: "normal", fill: "forwards" },
  pingPong: { count: "infinite", direction: "alternate", fill: "none" },
};

/**
 * A number, short enough to read in a devtools panel.
 *
 * Four places rather than two: an easing function's stops are fractions of one, and rounding those
 * to a hundredth visibly flattens a curve with eight of them.
 */
function n(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

/** A length in per cent of the card's width. */
function w(value: number): string {
  return `${n(value)}cqw`;
}

/** A length in per cent of the stage's height. */
function h(value: number): string {
  return `${n(value)}cqh`;
}

// ── The stage ───────────────────────────────────────────────────────────────────────────────────

/**
 * The box one band of depth is drawn in.
 *
 * <b>`bottom` is the whole of the reach setting.</b> A scene told to leave the board alone ends at
 * the board's top edge, and that edge is the line everything anchored to `bottom` grows from — so
 * one property decides both where the scene is clipped and where its flowers come out of the ground.
 * The card publishes the number (see `useCardMap`); this reads it.
 *
 * Only the top corners take the card's radius when the board is excluded: the stage's bottom edge is
 * then somewhere in the middle of the card, and rounding it there would bite two curved notches out
 * of whatever is standing on it.
 */
export function stageOf(depth: SceneDepth, reach: SceneReach, loose = false): Style {
  const full = reach === "card";

  const style: Style = {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    bottom: full ? "0" : "var(--cosmetic-board-height, 0px)",
    zIndex: DEPTH_Z[depth],
    overflow: loose ? "visible" : "hidden",
    pointerEvents: "none",
    userSelect: "none",

    // What makes `cqw` and `cqh` mean anything below. Without it every size in this file resolves
    // against the viewport, which on a 384px card is off by an order of magnitude.
    containerType: "size",
  };

  // <b>A loose stage clips nothing, and its spill box does the clipping instead.</b> The stage is
  // the container every `cqw` below is measured against, so it has to stay the size of the card;
  // the box that reaches past the card is its child and clips at the margin. `contain: paint` is
  // the component stylesheet's own clip and has to be turned off here, inline, or the margin is
  // cut back to the card and nothing reports it.
  if (loose) {
    style.contain = "none";

    return withAir(style, depth);
  }

  style.borderTopLeftRadius = "inherit";
  style.borderTopRightRadius = "inherit";

  if (full) {
    style.borderBottomLeftRadius = "inherit";
    style.borderBottomRightRadius = "inherit";
  }

  return withAir(style, depth);
}

/**
 * One filter for the whole band rather than one per actor: everything at a distance is at the same
 * distance, which is what a band is, and it keeps the cost flat however many actors are in it.
 */
function withAir(style: Style, depth: SceneDepth): Style {
  const air = DEPTH_AIR[depth];

  if (air !== null) style.filter = air;

  return style;
}

/**
 * The box a spilling actor is drawn in: the card, plus its spill on every side, clipping there.
 *
 * <b>A margin and not the absence of a clip.</b> On a short card a picture that covers this box
 * bursts out of the top and is cut at the margin; on a tall one it is wider than the card and cut at
 * the sides. Both read as a thing trying to get out, and neither hangs a tall card's tree over
 * somebody else's messages. No corner radius: what is bursting out of a card should not come out
 * rounded.
 *
 * The bottom is only opened when the scene reaches the whole card. A scene told to leave the board
 * alone stops where the board starts, and hanging over it by a margin would be leaving it alone in
 * name only. The stage this box sits in already ends at the board, so the box's own bottom is then
 * simply the stage's — subtracting the board here as well stood a tree on the top of the card.
 */
export function spillBoxOf(spillPct: number, reach: SceneReach): Style {
  const margin = w(-spillPct);
  const full = reach === "card";

  const style: Style = {
    position: "absolute",
    top: margin,
    left: margin,
    right: margin,
    bottom: full ? margin : "0",
    overflow: "hidden",
    pointerEvents: "none",
    userSelect: "none",
  };

  // <b>The margin is torn, not ruled.</b> Whatever the picture's crop cuts at the box's edge would
  // otherwise be cut along a straight line — a crown of blossom ending in a wall, which is the one
  // thing foliage never does. Four bands lie along the margin, each solid at the card's edge and
  // wandering, blurring and fading outward, and the card itself is solid underneath; the union is
  // the mask. The tear lives only in the margin, so nothing inside the card is touched by it.
  const spill = w(spillPct);
  const sides: TornSide[] = full ? ["left", "right", "top", "bottom"] : ["left", "right", "top"];

  const images = sides.map(side => `url("${tornBand(side)}")`);
  const sizes = sides.map(side => (side === "left" || side === "right" ? `${spill} 100%` : `100% ${spill}`));
  const positions = sides.map(side => TORN_POSITION[side]);

  images.push("linear-gradient(#000, #000)");
  sizes.push(`calc(100% - ${w(spillPct * 2)}) calc(100% - ${w(full ? spillPct * 2 : spillPct)})`);
  positions.push(`${spill} ${spill}`);

  const mask = images.join(", ");

  style.maskImage = mask;
  style.WebkitMaskImage = mask;
  style.maskSize = sizes.join(", ");
  style.WebkitMaskSize = style.maskSize;
  style.maskPosition = positions.join(", ");
  style.WebkitMaskPosition = style.maskPosition;
  style.maskRepeat = "no-repeat";
  style.WebkitMaskRepeat = "no-repeat";
  style.maskComposite = "add";

  return style;
}

// ── The torn edge ───────────────────────────────────────────────────────────────────────────────

type TornSide = "left" | "right" | "top" | "bottom";

const TORN_POSITION: Readonly<Record<TornSide, string>> = {
  left: "left top",
  right: "right top",
  top: "left top",
  bottom: "left bottom",
};

/**
 * Each side tears its own way. The seeds are fixed, so the tear is the same on every card and in
 * every preview — a margin that tore differently on each opening would read as flicker.
 */
const TORN_SEED: Readonly<Record<TornSide, number>> = {
  left: 0x5a11,
  right: 0x2b7d,
  top: 0x7c31,
  bottom: 0x1e59,
};

/** How many places along the edge the tear is sampled at. Fewer is scalloped; more is noise. */
const TORN_POINTS = 22;

/** How far out of the margin the tear reaches, as a fraction of it: never quite the box's edge. */
const TORN_REACH_LOW = 0.28;
const TORN_REACH_HIGH = 0.96;

const tornBands = new Map<TornSide, string>();

/**
 * One side's band, as a data URL for `mask-image`: an SVG of a shape solid along the card's edge
 * whose far side wanders, blurred and fading, across the margin.
 *
 * <b>The long axis is a thousand units and the image is stretched to the box</b>, so the tear's
 * rhythm follows the card's height rather than a fixed pixel size — a tall card gets longer waves,
 * which is what a bigger crown would have. The shape is drawn past its own inner edge, at 160
 * rather than 100, because the blur would otherwise thin the mask along the card's edge and draw a
 * faint seam exactly where the interior takes over.
 *
 * Fixed text and a fixed seed: not one number in here comes from a row.
 */
export function tornBand(side: TornSide): string {
  const known = tornBands.get(side);

  if (known !== undefined) return known;

  const along = side === "left" || side === "right";
  const next = scatter(TORN_SEED[side]);
  const points: [number, number][] = [];

  for (let index = 0; index < TORN_POINTS; index++) {
    const at = (1000 / (TORN_POINTS - 1)) * index;
    const reach = 100 * (TORN_REACH_LOW + next() * (TORN_REACH_HIGH - TORN_REACH_LOW));

    // The card's edge is at 100 for a left or top band and at 0 for a right or bottom one, and the
    // tear reaches away from it.
    const across = side === "left" || side === "top" ? 100 - reach : reach;

    points.push(along ? [across, at] : [at, across]);
  }

  const inner = side === "left" || side === "top" ? 160 : -60;
  const start = along ? `M${inner} 0 L${inner} 1000` : `M0 ${inner} L1000 ${inner}`;
  const last = points[points.length - 1];
  let d = `${start} L${n(last[0])} ${n(last[1])}`;

  // A smooth curve through the samples: each sample is the control point of a quadratic that ends
  // halfway to the next, which is what keeps a tear from being a saw.
  for (let index = points.length - 1; index > 0; index--) {
    const control = points[index];
    const toward = points[index - 1];
    const mid: [number, number] = [(control[0] + toward[0]) / 2, (control[1] + toward[1]) / 2];

    d += ` Q${n(control[0])} ${n(control[1])} ${n(mid[0])} ${n(mid[1])}`;
  }

  d += ` L${n(points[0][0])} ${n(points[0][1])} Z`;

  const box = along ? "0 0 100 1000" : "0 0 1000 100";
  const gradient = side === "left" ? "x1=\"100\" y1=\"0\" x2=\"0\" y2=\"0\""
    : side === "right" ? "x1=\"0\" y1=\"0\" x2=\"100\" y2=\"0\""
      : side === "top" ? "x1=\"0\" y1=\"100\" x2=\"0\" y2=\"0\""
        : "x1=\"0\" y1=\"0\" x2=\"0\" y2=\"100\"";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">`
    + `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" ${gradient}>`
    + `<stop offset="0" stop-color="#000"/><stop offset="0.5" stop-color="#000" stop-opacity="0.8"/>`
    + `<stop offset="1" stop-color="#000" stop-opacity="0.2"/></linearGradient>`
    + `<filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter></defs>`
    + `<path d="${d}" fill="url(#g)" filter="url(#b)"/></svg>`;

  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  tornBands.set(side, url);

  return url;
}

/**
 * How far a spilling actor's box reaches past the card on each side, in per cent of the card's
 * width — what everything that has to name a point of the card adds to its own coordinates.
 *
 * Three numbers rather than one, because the bottom is different: it is the spill over the whole
 * card and nothing when the scene stops at the board. See `spillBoxOf`.
 */
export interface Hang {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

export const NO_HANG: Hang = { x: 0, top: 0, bottom: 0 };

/** The hang of an actor: its spill where it has one, and nothing for the sorts that cannot. */
export function hangOf(actor: SceneActor, reach: SceneReach): Hang {
  const spill = actor.type === "wash" || actor.type === "sprite" ? actor.spillPct : 0;

  if (spill <= 0) return NO_HANG;

  return { x: spill, top: spill, bottom: reach === "card" ? spill : 0 };
}

/**
 * A shadow of the actor's own outline, or nothing at all.
 *
 * `drop-shadow` reads the alpha channel, so a tree throws a tree and not the rectangle it is drawn
 * in — which is the whole reason it is worth a filter. Only installed when a row asks: a filter on a
 * card-sized picture costs a compositing layer, and most actors are in mid-air where nothing would
 * catch a shadow in the first place.
 */
function shadowOf(shadow: SceneShadow | null): string | null {
  if (shadow === null) return null;

  return `drop-shadow(${w(shadow.dxPct)} ${w(shadow.dyPct)} ${w(shadow.blurPct)}`
    + ` rgb(0 0 0 / ${n(shadow.alpha)}))`;
}

/** Adds a filter to a style that may already have one, rather than replacing it. */
function addFilter(style: Style, filter: string | null): void {
  if (filter === null) return;

  style.filter = style.filter === undefined ? filter : `${style.filter} ${filter}`;
}

/**
 * A hole in an actor where the card's face is.
 *
 * <b>A mask rather than a z-index</b>, for the reason the avatar orbit uses one: an avatar with no
 * picture is drawn as its own coloured disc with a letter on it, so anything merely ordered behind
 * it would show straight through the head. A mask asks nothing at all of how the avatar draws itself.
 *
 * It goes on a wrapper pinned to the stage rather than on the actor, because the actor moves and the
 * face does not — a mask on a travelling element travels with it, and the hole would chase the figure
 * around the card.
 */
export function veilOf(actor: SceneActor, hang: Hang = NO_HANG, reduced = false): Style | null {
  const hides = actor.occlude.includes("avatar");
  const retreat = actor.type === "emitter" ? null : actor.retreat;

  if (!hides && retreat === null) return null;

  const style: Style = {
    position: "absolute",
    inset: "0",

    // Where the card's own edges are, in the veil's coordinates. Zero for an actor clipped at the
    // card; a spilling actor's veil is the larger box, and everything below that names a point of
    // the card adds these, so a face stays a face and a glass line stays a glass line.
    "--cs-hang-x": hang.x === 0 ? "0px" : w(hang.x),
    "--cs-hang-top": hang.top === 0 ? "0px" : w(hang.top),
    "--cs-hang-bottom": hang.bottom === 0 ? "0px" : w(hang.bottom),
  };

  const layers = new MaskLayers();

  if (hides) {
    layers.add(
      "radial-gradient(circle var(--cosmetic-face-r, 0px)"
      + " at calc(var(--cs-hang-x) + var(--cosmetic-face-cx, 50%))"
      + " calc(var(--cs-hang-top) + var(--cosmetic-face-cy, 50%)),"
      + " transparent 0 97%, #000 100%)",
      "intersect",
    );
  }

  if (retreat !== null) {
    retreatLayers(layers, retreat);

    if (reduced) {
      style["--cs-yield"] = "1";
    } else {
      const tracks = new Tracks();

      tracks.add("cosmetic-scene-retreat", retreat.durationMs, "ease-in-out", retreat.atMs, CYCLES.once);
      tracks.writeInto(style);
    }
  }

  layers.writeInto(style, hides && retreat === null);

  return style;
}

/**
 * The layers of one mask, built up in order from the top, with what each one composites onto the
 * layers beneath it.
 *
 * Longhands and lists, for the reason `Tracks` uses them: a layer with an image in it needs its own
 * size and place, and a shorthand holding six of those is a thing a minifier reads differently.
 */
class MaskLayers {
  private readonly images: string[] = [];
  private readonly sizes: string[] = [];
  private readonly positions: string[] = [];
  private readonly composites: string[] = [];

  add(image: string, composite: string, size = "100% 100%", position = "0 0"): void {
    this.images.push(image);
    this.sizes.push(size);
    this.positions.push(position);
    this.composites.push(composite);
  }

  /**
   * A hole alone is what the veil always was, and is written exactly as it was: one layer, nothing
   * to composite, no size and no repeat to say.
   */
  writeInto(style: Style, bare: boolean): void {
    const mask = this.images.join(", ");

    style.maskImage = mask;
    style.WebkitMaskImage = mask;

    if (bare) return;

    style.maskSize = this.sizes.join(", ");
    style.WebkitMaskSize = style.maskSize;
    style.maskPosition = this.positions.join(", ");
    style.WebkitMaskPosition = style.maskPosition;
    style.maskRepeat = "no-repeat";
    style.WebkitMaskRepeat = "no-repeat";
    style.maskComposite = this.composites.join(", ");
  }
}

/**
 * The reading zone, as layers whose composite is its exact complement.
 *
 * <b>XOR against a solid layer, never a union of the parts kept.</b> The zone is the card's glass
 * zone with the kept parts taken out of it, at an alpha of the withdrawal so far: `solid ⊕ (K −
 * kept)`, where K is that alpha over the card and `kept` is the union of the hero zone above the
 * glass line and the strips along the sides and the foot. That is one minus the withdrawal inside
 * the zone and one everywhere else — an exact complement. Adding up the kept parts and fading
 * the rest instead would compound their partial alphas where they overlap, so the middle of the
 * fade would run ahead of its edges.
 *
 * <b>The strips are torn, not ruled.</b> Each is one of the spill's bands laid inside the card
 * with its solid side at the edge it keeps, so a cluster of blossom left standing at the side ends
 * the way foliage ends, in blobs, rather than along a soft vertical line. The hero zone keeps a
 * straight soft edge, because the glass line it follows is straight.
 *
 * <b>K covers the card and not the veil.</b> A spilling actor's veil is the larger box, and
 * whatever hangs past the card is not under the words and is not withdrawn.
 *
 * <b>The interior alpha is a registered custom property.</b> A gradient cannot be interpolated, but
 * a number can, and `@property` makes `--cs-yield` one the browser interpolates and the mask
 * recomputes from — the same trick the avatar orbit's `--ao-veil` uses.
 */
function retreatLayers(layers: MaskLayers, retreat: SceneRetreat): void {
  const inside = `rgb(0 0 0 / calc(var(--cs-yield) * (1 - ${n(retreat.remain)})))`;
  const side = w(retreat.edgePct + retreat.softPct);
  const foot = w(retreat.footPct + retreat.softPct);
  const soft = w(retreat.softPct);

  layers.add("linear-gradient(#000, #000)", "exclude");

  layers.add(
    `linear-gradient(${inside}, ${inside})`,
    "subtract",
    "calc(100% - 2 * var(--cs-hang-x)) calc(100% - var(--cs-hang-top) - var(--cs-hang-bottom))",
    "var(--cs-hang-x) var(--cs-hang-top)",
  );

  // Solid on the side that faces the card's edge, fading towards the words: the left strip is the
  // band that is solid on its left, and a percentage position aligns an image's far edge.
  layers.add(`url("${tornBand("right")}")`, "add", `${side} 100%`, "var(--cs-hang-x) 0");
  layers.add(`url("${tornBand("left")}")`, "add", `${side} 100%`, "calc(100% - var(--cs-hang-x)) 0");
  layers.add(`url("${tornBand("top")}")`, "add", `100% ${foot}`, "0 calc(100% - var(--cs-hang-bottom))");

  layers.add(
    "linear-gradient(to bottom,"
    + " #000 0,"
    + ` #000 calc(var(--cs-hang-top) + var(--cosmetic-glass-top, 0px) - ${soft}),`
    + ` transparent calc(var(--cs-hang-top) + var(--cosmetic-glass-top, 0px) + ${soft}),`
    + " transparent 100%)",
    "add",
  );
}

// ── Envelopes ───────────────────────────────────────────────────────────────────────────────────

/** An envelope as something CSS can animate: two ends, and the shape of the path between them. */
export interface Shaped {
  readonly from: string;
  readonly to: string;
  readonly ease: string;
}

/**
 * An envelope, normalised.
 *
 * <b>`linear()` describes progress, not value</b>, so the channel is given the smallest and largest
 * stop as its two ends and the easing says how it travels between them. A non-monotonic envelope
 * survives that untouched — an easing function is free to go up and come back down — and a flat one
 * degrades to a constant rather than dividing by a range of zero.
 */
export function shape(stops: readonly SceneStop[] | null, unit: "" | "deg"): Shaped | null {
  if (stops === null || stops.length < 2) return null;

  let low = stops[0].v;
  let high = stops[0].v;

  for (const stop of stops) {
    low = Math.min(low, stop.v);
    high = Math.max(high, stop.v);
  }

  const span = high - low;

  if (span < 1e-6) return { from: `${n(low)}${unit}`, to: `${n(low)}${unit}`, ease: "linear" };

  const points: string[] = [];

  for (const stop of stops) {
    points.push(`${n((stop.v - low) / span)} ${n(stop.at * 100)}%`);
  }

  return { from: `${n(low)}${unit}`, to: `${n(high)}${unit}`, ease: `linear(${points.join(", ")})` };
}

/**
 * The animations on one element, built up a track at a time.
 *
 * Longhands rather than the `animation` shorthand: an envelope's easing is a `linear()` with commas
 * inside it, and a shorthand list is itself comma-separated. The two parse, but only just, and a
 * minifier or an engine disagreeing about which comma is which would be a scene that plays every
 * channel at the wrong speed for reasons no one would find.
 */
class Tracks {
  private readonly names: string[] = [];
  private readonly durations: string[] = [];
  private readonly eases: string[] = [];
  private readonly delays: string[] = [];
  private readonly counts: string[] = [];
  private readonly directions: string[] = [];
  private readonly fills: string[] = [];

  add(name: string, durationMs: number, ease: string, delayMs: number, cycle: Cycle): void {
    this.names.push(name);
    this.durations.push(`${n(durationMs)}ms`);
    this.eases.push(ease);
    this.delays.push(`${n(delayMs)}ms`);
    this.counts.push(cycle.count);
    this.directions.push(cycle.direction);
    this.fills.push(cycle.fill);
  }

  writeInto(style: Style): void {
    if (this.names.length === 0) return;

    style.animationName = this.names.join(", ");
    style.animationDuration = this.durations.join(", ");
    style.animationTimingFunction = this.eases.join(", ");
    style.animationDelay = this.delays.join(", ");
    style.animationIterationCount = this.counts.join(", ");
    style.animationDirection = this.directions.join(", ");
    style.animationFillMode = this.fills.join(", ");
  }
}

/**
 * The three channels every travelling actor may carry, put on one element.
 *
 * `translate`, `rotate` and `scale` are independent properties in CSS, which is what lets three
 * envelopes animate at once without any of them nesting an element inside another.
 */
function channels(
  style: Style,
  tracks: Tracks,
  actor: SceneActor,
  cycleMs: number,
  cycle: Cycle,
  scale: Shaped | null,
  rotate: Shaped | null,
): void {
  const fade = shape(actor.opacity, "");

  if (scale !== null) {
    style["--cs-s0"] = scale.from;
    style["--cs-s1"] = scale.to;
    style.scale = scale.from;
    tracks.add("cosmetic-scene-scale", cycleMs, scale.ease, actor.delayMs, cycle);
  }

  if (rotate !== null) {
    style["--cs-r0"] = rotate.from;
    style["--cs-r1"] = rotate.to;
    style.rotate = rotate.from;
    tracks.add("cosmetic-scene-spin", cycleMs, rotate.ease, actor.delayMs, cycle);
  }

  if (fade !== null) {
    style["--cs-o0"] = fade.from;
    style["--cs-o1"] = fade.to;
    style.opacity = fade.from;
    tracks.add("cosmetic-scene-fade", cycleMs, fade.ease, actor.delayMs, cycle);
  }
}

// ── Places ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Where a point is across the stage.
 *
 * The anchor's own base is a per cent of the width and the nudge is a per cent of the width too, so
 * this one is unremarkable. Its twin below is the interesting half.
 */
export function placeX(point: ScenePoint): string {
  const base = ANCHOR_X[point.anchor];

  return point.dxPct === 0 ? w(base) : `calc(${w(base)} + ${w(point.dxPct)})`;
}

/**
 * Where a point is down the stage.
 *
 * <b>The base is in `cqh` and the nudge is in `cqw`, and that is deliberate.</b> An anchor is a place
 * on the card — the top edge, the middle, the bottom edge — and has to follow the card's height
 * wherever the board puts it. A nudge is a distance the author drew against a 384px-wide card, and
 * must not grow by four hundred pixels because somebody else filled their board. Mixing the two units
 * in one `calc` is what keeps both true at once.
 */
export function placeY(point: ScenePoint): string {
  const base = ANCHOR_Y[point.anchor];

  return point.dyPct === 0 ? h(base) : `calc(${h(base)} + ${w(point.dyPct)})`;
}

/** Whether a path runs leftwards, which is the only thing a mirrored figure needs to know. */
function runsLeft(from: ScenePoint, to: ScenePoint): boolean {
  return (ANCHOR_X[to.anchor] + to.dxPct) < (ANCHOR_X[from.anchor] + from.dxPct);
}

/**
 * Which way a bow pushes the path off its own chord.
 *
 * <b>Not a perpendicular, and it cannot be one.</b> An anchor's Y is a per cent of the card's height
 * and its X a per cent of the width, so the chord's angle needs the card's proportions — which are
 * whatever the wearer's bio and board came to and are not known when the scene is drawn. What is
 * available is which way the path mostly runs, and a bow is only visible across that: a figure
 * crossing the card bows up and down, one climbing it bows side to side.
 */
function bowAxisOf(actor: SceneSpriteActor): "x" | "y" {
  if (actor.bowAxis !== "auto") return actor.bowAxis;

  const across = Math.abs((ANCHOR_X[actor.to.anchor] + actor.to.dxPct)
    - (ANCHOR_X[actor.from.anchor] + actor.from.dxPct));
  const along = Math.abs((ANCHOR_Y[actor.to.anchor] + actor.to.dyPct)
    - (ANCHOR_Y[actor.from.anchor] + actor.from.dyPct));

  return across >= along ? "y" : "x";
}

// ── Paint ───────────────────────────────────────────────────────────────────────────────────────

/**
 * One rectangle of the sheet, drawn at the element's own size.
 *
 * <b>Everything is a multiple of the element's width, in `cqw`.</b> The sheet has to be scaled so
 * that one cell covers the element, which is a ratio between the sheet's pixels and the cell's — the
 * `sheet` the row declares, because the browser cannot be asked for a picture's size before it has
 * loaded it and the scene is drawn before that.
 *
 * Offsets are lengths rather than percentages for the reason a frame's strip gives: a percentage
 * background position is a fraction of the room left over, so the same value lands on a different
 * frame for every strip length.
 */
function sheetPaint(
  atlas: SceneAtlas,
  sheet: SceneSheet,
  url: string,
  sizePct: number,
  reduced: boolean,
  tracks: Tracks,
): Style {
  // Container-width units per source pixel.
  const unit = sizePct / atlas.w;

  const style: Style = {
    backgroundImage: `url("${url}")`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${w(sheet.w * unit)} ${w(sheet.h * unit)}`,
    backgroundPositionX: w(-atlas.x * unit),
    backgroundPositionY: w(-atlas.y * unit),
  };

  if (atlas.frames <= 1) return style;

  const rows = atlas.frames / atlas.columns;

  if (reduced) {
    style.backgroundPositionX = w(-(atlas.x + (atlas.still % atlas.columns) * atlas.w) * unit);
    style.backgroundPositionY = w(-(atlas.y + Math.floor(atlas.still / atlas.columns) * atlas.h) * unit);

    return style;
  }

  style["--cs-sheet-x0"] = w(-atlas.x * unit);
  style["--cs-sheet-x1"] = w(-(atlas.x + atlas.columns * atlas.w) * unit);
  style["--cs-sheet-y0"] = w(-atlas.y * unit);
  style["--cs-sheet-y1"] = w(-(atlas.y + rows * atlas.h) * unit);

  // Two tracks, because a strip is read as a grid: the columns cycle inside each row and the rows
  // step once per cycle. The step counts ride on the element because `steps()` will not take one
  // from a custom property, which is the one thing about this that cannot be made general.
  tracks.add("cosmetic-scene-sheet-x", (atlas.columns / atlas.fps) * 1000, `steps(${atlas.columns})`, 0, CYCLES.loop);
  tracks.add("cosmetic-scene-sheet-y", (atlas.frames / atlas.fps) * 1000, `steps(${rows})`, 0, CYCLES.loop);

  return style;
}

// ── Actors ──────────────────────────────────────────────────────────────────────────────────────

/** One actor, ready to mount: the box that moves, and the picture inside it. */
export interface DrawnActor {
  readonly key: string;
  readonly box: Style;
  readonly art: Style;

  /** Set when the art is an `<img>` of a whole file rather than a rectangle of the sheet. */
  readonly img: string | null;
}

/** One picture over the whole stage. */
export function drawWash(
  actor: SceneWashActor,
  sheet: SceneSheet | null,
  url: string,
  reduced: boolean,
): DrawnActor {
  const box: Style = { position: "absolute", inset: "0" };
  const art: Style = { position: "absolute", inset: "0" };
  const tracks = new Tracks();
  const paint = new Tracks();

  // A picture of a whole card has no edge to be swept from, so a row that asks for a linear reveal
  // anyway gets the one a thing standing on the ground would have: up from the bottom.
  applyGrow(box, tracks, actor.grow, actor.delayMs, reduced, "to top", "bottom");

  if (!reduced) {
    // <b>The row's own scale rides the picture, not the box.</b> The box's `scale` is the extension
    // a growing thing is made of, and two animations on one property do not compose — the later one
    // simply replaces the earlier. On the picture the slot is free, and a wash that both grows and
    // breathes gets to do both.
    const breath = shape(actor.scale, "");

    if (breath !== null) {
      art["--cs-s0"] = breath.from;
      art["--cs-s1"] = breath.to;
      art.scale = breath.from;
      paint.add("cosmetic-scene-scale", actor.periodMs, breath.ease, actor.delayMs, CYCLES[actor.repeat]);
    }

    channels(box, tracks, actor, actor.periodMs, CYCLES[actor.repeat], null, null);
  } else if (actor.opacity !== null) {
    // Still, but at a value the author chose rather than at whatever the first keyframe was: the
    // largest stop, because a wash faded to nothing for most of its cycle should not be invisible
    // to somebody who has asked for no movement.
    box.opacity = shape(actor.opacity, "")?.to ?? "1";
  }

  tracks.writeInto(box);
  addFilter(shadowBearer(actor, box, art), shadowOf(actor.shadow));

  if (actor.source === "file" || sheet === null || actor.atlas === null) {
    art.objectFit = actor.fit === "stretch" ? "fill" : actor.fit;
    art.width = "100%";
    art.height = "100%";

    // Anchored to the bottom, the same as the atlas path below and for the same reason. It was
    // missing here only because the two paths were written apart: a tree centred in a card taller
    // than its picture is a tree with its roots in the air, and `contain` on a stretched card is
    // exactly when that happens.
    art.objectPosition = "center bottom";

    paint.writeInto(art);

    return { key: "", box, art, img: url };
  }

  art.backgroundImage = `url("${url}")`;
  art.backgroundRepeat = "no-repeat";

  // Anchored to the bottom rather than centred. Weather does not care which way a crop falls, and
  // anything standing on the ground does: a tree centred in a card shorter than the picture is a
  // tree with its roots cut off and hanging in the air.
  art.backgroundPosition = "center bottom";
  art.backgroundSize = actor.fit === "stretch" ? "100% 100%" : actor.fit;

  paint.writeInto(art);

  return { key: "", box, art, img: null };
}

/**
 * A place, moved by the hang of a spilling actor's box.
 *
 * An anchor names a point of the card. A spilling actor is drawn in a box that reaches past the
 * card, so the card's own origin is the hang in from that box's corner, and every place is offset
 * by it. Nothing is added for the ordinary actor, whose box is the card.
 */
function hung(place: string, by: number): string {
  return by === 0 ? place : `calc(${place} + ${w(by)})`;
}

/** A figure travelling from one point of the card to another. */
export function drawSprite(
  actor: SceneSpriteActor,
  sheet: SceneSheet | null,
  url: string,
  reduced: boolean,
  hang: Hang = NO_HANG,
): DrawnActor {
  const cycle = CYCLES[actor.repeat];
  const tracks = new Tracks();

  const box: Style = {
    position: "absolute",
    left: "0",
    top: "0",
    width: w(actor.sizePct),
    height: actor.atlas === null ? "auto" : w(actor.sizePct * (actor.atlas.h / actor.atlas.w)),
    "--cs-x0": hung(placeX(actor.from), hang.x),
    "--cs-y0": hung(placeY(actor.from), hang.top),
    "--cs-x1": hung(placeX(actor.to), hang.x),
    "--cs-y1": hung(placeY(actor.to), hang.top),

    // The resting place, and the first half of every frame of the travel: the actor's own centre is
    // put on the point, which is what an anchor means here.
    translate: "calc(-50% + var(--cs-x0)) calc(-50% + var(--cs-y0))",
  };

  // <b>A bow belongs in `translate`, with the rest of the path.</b> Hung on `transform` instead —
  // which is where it went first, because `translate` looked taken — it is applied after the box's
  // own `rotate` and `scale`, so a row animating either of those would have its bow quietly turned
  // by one and multiplied by the other. A path is one thing and goes in one property.
  //
  // What that costs: a row's easing applies between each pair of keyframes, so a figure on `inOut`
  // now eases through its own apex as well as through its ends. That is a visible, explainable
  // property of a three-point path, where a bow scaled by an envelope somewhere else is neither.
  const bowed = !reduced && actor.bowPct !== 0;

  if (bowed) {
    const axis = bowAxisOf(actor);
    const bowX = axis === "x" ? ` + ${w(actor.bowPct)}` : "";
    const bowY = axis === "y" ? ` + ${w(actor.bowPct)}` : "";

    box["--cs-xm"] = `calc((${box["--cs-x0"]} + ${box["--cs-x1"]}) / 2${bowX})`;
    box["--cs-ym"] = `calc((${box["--cs-y0"]} + ${box["--cs-y1"]}) / 2${bowY})`;
  }

  if (!reduced) {
    tracks.add(
      bowed ? "cosmetic-scene-arc" : "cosmetic-scene-travel",
      actor.durationMs,
      EASES[actor.ease],
      actor.delayMs,
      cycle,
    );
    channels(box, tracks, actor, actor.durationMs, cycle, shape(actor.scale, ""), shape(actor.rotate, "deg"));
  }

  tracks.writeInto(box);

  const paint = new Tracks();
  const art: Style = actor.source === "file" || sheet === null || actor.atlas === null
    ? { width: "100%", height: "auto", display: "block" }
    : { ...sheetPaint(actor.atlas, sheet, url, actor.sizePct, reduced, paint), position: "absolute", inset: "0" };

  const mirrored = actor.turn === "mirror" && runsLeft(actor.from, actor.to);

  if (mirrored) {
    // A figure drawn facing one way, sent the other. On its own element rather than folded into the
    // box's own `scale`, because the box's scale is an envelope the row may be animating.
    art.transform = "scaleX(-1)";
  }

  if (!reduced) {
    // Leaning into the arc: nose up on the way in, level over the top, nose down coming out. Its
    // sign is flipped for a mirrored figure, because `rotate` is applied before `transform` and the
    // mirror would otherwise turn a climb into a dive.
    if (actor.bankDeg !== 0) {
      art["--cs-bank"] = `${n(mirrored ? -actor.bankDeg : actor.bankDeg)}deg`;
      paint.add("cosmetic-scene-bank", actor.durationMs, "ease-in-out", actor.delayMs, cycle);
    }

    // <b>The beat is the strip's, not a number.</b> A wing that flaps at `fps` over a body rising at
    // some other rate is a puppet; taking the period from the strip means the two cannot come apart,
    // whatever an author does to either afterwards. A figure with no strip has no wingbeat to be in
    // time with, so it gets no bob rather than a guessed one.
    if (actor.bobPct > 0 && actor.atlas !== null && actor.atlas.frames > 1) {
      art["--cs-bob"] = w(actor.bobPct);
      paint.add(
        "cosmetic-scene-bob",
        (actor.atlas.frames / actor.atlas.fps) * 1000,
        "ease-in-out",
        actor.delayMs,
        CYCLES.loop,
      );
    }
  }

  addFilter(shadowBearer(actor, box, art), shadowOf(actor.shadow));
  paint.writeInto(art);

  return { key: "", box, art, img: actor.source === "file" ? url : null };
}

/**
 * Which element carries an actor's shadow: the picture, unless the picture is a file.
 *
 * <b>Chromium does not repaint a self-animating picture behind its own filter.</b> An SVG that
 * draws itself, given a `drop-shadow` on its `<img>`, is painted once at its first frame — empty —
 * and stays that way until something else on the element invalidates it; on the stand the tree
 * appeared only when the veil's retreat began forcing repaints, nine seconds late and finished.
 * One element up the invalidation is ordinary and the picture animates. A rectangle of the sheet
 * keeps its shadow on the picture, where the flutter and the bank turn it with the drawing.
 */
function shadowBearer(actor: SceneWashActor | SceneSpriteActor, box: Style, art: Style): Style {
  return actor.source === "file" ? box : art;
}

/**
 * Uncovering a picture into place, however it is shaped.
 *
 * <b>Two reveals, and the choice between them is the whole character of the thing.</b> A linear wipe
 * arrives in layers, which is what a blind does and what this did at first. A radial one spreads out
 * of a point, and the same picture then reads as something creeping over the card from where it is
 * rooted — because that is what growth is. A vine does not appear in horizontal slices.
 *
 * The radial box is square in card-width units rather than in per cent of the element, so the circle
 * stays a circle on a card of any height; `closest-side` on a square box is its own half-width, and
 * the mask's corner is pinned to the same point the gradient is centred on, so the root does not
 * drift as the circle grows.
 */
function applyGrow(
  box: Style,
  tracks: Tracks,
  grow: SceneGrow | null,
  delayMs: number,
  reduced: boolean,
  wipe: string,
  edgeSpot: string,
): void {
  if (grow === null) return;

  // A root this build does not recognise falls back to the edge wipe rather than being substituted
  // into the gradient: `radial-gradient(circle farthest-corner at undefined, …)` is not a parse
  // error, it is a declaration the browser throws away — and an actor with no mask at all looks
  // exactly like one that has finished growing before it started.
  const spot = grow.from === "edge" ? edgeSpot : ANCHOR_SPOT[grow.from as SceneAnchor];
  const spreads = spot !== undefined && grow.from !== "edge";
  const anchored = spreads ? spot! : edgeSpot;

  // Everything below turns about the place the thing is rooted, and the reveal — when there is
  // one — is centred there too. A rock about a picture's own middle is a picture being waved, not
  // a stem being pushed.
  box.transformOrigin = anchored;

  // <b>Equal ends are a grow with nothing to uncover.</b> A drawing that grows by itself — a file
  // whose branches lengthen on their own clock — still wants the wobble on the way up and the
  // breathing afterwards, and wants no mask at all: a mask is a compositing layer on every card
  // that draws the scene, and one that uncovers nothing paints nothing for that price.
  const reveals = grow.fromPct < grow.toPct;

  if (reveals) applyReveal(box, grow, spreads, spot, wipe, anchored, reduced);

  if (reduced) return;

  // The hold is bought with the cycle rather than with a second animation: the whole reveal is
  // squeezed into its share of a longer one, and the rest of that cycle is the picture standing
  // finished. A pause is not something a keyframe can express any other way.
  const whole = grow.durationMs + grow.holdMs;
  const share = grow.durationMs / whole;
  const ease = share >= 1 ? "linear" : `linear(0 0%, 1 ${n(share * 100)}%, 1 100%)`;

  if (reveals) tracks.add("cosmetic-scene-grow", whole, ease, delayMs, CYCLES[grow.repeat]);

  // <b>The reveal is not the growth, and this is the line between them.</b> Uncovering shows a
  // picture that was always its finished size — half a reveal of a tree is the lower half of a
  // grown one, where half a life of a tree is a small whole tree. The extension supplies the second
  // reading, and the mask above is then only what keeps the tip from arriving before the wood has
  // reached it. A row may still ask for a bare reveal, by starting the extension at its full size.
  if (grow.fromScale < 1) {
    box["--cs-e0x"] = n(grow.fromScale * lagOf(grow, "x"));
    box["--cs-e0y"] = n(grow.fromScale * lagOf(grow, "y"));
    box.scale = `${box["--cs-e0x"]} ${box["--cs-e0y"]}`;

    tracks.add("cosmetic-scene-extend", whole, extendEase(share), delayMs, CYCLES[grow.repeat]);
  }

  // The decay is in the rule's own stops, so the timing function here only has to hand it the same
  // share of the cycle the reveal and the extension get.
  if (grow.wobbleDeg > 0) {
    box["--cs-wob"] = `${n(grow.wobbleDeg)}deg`;
    tracks.add("cosmetic-scene-wobble", whole, ease, delayMs, CYCLES[grow.repeat]);
  }

  // <b>The one channel that is not about arriving.</b> Everything else here finishes; this is what
  // the thing does for the rest of its life. A tree that has grown and then holds perfectly still is
  // a photograph of a tree, and no amount of care spent on how it arrived survives that.
  //
  // It rides `transform` while the wobble rides `rotate`, so the two compose instead of replacing
  // each other and neither has to wait for the other to be over.
  if (grow.sway !== null) {
    box["--cs-sway-deg"] = `${n(grow.sway.deg)}deg`;
    tracks.add(
      "cosmetic-scene-breathe",
      grow.sway.ms,
      "ease-in-out",
      delayMs + grow.durationMs,
      CYCLES.loop,
    );
  }
}

/**
 * How far behind the leading axis a growing thing's other axis starts.
 *
 * A shoot reaches before it thickens. Both axes finish together on one easing, so starting the
 * lagging one smaller is the whole of the lag — it has further to travel in the same time.
 */
function lagOf(grow: SceneGrow, axis: "x" | "y"): number {
  return grow.leadAxis === "both" || grow.leadAxis === axis ? 1 : LEAD_LAG;
}

/**
 * The mask that uncovers a growing thing, and the two sizes it travels between.
 *
 * `farthest-corner`, and never `closest-side`. The gradient's centre is pinned to a corner of its
 * own box for every corner anchor, and the side closest to a corner is the one it is standing on —
 * so `closest-side` resolves to a radius of zero, the mask hides everything, for ever, and nothing
 * reports it. `farthest-corner` is also what makes the calibration on `RADIAL_FULL` exact.
 *
 * `mask-image` takes an image and nothing else. A `no-repeat` tacked on the end does not make the
 * mask repeat once — it makes the whole declaration invalid, the element is not masked at all, and
 * the result looks exactly like a picture that is simply always finished. It shipped that way once.
 */
function applyReveal(
  box: Style,
  grow: SceneGrow,
  spreads: boolean,
  spot: string | undefined,
  wipe: string,
  anchored: string,
  reduced: boolean,
): void {
  // How far out the mask stays solid before it gives way. A hard edge is a ring travelling over the
  // picture, and the eye tracks a moving edge far more readily than it tracks the thing arriving
  // behind it — which is why a sharp reveal reads as a shutter whatever is drawn underneath it.
  const solid = n(100 - grow.softness * 50);

  // A hard reveal is written without the stop it would not use. Not tidiness: `#000 0 100%,
  // transparent 100%` and `#000 0 100%` paint the same thing, and one of them says what was meant.
  const fades = grow.softness > 0 ? `, transparent 100%` : "";

  const mask = spreads
    ? `radial-gradient(circle farthest-corner at ${spot}, #000 0 ${solid}%${fades})`
    : `linear-gradient(${wipe}, #000 0 ${solid}%${fades})`;

  // The lagging axis starts narrower and both axes finish together, so the reveal opens tall and
  // fills out afterwards rather than opening as a circle. A ring expanding evenly is an iris wipe,
  // which is the reading this whole function exists to get away from.
  const size = (pct: number, biased: boolean): string => {
    if (spreads) {
      const reach = (pct / 100) * RADIAL_FULL;

      return biased
        ? `${n(reach * lagOf(grow, "x"))}% ${n(reach * lagOf(grow, "y"))}%`
        : `${n(reach)}% ${n(reach)}%`;
    }

    return wipe === "to top" || wipe === "to bottom" ? `100% ${n(pct)}%` : `${n(pct)}% 100%`;
  };

  const start = size(grow.fromPct, true);
  const end = size(grow.toPct, false);

  box.maskImage = mask;
  box.WebkitMaskImage = mask;

  // Without this the gradient tiles to fill whatever `mask-size` leaves over, so a picture uncovered
  // to a tenth is ten stripes of it rather than a tenth of one.
  box.maskRepeat = "no-repeat";
  box.WebkitMaskRepeat = "no-repeat";

  // The mask's corner is pinned to the same point the gradient is centred on, so the root does not
  // drift as the circle grows; an edge wipe is pinned to the edge it comes from.
  box.maskPosition = anchored;
  box.WebkitMaskPosition = anchored;

  box["--cs-g0"] = start;
  box["--cs-g1"] = end;
  box.maskSize = reduced ? end : start;
  box.WebkitMaskSize = box.maskSize;
}

/**
 * A nine-slice that goes round the whole card.
 *
 * Four widths rather than one thickness and an edge, and which of them are not zero is the shape.
 * The middle of the nine is never drawn — that is the card, and a wrap that filled it would be a
 * wash with extra steps.
 */
export function drawWrap(actor: SceneWrapActor, url: string, reduced: boolean): DrawnActor {
  const outset = w(-actor.outsetPct);

  const box: Style = {
    position: "absolute",
    top: outset,
    right: outset,
    bottom: outset,
    left: outset,
  };

  const widths = actor.widthPct.map(side => w(side)).join(" ");

  const art: Style = {
    position: "absolute",
    inset: "0",
    boxSizing: "border-box",
    borderStyle: "solid",
    borderColor: "transparent",
    borderWidth: widths,
    borderImageSource: `url("${url}")`,
    borderImageSlice: actor.slice.join(" "),
    borderImageWidth: widths,
    borderImageRepeat: actor.tile,
  };

  const tracks = new Tracks();

  // A wrap has no one edge, so a linear wipe has no direction to come from. `bottom` is what a
  // row that asked for one anyway gets, and it is the direction a thing rooted in the ground grows.
  applyGrow(box, tracks, actor.grow, actor.delayMs, reduced, "to top", "bottom");

  if (!reduced) {
    const fade = shape(actor.opacity, "");

    if (fade !== null) {
      box["--cs-o0"] = fade.from;
      box["--cs-o1"] = fade.to;
      box.opacity = fade.from;
      tracks.add("cosmetic-scene-fade", actor.grow?.durationMs ?? 4000, fade.ease, actor.delayMs, CYCLES.loop);
    }
  }

  tracks.writeInto(box);
  addFilter(art, shadowOf(actor.shadow));

  return { key: "", box, art, img: null };
}

/** A nine-slice band lying along one edge of the stage. */
export function drawBand(actor: SceneBandActor, url: string, reduced: boolean): DrawnActor {
  const across = actor.edge === "top" || actor.edge === "bottom";
  const thickness = w(actor.thicknessPct);
  const outset = w(-actor.outsetPct);

  const box: Style = across
    ? { position: "absolute", left: "0", right: "0", height: thickness, [actor.edge]: outset }
    : { position: "absolute", top: "0", bottom: "0", width: thickness, [actor.edge]: outset };

  const corner = w(actor.cornerPct);

  // A band along one edge is a nine-slice with two of its four widths at zero and the middle drawn:
  // the two ends come out at their own size and everything between them is the middle, tiled. The
  // property that decides this is `border-image-width` and not `border-width` — setting only the
  // second leaves the picture drawn on all four sides — and `border-style` has to be set at all for
  // any of it to appear, even at a width of zero and in a colour nobody will ever see.
  const widths = across ? `0 ${corner} 0 ${corner}` : `${corner} 0 ${corner} 0`;

  const art: Style = {
    position: "absolute",
    inset: "0",
    boxSizing: "border-box",
    borderStyle: "solid",
    borderColor: "transparent",
    borderWidth: widths,
    borderImageSource: `url("${url}")`,
    borderImageSlice: `${actor.slice.join(" ")} fill`,
    borderImageWidth: widths,
    borderImageRepeat: actor.tile,
  };

  const tracks = new Tracks();

  applyGrow(box, tracks, actor.grow, actor.delayMs, reduced, across
    ? (actor.edge === "bottom" ? "to top" : "to bottom")
    : (actor.edge === "right" ? "to left" : "to right"),
    across ? (actor.edge === "bottom" ? "bottom" : "top") : (actor.edge === "right" ? "right" : "left"));

  if (!reduced) {
    const fade = shape(actor.opacity, "");

    if (fade !== null) {
      box["--cs-o0"] = fade.from;
      box["--cs-o1"] = fade.to;
      box.opacity = fade.from;
      tracks.add("cosmetic-scene-fade", actor.grow?.durationMs ?? 4000, fade.ease, actor.delayMs, CYCLES.loop);
    }
  }

  tracks.writeInto(box);
  addFilter(art, shadowOf(actor.shadow));

  return { key: "", box, art, img: null };
}

/**
 * The scatter, worked out the same way every time.
 *
 * <b>Deterministic on purpose.</b> Everybody looking at a profile sees the same flakes in the same
 * places, the console's preview matches the card, and a test can assert a position. `Math.random()`
 * costs all three and buys nothing a seed does not.
 *
 * xorshift32 rather than anything stronger: this is a few dozen numbers per scene, and the only
 * property that matters is that consecutive draws do not look related.
 */
export function scatter(seed: number): () => number {
  let state = (seed | 0) || 0x9e3779b9;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    return ((state >>> 0) % 100_000) / 100_000;
  };
}

/**
 * Many copies of one drawing, falling from an edge.
 *
 * <b>Every copy takes exactly five draws, in this order, and the order is part of the data.</b>
 * Changing it reshuffles every scatter in every scene anybody has ever authored, which would look
 * like a rendering bug and is not one.
 *
 * <b>The phase runs backwards for a scatter that loops and forwards for one that ends</b>, and the
 * difference is the whole of it. A looping scatter has to look as though it has been falling since
 * before you opened the card, so every copy starts part-way through its own cycle — a negative
 * delay. A scatter that plays once has to look as though it started when you arrived, so the same
 * number staggers them forwards instead: they set off one after another and come to rest. A negative
 * delay there would freeze half of them at their end state before the first frame.
 */
export function drawEmitter(
  actor: SceneEmitterActor,
  sheet: SceneSheet | null,
  url: string,
  reduced: boolean,
): DrawnActor[] {
  if (reduced || actor.atlas === null || sheet === null) return [];

  const next = scatter(actor.seed);
  const drawn: DrawnActor[] = [];
  const fade = shape(actor.opacity, "");
  const down = actor.edge === "top" || actor.edge === "bottom";
  const cycle = CYCLES[actor.repeat];
  const ending = actor.repeat === "once";

  const spread = actor.depthSpreadPct / 100;

  for (let copy = 0; copy < actor.count; copy++) {
    const along = next();

    // Kept rather than folded straight into the size, because the same draw is what stands for the
    // copy's distance below. Taking a second draw for that would let a copy be large, slow and faint
    // at once, which is three different distances at the same time.
    const sizeSwing = next() * 2 - 1;
    const spanMs = actor.durationMs + (next() * 2 - 1) * actor.durationVarMs;
    const phase = next();
    const drift = (next() * 2 - 1) * actor.driftPct;

    // Appended after the five the scatter has always drawn, and never inserted among them: the order
    // is data, and a copy's place, size, span, phase and drift have to come out of a given seed today
    // exactly as they did before this existed.
    const periodSwing = next() * 2 - 1;
    const axisSwing = next();
    const spinSwing = next();

    // How near this copy is, from nothing to the front of the flight. Size, speed and weight all
    // read off it, so they cannot disagree.
    const nearness = (sizeSwing + 1) / 2;
    const size = (actor.sizePct + sizeSwing * actor.sizeVarPct)
      * (1 + spread * DEPTH_SIZE * (nearness * 2 - 1));
    const durationMs = Math.max(1, spanMs * (1 - spread * DEPTH_SPEED * (nearness * 2 - 1)));

    const height = size * (actor.atlas.h / actor.atlas.w);

    // Clear of the edge it comes from and clear of the one it leaves by, so nothing pops into or out
    // of existence against the card's own border.
    const lead = down ? height : size;
    const near = actor.edge === "top" || actor.edge === "left";

    const box: Style = {
      position: "absolute",
      left: "0",
      top: "0",
      width: w(size),
      height: w(height),
      translate: "calc(-50% + var(--cs-x0)) calc(-50% + var(--cs-y0))",
    };

    if (down) {
      box["--cs-x0"] = w(along * 100);
      box["--cs-x1"] = w(along * 100 + drift);
      box["--cs-y0"] = near ? w(-lead) : `calc(100cqh + ${w(lead)})`;
      box["--cs-y1"] = near ? `calc(100cqh + ${w(lead)})` : w(-lead);
    } else {
      box["--cs-y0"] = h(along * 100);
      box["--cs-y1"] = `calc(${h(along * 100)} + ${w(drift)})`;
      box["--cs-x0"] = near ? w(-lead) : `calc(100cqw + ${w(lead)})`;
      box["--cs-x1"] = near ? `calc(100cqw + ${w(lead)})` : w(-lead);
    }

    const tracks = new Tracks();
    const offset = ending ? actor.delayMs + phase * durationMs : actor.delayMs - phase * durationMs;

    tracks.add("cosmetic-scene-travel", durationMs, FALL_EASE, offset, cycle);

    if (actor.spinDeg > 0) {
      box["--cs-r0"] = "0deg";

      // Which way it turns is drawn per copy. A scatter all turning the same way is a rack of
      // things being cranked, and it is the second thing the eye picks up after a shared period.
      box["--cs-r1"] = `${n(spinSwing < 0.5 ? -actor.spinDeg : actor.spinDeg)}deg`;
      tracks.add("cosmetic-scene-spin", durationMs, "linear", offset, cycle);
    }

    if (fade !== null) {
      box["--cs-o0"] = fade.from;
      box["--cs-o1"] = fade.to;
      box.opacity = fade.from;
      tracks.add("cosmetic-scene-fade", durationMs, fade.ease, offset, cycle);
    }

    tracks.writeInto(box);

    const paint = new Tracks();
    const art: Style = {
      ...sheetPaint(actor.atlas, sheet, url, size, false, paint),
      position: "absolute",
      inset: "0",
    };

    // <b>Its own period, and that is the whole of why a scatter stops looking like machinery.</b>
    // Forty-eight copies swinging on one number is forty-eight things agreeing, which the eye reads
    // in about a second and reads as a loop.
    const swayMs = Math.max(1, actor.swayPeriodMs + periodSwing * actor.swayVarMs);

    if (actor.swayPct > 0 || actor.bobPct > 0) {
      // The swing keeps looping even when the fall does not: it is what the copy is doing, not where
      // it is going, and the fill on a finished travel holds the copy where it landed regardless.
      art["--cs-swing"] = w(actor.swayPct);
      art["--cs-dip"] = w(actor.bobPct);
      paint.add("cosmetic-scene-flutter", swayMs, "ease-in-out", -phase * swayMs, CYCLES.loop);
    }

    // <b>This is the channel that makes a falling thing an object.</b> Something coming down through
    // air is fastest sideways exactly when it is edge-on and stalls when it is flat, so the pitch is
    // a quarter-cycle ahead of the swing above and shares its clock — and the copy foreshortens to a
    // sliver twice a cycle, which is a thing no amount of drawing on a flat sprite can imitate.
    //
    // The perspective is a function inside the transform rather than a property on an ancestor: a
    // veil that cuts the avatar out of an actor carries a mask, and a mask forces `preserve-3d` to
    // flatten, so an inherited perspective would reach some copies and not others.
    if (actor.flutterDeg > 0) {
      const tilt = (axisSwing * 2 - 1) * TILT_SPREAD;

      art["--cs-eye"] = w(size * EYE_DISTANCE);
      art["--cs-ax"] = n(Math.cos(tilt));
      art["--cs-ay"] = n(Math.sin(tilt));
      art["--cs-pitch"] = `${n(actor.flutterDeg)}deg`;
      paint.add("cosmetic-scene-pitch", swayMs, "ease-in-out", -phase * swayMs, CYCLES.loop);
    }

    // Distance told as weight. A copy further off has more air between it and the viewer, and this
    // is the one part of that which is free — it multiplies with whatever the row's own fade is
    // doing on the box above rather than fighting it for the property.
    if (spread > 0) art.opacity = n(1 - spread * DEPTH_FADE * (1 - nearness));

    paint.writeInto(art);

    drawn.push({ key: `${copy}`, box, art, img: null });
  }

  return drawn;
}

// ── The rules ───────────────────────────────────────────────────────────────────────────────────

/**
 * The rules every scene animates with, put on the page once.
 *
 * <b>Fixed text, not a generator.</b> There is not one number here that comes from a catalogue row —
 * every amount arrives as a custom property these read, and every curve as an easing function on the
 * element. A row carrying keyframes would be CSS arriving from a database onto everybody who opens a
 * profile, which is the line every payload in this system draws.
 *
 * Here rather than in the component's stylesheet because the rules that name these animations are
 * inline styles, and an inline style cannot see a scoped one.
 */
const RULES = `
@keyframes cosmetic-scene-travel {
  from { translate: calc(-50% + var(--cs-x0)) calc(-50% + var(--cs-y0)); }
  to   { translate: calc(-50% + var(--cs-x1)) calc(-50% + var(--cs-y1)); }
}

@keyframes cosmetic-scene-scale {
  from { scale: var(--cs-s0); }
  to   { scale: var(--cs-s1); }
}

@keyframes cosmetic-scene-spin {
  from { rotate: var(--cs-r0); }
  to   { rotate: var(--cs-r1); }
}

@keyframes cosmetic-scene-fade {
  from { opacity: var(--cs-o0); }
  to   { opacity: var(--cs-o1); }
}

@keyframes cosmetic-scene-grow {
  from { mask-size: var(--cs-g0); -webkit-mask-size: var(--cs-g0); }
  to   { mask-size: var(--cs-g1); -webkit-mask-size: var(--cs-g1); }
}

/*
 * How far an actor has withdrawn from the card's reading zone, as a number the browser can
 * interpolate. A gradient cannot be animated, but a registered property inside one can, and the
 * veil's mask recomputes from it on every frame of the retreat. Not inherited: the veil is the one
 * thing that reads it, and an actor's own box must not.
 */
@property --cs-yield {
  syntax: "<number>";
  inherits: false;
  initial-value: 0;
}

@keyframes cosmetic-scene-retreat {
  from { --cs-yield: 0; }
  to   { --cs-yield: 1; }
}

/*
 * A thing coming down through air, and the one rule here worth reading twice.
 *
 * It is fastest sideways when it is edge-on and it stalls when it is flat, so the extremes of the
 * swing are where it is slowest and the middle is where it slips. The extra drop therefore comes
 * twice a cycle — once at each crossing — which is why 25% and 75% are the same stop and 0% and 50%
 * are opposites. Pair it with the pitch below, on the same clock, and the two halves of one motion
 * are back together.
 */
@keyframes cosmetic-scene-flutter {
  0%   { translate: calc(-1 * var(--cs-swing)) 0; }
  25%  { translate: 0 var(--cs-dip); }
  50%  { translate: var(--cs-swing) 0; }
  75%  { translate: 0 var(--cs-dip); }
  100% { translate: calc(-1 * var(--cs-swing)) 0; }
}

/*
 * The other half of the same motion: pitch in step with sideways speed, so the copy turns its edge
 * to the way it is going. The axis is per copy, which is what turns a rocking shutter into a tumble
 * without a channel of its own, and the perspective is inside the transform because an ancestor's
 * would not survive the mask on an occluding veil.
 */
@keyframes cosmetic-scene-pitch {
  0%   { transform: perspective(var(--cs-eye)) rotate3d(var(--cs-ax), var(--cs-ay), 0, 0deg); }
  25%  { transform: perspective(var(--cs-eye)) rotate3d(var(--cs-ax), var(--cs-ay), 0, var(--cs-pitch)); }
  50%  { transform: perspective(var(--cs-eye)) rotate3d(var(--cs-ax), var(--cs-ay), 0, 0deg); }
  75%  { transform: perspective(var(--cs-eye)) rotate3d(var(--cs-ax), var(--cs-ay), 0, calc(-1 * var(--cs-pitch))); }
  100% { transform: perspective(var(--cs-eye)) rotate3d(var(--cs-ax), var(--cs-ay), 0, 0deg); }
}

/* Extending from the root it is anchored at. The lagging axis starts smaller and they finish
   together, so one reaches while the other is still filling out. */
@keyframes cosmetic-scene-extend {
  from { scale: var(--cs-e0x) var(--cs-e0y); }
  to   { scale: 1 1; }
}

/* The rock of something pushing itself up, dying away as it gets where it is going. The decay is
   fixed here and only the amplitude comes off the row — a rock that did not decay would be a thing
   being shaken rather than a thing arriving. */
@keyframes cosmetic-scene-wobble {
  0%   { rotate: var(--cs-wob); }
  26%  { rotate: calc(var(--cs-wob) * -0.62); }
  52%  { rotate: calc(var(--cs-wob) * 0.34); }
  74%  { rotate: calc(var(--cs-wob) * -0.16); }
  88%  { rotate: calc(var(--cs-wob) * 0.06); }
  100% { rotate: 0deg; }
}

/* What it does for the rest of its life. Not a metronome: the two halves are not mirror images, so
   it does not settle into a beat the eye can count. */
@keyframes cosmetic-scene-breathe {
  0%   { transform: rotate(calc(-1 * var(--cs-sway-deg))); }
  27%  { transform: rotate(calc(var(--cs-sway-deg) * 0.35)); }
  50%  { transform: rotate(var(--cs-sway-deg)); }
  73%  { transform: rotate(calc(var(--cs-sway-deg) * -0.3)); }
  100% { transform: rotate(calc(-1 * var(--cs-sway-deg))); }
}

/* The same path with a third point in the middle of it, pushed off the chord. A separate rule rather
   than a stop added to the travel above, because a scatter sets no midpoint — and a keyframe reading
   a custom property nobody set is not a straight line, it is a stop the browser throws away. */
@keyframes cosmetic-scene-arc {
  0%   { translate: calc(-50% + var(--cs-x0)) calc(-50% + var(--cs-y0)); }
  50%  { translate: calc(-50% + var(--cs-xm)) calc(-50% + var(--cs-ym)); }
  100% { translate: calc(-50% + var(--cs-x1)) calc(-50% + var(--cs-y1)); }
}

/* Leaning into the bow: nose up going in, level over the top, nose down coming out. */
@keyframes cosmetic-scene-bank {
  0%   { rotate: var(--cs-bank); }
  50%  { rotate: 0deg; }
  100% { rotate: calc(-1 * var(--cs-bank)); }
}

/* Rising and falling on its own wingbeat, at the strip's period rather than at a number. */
@keyframes cosmetic-scene-bob {
  0%, 100% { translate: 0 var(--cs-bob); }
  50%      { translate: 0 calc(-1 * var(--cs-bob)); }
}

@keyframes cosmetic-scene-sheet-x {
  from { background-position-x: var(--cs-sheet-x0); }
  to   { background-position-x: var(--cs-sheet-x1); }
}

@keyframes cosmetic-scene-sheet-y {
  from { background-position-y: var(--cs-sheet-y0); }
  to   { background-position-y: var(--cs-sheet-y1); }
}
`;

let installed = false;

export function installSceneKeyframes(): void {
  if (installed || typeof document === "undefined") return;

  installed = true;

  const style = document.createElement("style");

  style.dataset.cosmeticProfileScene = "";
  style.textContent = RULES;
  document.head.appendChild(style);
}

/** For tests, which need each case to start from nothing. */
export function resetSceneKeyframes(): void {
  installed = false;
}

/** The rules themselves, so a test can assert what a scene animates with without a document. */
export const SCENE_RULES = RULES;

// ── Replaying a file ────────────────────────────────────────────────────────────────────────────

let replays = 0;

/**
 * A number no other showing of a scene in this page has had.
 *
 * Taken once per mounting of a stage, so every `<img>` that stage draws with `replay` is asked for
 * under a URL of its own — and the same URL for as long as that stage lives, because a picture
 * re-requested on every render would start over on every render.
 */
export function nextReplay(): number {
  replays += 1;

  return replays;
}

/**
 * A file's URL, marked so that this showing gets a picture and a clock of its own.
 *
 * <b>A query and not a fragment.</b> Browsers key a decoded image on its URL with the fragment
 * removed, so two `<img>` differing only after the `#` share one picture and one animation — which
 * is exactly the sharing this exists to break. A query is part of the key. It costs a request per
 * showing, which is why only a row that asks for it pays.
 *
 * A blob or a data URL is left alone: neither carries a query anywhere it would survive, and both
 * come from a preview page that made the URL a moment ago and shares nothing.
 */
export function replayUrl(url: string, nonce: number): string {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;

  return `${url}${url.includes("?") ? "&" : "?"}replay=${nonce}`;
}

export type { SceneEdge };
