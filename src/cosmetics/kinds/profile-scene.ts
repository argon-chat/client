import { defineCosmeticKind } from "@/cosmetics/types";
import SceneTuning from "@/cosmetics/tuning/SceneTuning.vue";

/**
 * Things moving across somebody's whole profile card.
 *
 * <b>Not a richer profile effect.</b> An effect is one picture laid on a card, and there is no
 * number you can add to one picture that makes it two things travelling different paths at different
 * depths — which is what every scene worth having turns out to be.
 *
 * <b>The card's height is not a number this payload may contain.</b> It is whatever the wearer's
 * bio, roles and board come to, and a board can add sixteen rows of it. So every size here is a per
 * cent of the card's <i>width</i>, and everything that has to stay put is pinned to an edge; the
 * card publishes where its own parts are and the scene reads that (see `useCardMap`).
 *
 * <b>Depth is per actor, not per kind.</b> Whether something passes in front of a worn frame's
 * thorns or behind the card's glass is a property of that thing — a snowman rolling over the card
 * with flakes falling behind it is one scene and two answers, and a layer on the kind could only
 * ever give one.
 */

export type SceneReach = "content" | "card";
export type SceneDepth = "deep" | "over" | "front";
export type SceneSource = "atlas" | "file";
export type SceneFit = "cover" | "contain" | "stretch";
export type SceneRepeat = "loop" | "once" | "pingPong";
export type SceneEase = "linear" | "in" | "out" | "inOut";
export type SceneEdge = "top" | "right" | "bottom" | "left";
export type SceneTurn = "none" | "mirror";
export type SceneTile = "stretch" | "repeat" | "round" | "space";
export type SceneOcclusion = "avatar";

/**
 * Which way a bowed path is pushed off its own chord.
 *
 * <b>A true perpendicular is not available here.</b> An anchor's Y is in per cent of the card's
 * height and its X in per cent of the width, so the angle of a chord needs the card's proportions —
 * a number that is whatever the wearer's bio and board came to, and is not known when the scene is
 * drawn. `auto` therefore picks the axis with the smaller anchor travel, which is the one a bow is
 * visible on, and the other two are there for an author who disagrees.
 */
export type SceneBowAxis = "auto" | "x" | "y";

/** Which way a growing thing extends first. A tree leads upward; a vine along a band leads across. */
export type SceneLeadAxis = "y" | "x" | "both";

export type SceneAnchor =
  | "topLeft" | "top" | "topRight"
  | "left" | "center" | "right"
  | "bottomLeft" | "bottom" | "bottomRight";

/**
 * One stop of an envelope: where along the actor's own cycle, and what the channel is worth there.
 *
 * An envelope is a shape, not a track. It says how one number moves between its own smallest and
 * largest value over a cycle — nothing here names a property, a unit or a duration, because those
 * belong to whichever channel it was attached to.
 */
export interface SceneStop {
  readonly at: number;
  readonly v: number;
}

/**
 * A rectangle of the scene's sheet, and how to walk it when it is a strip.
 *
 * <b>One file per scene rather than one per actor.</b> Asset slots are a closed set of six shared by
 * every kind in the catalogue, and a busy scene wants five different drawings. So the drawings are
 * rectangles of one picture — which is also one request instead of five, and one entry in the local
 * pack instead of five.
 */
export interface SceneAtlas {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;

  /** One is an ordinary picture; more is a strip walked at `fps`. */
  readonly frames: number;

  readonly columns: number;
  readonly fps: number;

  /**
   * The frame to stand on when movement is off.
   *
   * Named rather than assumed to be the first, for the same reason a frame's sprite names it: a
   * strip's first frame is usually mid-stride, and under a reduced-motion preference that one frame
   * is the whole cosmetic.
   */
  readonly still: number;
}

/**
 * The pixel size of the sheet in `Primary`, which every atlas rectangle is cut out of.
 *
 * <b>Declared rather than measured, because the thing that needs it is CSS.</b> Cutting one
 * rectangle out of a sheet is a background size and a background offset, and both are ratios between
 * the sheet and the cell — a number the browser cannot be asked for until it has loaded the picture,
 * and the scene is drawn before that. The same reason a nine-slice's `slice` is in the source's own
 * pixels rather than in fractions.
 */
export interface SceneSheet {
  readonly w: number;
  readonly h: number;
}

/**
 * A place on the stage: a point of the card, plus a nudge in per cent of its width.
 *
 * The anchor is where the actor's <i>centre</i> goes.
 */
export interface ScenePoint {
  readonly anchor: SceneAnchor;
  readonly dxPct: number;
  readonly dyPct: number;
}

/**
 * How a picture is revealed into place.
 *
 * A reveal rather than a scale, and that is the whole difference between something growing and
 * something inflating.
 *
 * <b>`from` is the difference between a shutter and a thing that is alive.</b> Swept in from the
 * side it lies on, a picture arrives in layers, which is what a blind does — and it was the first
 * thing tried here and looked exactly like one. Spread out of a point, the same picture reads as
 * something creeping over the card from where it is rooted, because that is what growth is: it
 * radiates from one place and takes the rest afterwards.
 */
export interface SceneGrow {
  readonly fromPct: number;
  readonly toPct: number;
  readonly durationMs: number;
  readonly holdMs: number;
  readonly repeat: SceneRepeat;

  /** `edge` sweeps in from the edge the actor lies on; an anchor spreads out of that point. */
  readonly from: "edge" | SceneAnchor;

  /**
   * How small the thing is when it starts, as a fraction of its finished size.
   *
   * <b>This is the difference between growing and being uncovered.</b> A reveal alone shows a
   * picture that is already full size — a tree at half a reveal is the bottom half of an adult tree,
   * where a sapling at half its life is a small whole tree. The extension is what supplies the
   * second reading, and the reveal then only keeps the tip from arriving before the wood does.
   *
   * It defaults to growth rather than to a wipe, because a `grow` that does not grow is the thing
   * this field exists to stop. `1` asks for the old behaviour back and is a legal answer: a banner
   * unrolling is a reveal and should not spring.
   */
  readonly fromScale: number;

  /** Which axis extends first. The lead is a ratio fixed in code; this only says which way it runs. */
  readonly leadAxis: SceneLeadAxis;

  /** A decaying rock about the root while it extends. Nothing pushing out of the ground is rigid. */
  readonly wobbleDeg: number;

  /** How soft the reveal's edge is. Zero is the hard ring that reads as an iris wipe. */
  readonly softness: number;

  /**
   * What it does for the rest of its life, once it has finished growing.
   *
   * <b>The cheapest biology in the kind, and the most missed when it is absent.</b> A tree that
   * finishes growing and then holds perfectly still is a photograph of a tree. This rocks it about
   * the same root it grew from, for ever, at an amplitude small enough that nobody looks at it
   * directly.
   */
  readonly sway: SceneSway | null;
}

/** A permanent, small rock about a root: how far, and how long one there-and-back takes. */
export interface SceneSway {
  readonly deg: number;
  readonly ms: number;
}

/**
 * Getting out from under the words.
 *
 * <b>The answer to a scene that has to cover the whole card and still leave a profile behind.</b>
 * After `atMs`, over `durationMs`, the actor withdraws from the card's reading zone — everything
 * below the glass line and inside the strips — and holds there. What is above the glass line, in
 * the strips along the sides and the bottom, and past the card's edge stays. A tree grows over the
 * name, the bio and the roles, and then steps back to the edges it came from.
 *
 * It plays once. A retreat that came back would be a curtain, and a curtain is what the whole scene
 * kind exists to not be.
 */
export interface SceneRetreat {
  readonly atMs: number;
  readonly durationMs: number;

  /** The strip along each side it keeps, in per cent of the card's width. */
  readonly edgePct: number;

  /** The strip along the stage's bottom edge it keeps, in per cent of the card's width. */
  readonly footPct: number;

  /** How soft the strips' edges are, in per cent of the card's width. */
  readonly softPct: number;

  /** How much of it stays over the reading zone. Zero is gone. */
  readonly remain: number;
}

/**
 * A shadow cast by the actor's own shape.
 *
 * <b>`drop-shadow` rather than a box shadow</b>, because it follows the alpha channel: a tree throws
 * a tree-shaped shadow, and a rectangle would announce that the tree is a picture of one. It is
 * opt-in rather than always-on because a filter on a card-sized picture is not free, and most actors
 * are travelling through the air where nothing would catch a shadow anyway.
 */
export interface SceneShadow {
  readonly dxPct: number;
  readonly dyPct: number;
  readonly blurPct: number;
  readonly alpha: number;
}

interface SceneActorCommon {
  readonly slot: string;
  readonly source: SceneSource;

  /** Null only for `source: "file"`, which draws the slot's whole picture. */
  readonly atlas: SceneAtlas | null;

  readonly depth: SceneDepth;

  /** Parts of the card that hide this actor. Empty for almost everything. */
  readonly occlude: readonly SceneOcclusion[];

  readonly delayMs: number;
  readonly opacity: readonly SceneStop[] | null;

  /** A shadow of the actor's own shape, or null for the ordinary case of something in mid-air. */
  readonly shadow: SceneShadow | null;

  /**
   * How this actor's own cycle repeats.
   *
   * <b>`once` is what makes a scene that ends.</b> A card somebody opens can play a thing through
   * and then simply be decorated — the branch has finished growing, the petals have come to rest —
   * which is a different sort of cosmetic from weather, and weather is the only sort a looping actor
   * can be. It is per actor rather than per scene because the two mix: petals that settle, over a
   * sky that keeps moving.
   *
   * A band has none, because its own is inside `grow`, where the hold lives with it.
   */
  readonly repeat: SceneRepeat;

  /**
   * Whether a self-animating file starts over each time the card is shown.
   *
   * <b>Browsers give every `<img>` of one URL the same decoded picture and the same clock.</b> A
   * file that draws itself growing plays once, for the first card that showed it; the second card
   * opens on a finished drawing. Asking for the file under a fresh query per showing gives each its
   * own — at the price of a request per opening, which is why it is asked for and not assumed.
   *
   * Only a file has a clock of its own, so this is false for anything reading the sheet.
   */
  readonly replay: boolean;
}

/**
 * One picture over the whole stage — weather, a moon, a tree.
 *
 * It carries a `grow` for the same reason a band does, and the reason is a tree: being revealed into
 * place is orthogonal to what shape a thing is. A tree is one picture of a whole card that has to
 * come up out of its own root, and no arrangement of edge-shaped actors is that.
 */
export interface SceneWashActor extends SceneActorCommon {
  readonly type: "wash";
  readonly fit: SceneFit;
  readonly periodMs: number;
  readonly scale: readonly SceneStop[] | null;
  readonly grow: SceneGrow | null;

  /**
   * How far past the card's edge it may show, in per cent of the card's width.
   *
   * <b>A clip margin, not the absence of a clip.</b> The picture is drawn covering a box that much
   * larger than the card on every side and is cut there: on a short card the crown bursts out of the
   * top and is cut at the margin, on a tall card it is wider than the card and cut at the sides, and
   * both read as a thing trying to get out. A stage that simply did not clip would hang a tall card's
   * tree over somebody else's messages. Zero — the ordinary case — is the card, exactly as before.
   *
   * Only a picture that covers the card may hang past it: one fitted whole inside has an edge of its
   * own, and that edge in mid-air is a sticker coming unstuck.
   */
  readonly spillPct: number;

  readonly retreat: SceneRetreat | null;
}

/** A figure travelling from one point of the card to another. */
export interface SceneSpriteActor extends SceneActorCommon {
  readonly type: "sprite";
  readonly sizePct: number;
  readonly from: ScenePoint;
  readonly to: ScenePoint;
  readonly durationMs: number;
  readonly ease: SceneEase;
  readonly turn: SceneTurn;
  readonly scale: readonly SceneStop[] | null;
  readonly rotate: readonly SceneStop[] | null;

  /**
   * How far the path is pushed off its own chord, in per cent of the card's width.
   *
   * Two points and a straight line between them is a ruler, and nothing alive travels on one. The
   * sign is which side of the chord it bows to.
   */
  readonly bowPct: number;

  readonly bowAxis: SceneBowAxis;

  /**
   * How far the figure leans into the bow: nose up going in, level at the top, nose down coming out.
   *
   * Separate from the `rotate` envelope, which is the author's own and may be doing something else
   * entirely. This one is tied to the shape of the path, so it stays right when the path changes.
   */
  readonly bankDeg: number;

  /**
   * A rise and fall in time with the figure's own wingbeat, in per cent of the card's width.
   *
   * <b>Its period is the strip's, not a number.</b> A wing that beats at `fps` and a body that rises
   * at some other rate is a thing being puppeted; taking the period from `frames / fps` means the
   * two cannot drift apart, whatever the author later does to either.
   */
  readonly bobPct: number;

  /** How far past the card's edge it may show. See the wash's, which says why it is a margin. */
  readonly spillPct: number;

  readonly retreat: SceneRetreat | null;
}

/**
 * A nine-slice band lying along one edge of the stage.
 *
 * <b>A nine-slice and not a stretched picture</b>, for the reason a frame's band is one: the card is
 * 384px wide in a popover and 320px in settings, and a band pulled to fit distorts whatever is drawn
 * at its ends. `border-image` draws the ends at their own size and repeats the middle.
 *
 * <b>Which is also why a band is the one actor that cannot read the sheet.</b> `border-image-source`
 * takes a whole picture and there is no way to hand it a rectangle of one, so a band carries its own
 * file in one of the ordinary slots. That is what those slots are for.
 *
 * It inherits a `repeat` it does not read: a band's own is inside `grow`, next to the hold it shares
 * a cycle with. The server refuses one on a band by name, so it is only ever the default here.
 */
export interface SceneBandActor extends SceneActorCommon {
  readonly type: "band";
  readonly edge: SceneEdge;

  /** Where to cut the source picture into nine, in its own pixels: top, right, bottom, left. */
  readonly slice: readonly [number, number, number, number];

  readonly thicknessPct: number;

  /**
   * How wide the pieces at the two ends are drawn, in per cent of the card's width.
   *
   * <b>Stated rather than taken from the slice.</b> The slice is in the source's pixels and this is
   * on the card, and nothing in CSS knows how big the source is until it has loaded — which is after
   * the band has been drawn. It defaults to the band's own thickness, which is right for a border cut
   * from a square tile and wrong for anything else, so it is a number the author can set.
   */
  readonly cornerPct: number;

  readonly outsetPct: number;
  readonly tile: SceneTile;
  readonly grow: SceneGrow | null;
  readonly retreat: SceneRetreat | null;
}

/**
 * Many copies of one drawing, scattered from an edge.
 *
 * The scatter is worked out from `seed` rather than drawn at random, so everybody looking at a
 * profile sees the same flakes in the same places and the console's preview matches the card.
 */
export interface SceneEmitterActor extends SceneActorCommon {
  readonly type: "emitter";
  readonly edge: SceneEdge;
  readonly count: number;
  readonly seed: number;
  readonly sizePct: number;
  readonly sizeVarPct: number;
  readonly durationMs: number;
  readonly durationVarMs: number;
  readonly driftPct: number;
  readonly swayPct: number;
  readonly swayPeriodMs: number;
  readonly spinDeg: number;

  /**
   * How far a copy pitches over as it swings, in degrees.
   *
   * <b>This is the one field that makes a falling thing an object rather than a picture of one.</b>
   * Something falling in air is fastest sideways exactly when it is edge-on and stalls when it is
   * flat, so the pitch and the swing are a quarter-cycle apart and the copy foreshortens to a sliver
   * twice a cycle. Zero leaves the old flat drift, which is what every scene authored before this
   * gets.
   *
   * The axis it pitches about is drawn per copy, so a tumble needs no field: a tumble is what an
   * off-horizontal pitch axis already looks like.
   */
  readonly flutterDeg: number;

  /** How far a copy dips as it passes edge-on, in per cent of the card's width. Twice a cycle. */
  readonly bobPct: number;

  /**
   * How much the swing's period varies from copy to copy.
   *
   * <b>Without it a scatter pulses.</b> Every copy swinging on one period is forty-eight things
   * agreeing, which the eye reads instantly and reads as machinery. It is the cheapest correction in
   * the emitter and the most visible.
   */
  readonly swayVarMs: number;

  /**
   * How strongly a copy's size stands for its distance.
   *
   * A larger copy is nearer, so it falls faster and sits denser; a smaller one is further off, drifts
   * slower and is paler. It reuses the size draw rather than taking one of its own, which is what
   * keeps the three agreeing: a copy cannot be large, slow and faint at once.
   *
   * <b>Distance is not blur here.</b> A filter per copy is a layer per copy, and a member list draws
   * this on dozens of cards at once; the haze belongs to the whole band and is applied there.
   */
  readonly depthSpreadPct: number;
}

/**
 * A nine-slice that goes round the whole card.
 *
 * <b>Where a band lies along one edge, this takes the card.</b> The difference is not decoration: a
 * thing that has to read as overtaking a profile — a vine over a wall — has to be on every side of
 * it at once, and four bands would be four pictures meeting at the corners with nothing making them
 * agree. A nine-slice is one picture whose corners are corners.
 *
 * Which of the four sides it is drawn on is which of `widthPct` are not zero. There is no shape
 * field, because a shape is not a thing to choose from a list — the same sentence is true of
 * `profile.frame`'s surround, and for the same reason.
 *
 * The middle of the nine is never drawn: that is the card, and a wrap that filled it would be a
 * `wash` with extra steps. Like a band, it carries its own file — `border-image-source` takes a
 * whole picture, not a rectangle of the sheet.
 */
export interface SceneWrapActor extends SceneActorCommon {
  readonly type: "wrap";

  /** Where to cut the source picture into nine, in its own pixels: top, right, bottom, left. */
  readonly slice: readonly [number, number, number, number];

  /**
   * How thick the band is per side, in per cent of the card's **width** — including the top and
   * bottom ones. A card's height is whatever its owner's bio and board come to, and a thickness
   * that followed it would be a different cosmetic on every profile.
   */
  readonly widthPct: readonly [number, number, number, number];

  readonly outsetPct: number;
  readonly tile: SceneTile;
  readonly grow: SceneGrow | null;
  readonly retreat: SceneRetreat | null;
}

export type SceneActor =
  | SceneWashActor
  | SceneSpriteActor
  | SceneBandActor
  | SceneWrapActor
  | SceneEmitterActor;

export interface ProfileScenePayload {
  /** `choice` hands the decision to the wearer; the other two are the author's. */
  readonly reach: "content" | "card" | "choice";

  /** What a wearer who has not decided gets. Only meaningful under `choice`. */
  readonly defaultReach: SceneReach;

  /** Below this card width the scene is not drawn at all. */
  readonly minWidthPx: number;

  /** Null only when nothing in the scene reads a rectangle out of the sheet. */
  readonly sheet: SceneSheet | null;

  readonly actors: readonly SceneActor[];
}

export interface ProfileSceneTuning {
  /** Null is deference: whatever the row's `defaultReach` currently says. */
  readonly reach: SceneReach | null;
}

// ── Limits. Mirror the server's CosmeticSceneLimits; where the two drift, the server refuses. ────

const MAX_ACTORS = 8;
const MAX_EMITTER_COUNT = 48;
const MAX_STOPS = 8;
const MAX_SIZE_PCT = 400;
const MAX_OFFSET_PCT = 400;
const MAX_OUTSET_PCT = 25;
const MAX_SCALE = 8;
const MAX_ROTATE_DEG = 3600;
const MAX_SLICE = 512;
const MAX_SPRITE_FRAMES = 64;
const MAX_ATLAS_PX = 4096;
const MIN_PERIOD_MS = 240;
const MAX_PERIOD_MS = 600_000;
const MAX_MIN_WIDTH_PX = 512;
const MAX_FLUTTER_DEG = 90;
const MAX_BOB_PCT = 25;
const MAX_DEPTH_SPREAD_PCT = 100;
const MAX_BOW_PCT = 200;
const MAX_BANK_DEG = 180;
const MAX_WOBBLE_DEG = 45;
const MAX_SWAY_DEG = 45;
const MAX_SHADOW_OFFSET_PCT = 50;
const MAX_SHADOW_BLUR_PCT = 50;
const MIN_FROM_SCALE = 0.01;
const MAX_SPILL_PCT = 25;
const MAX_RETREAT_STRIP_PCT = 50;
const MAX_RETREAT_SOFT_PCT = 25;
const DEFAULT_RETREAT_SOFT_PCT = 4;

const ANCHORS: readonly string[] = [
  "topLeft", "top", "topRight",
  "left", "center", "right",
  "bottomLeft", "bottom", "bottomRight",
];

const DEPTHS: readonly string[] = ["deep", "over", "front"];
const EDGES: readonly string[] = ["top", "right", "bottom", "left"];
const BOW_AXES: readonly string[] = ["auto", "x", "y"];
const LEAD_AXES: readonly string[] = ["y", "x", "both"];
const FITS: readonly string[] = ["cover", "contain", "stretch"];
const REPEATS: readonly string[] = ["loop", "once", "pingPong"];
const EASES: readonly string[] = ["linear", "in", "out", "inOut"];
const TILES: readonly string[] = ["stretch", "repeat", "round", "space"];

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function num(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function word<T extends string>(raw: unknown, allowed: readonly string[], fallback: T): T {
  return typeof raw === "string" && allowed.includes(raw) ? raw as T : fallback;
}

/**
 * An envelope, or null when what arrived cannot be one.
 *
 * Null rather than a filled-in default, and the channel is then simply not animated. The stops are
 * turned into a CSS easing function downstream, which describes a whole cycle — a list that starts
 * partway in or doubles back has no meaning there, so it is better to draw the actor still than to
 * guess what was meant.
 */
function envelopeOf(raw: unknown, low: number, high: number): readonly SceneStop[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_STOPS) return null;

  const stops: SceneStop[] = [];
  let previous = Number.NEGATIVE_INFINITY;

  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null) return null;

    const value = candidate as Record<string, unknown>;

    if (typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
    if (typeof value.v !== "number" || !Number.isFinite(value.v)) return null;
    if (value.at < 0 || value.at > 1 || value.at <= previous) return null;

    previous = value.at;
    stops.push({ at: value.at, v: clamp(value.v, low, high) });
  }

  if (stops[0].at !== 0 || stops[stops.length - 1].at !== 1) return null;

  return stops;
}

function atlasOf(raw: unknown): SceneAtlas | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const w = Math.round(num(value.w, 0));
  const h = Math.round(num(value.h, 0));

  if (w < 1 || w > MAX_ATLAS_PX || h < 1 || h > MAX_ATLAS_PX) return null;

  const frames = Math.round(num(value.frames, 1));

  if (frames < 1 || frames > MAX_SPRITE_FRAMES) return null;

  const columns = Math.round(num(value.columns, frames));

  // The strip is read as a grid, so a row that runs out halfway would play a blank frame.
  if (columns < 1 || columns > frames || frames % columns !== 0) return null;

  const still = Math.round(num(value.still, 0));

  return {
    x: clamp(Math.round(num(value.x, 0)), 0, MAX_ATLAS_PX),
    y: clamp(Math.round(num(value.y, 0)), 0, MAX_ATLAS_PX),
    w,
    h,
    frames,
    columns,
    fps: clamp(Math.round(num(value.fps, 12)), 1, 60),
    still: still >= 0 && still < frames ? still : 0,
  };
}

function sheetOf(raw: unknown): SceneSheet | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const w = Math.round(num(value.w, 0));
  const h = Math.round(num(value.h, 0));

  if (w < 1 || w > MAX_ATLAS_PX || h < 1 || h > MAX_ATLAS_PX) return null;

  return { w, h };
}

/**
 * Whether this rectangle, and every frame of the strip it starts, is inside the sheet.
 *
 * Checked here as well as on the way into the catalogue because a row can outlive the sheet it was
 * cut from: an operator replaces the file in `Primary` with a smaller one and every rectangle past
 * its edge starts drawing empty space. An actor that would draw nothing is better dropped.
 */
function fits(atlas: SceneAtlas, sheet: SceneSheet): boolean {
  const rows = atlas.frames / atlas.columns;

  return atlas.x + atlas.columns * atlas.w <= sheet.w
    && atlas.y + rows * atlas.h <= sheet.h;
}

function pointOf(raw: unknown): ScenePoint | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;

  if (typeof value.anchor !== "string" || !ANCHORS.includes(value.anchor)) return null;

  return {
    anchor: value.anchor as SceneAnchor,
    dxPct: clamp(num(value.dxPct, 0), -MAX_OFFSET_PCT, MAX_OFFSET_PCT),
    dyPct: clamp(num(value.dyPct, 0), -MAX_OFFSET_PCT, MAX_OFFSET_PCT),
  };
}

/**
 * The breathing a grown thing does afterwards, or null when it was not asked for.
 *
 * Null rather than a zero amplitude, because the two mean different things downstream: null installs
 * no animation at all, and a zero would install one that animates nothing on every card that draws
 * the scene.
 */
function swayOf(raw: unknown): SceneSway | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const deg = clamp(num(value.deg, 0), 0, MAX_SWAY_DEG);

  if (deg <= 0) return null;

  return { deg, ms: clamp(Math.round(num(value.ms, 6000)), MIN_PERIOD_MS, MAX_PERIOD_MS) };
}

/** A shadow, or null when the row did not ask for one — which is the ordinary case. */
function shadowOf(raw: unknown): SceneShadow | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const alpha = clamp(num(value.alpha, 0), 0, 1);

  // A shadow at no opacity is a filter that costs a compositing layer and paints nothing, so it is
  // dropped rather than carried. The server refuses it by name; here it is a row being turned off.
  if (alpha <= 0) return null;

  return {
    dxPct: clamp(num(value.dxPct, 0), -MAX_SHADOW_OFFSET_PCT, MAX_SHADOW_OFFSET_PCT),
    dyPct: clamp(num(value.dyPct, 0), -MAX_SHADOW_OFFSET_PCT, MAX_SHADOW_OFFSET_PCT),
    blurPct: clamp(num(value.blurPct, 0), 0, MAX_SHADOW_BLUR_PCT),
    alpha,
  };
}

/**
 * A retreat, or null when what arrived is not one.
 *
 * Null rather than a filled-in default for the two members that are the whole of it: a withdrawal
 * with no moment to start or no time to take is not half a withdrawal. And one that leaves
 * everything behind is dropped rather than installed, because it would be a mask on every card that
 * draws the scene and paints nothing.
 */
function retreatOf(raw: unknown): SceneRetreat | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;

  if (typeof value.atMs !== "number" || !Number.isFinite(value.atMs)) return null;
  if (typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs)) return null;

  const remain = clamp(num(value.remain, 0), 0, 1);

  if (remain >= 1) return null;

  return {
    atMs: clamp(Math.round(value.atMs), 0, MAX_PERIOD_MS),
    durationMs: clamp(Math.round(value.durationMs), MIN_PERIOD_MS, MAX_PERIOD_MS),
    edgePct: clamp(num(value.edgePct, 0), 0, MAX_RETREAT_STRIP_PCT),
    footPct: clamp(num(value.footPct, 0), 0, MAX_RETREAT_STRIP_PCT),
    softPct: clamp(num(value.softPct, DEFAULT_RETREAT_SOFT_PCT), 0, MAX_RETREAT_SOFT_PCT),
    remain,
  };
}

function growOf(raw: unknown): SceneGrow | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const fromPct = clamp(num(value.fromPct, 0), 0, 100);
  const toPct = clamp(num(value.toPct, 100), 0, 100);

  // Equal ends are a grow with nothing to uncover — its extension, wobble, duration and breathing
  // without a reveal — which is what a drawing that grows by itself needs. Only backwards is refused.
  if (fromPct > toPct) return null;

  const spreads = typeof value.from === "string" && ANCHORS.includes(value.from);

  return {
    fromPct,
    toPct,
    durationMs: clamp(Math.round(num(value.durationMs, 2400)), MIN_PERIOD_MS, MAX_PERIOD_MS),
    holdMs: clamp(Math.round(num(value.holdMs, 0)), 0, MAX_PERIOD_MS),
    repeat: word<SceneRepeat>(value.repeat, REPEATS, "loop"),
    from: spreads ? value.from as SceneAnchor : "edge",

    // Growth by default, and a wipe only when a row asks for one by name. The other way round is
    // how this kind shipped, and every scene authored against it arrived like a blind going up.
    fromScale: clamp(num(value.fromScale, 0.08), MIN_FROM_SCALE, 1),
    leadAxis: word<SceneLeadAxis>(value.leadAxis, LEAD_AXES, "y"),
    wobbleDeg: clamp(num(value.wobbleDeg, 0), 0, MAX_WOBBLE_DEG),
    softness: clamp(num(value.softness, 0.5), 0, 1),
    sway: swayOf(value.sway),
  };
}

function sidesOf(raw: unknown, low: number, high: number): readonly [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;

  const read: number[] = [];

  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;

    read.push(clamp(value, low, high));
  }

  return [read[0], read[1], read[2], read[3]];
}

function sliceOf(raw: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;

  const read: number[] = [];

  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;

    read.push(clamp(Math.round(value), 0, MAX_SLICE));
  }

  return [read[0], read[1], read[2], read[3]];
}

function occludeOf(raw: unknown): readonly SceneOcclusion[] {
  if (!Array.isArray(raw)) return [];

  // Anything this build does not recognise is dropped rather than refused: a card part named by a
  // newer server is one this renderer cannot hide behind, and drawing the actor unhidden is a great
  // deal better than not drawing the scene.
  return raw.filter((part): part is SceneOcclusion => part === "avatar");
}

function commonOf(value: Record<string, unknown>, sheet: SceneSheet | null): SceneActorCommon | null {
  const source = word<SceneSource>(value.source, ["atlas", "file"], "atlas");
  const atlas = atlasOf(value.atlas);

  if (source === "atlas" && (atlas === null || sheet === null || !fits(atlas, sheet))) return null;

  return {
    slot: typeof value.slot === "string" && value.slot.length > 0 ? value.slot : "Primary",
    source,
    atlas: source === "atlas" ? atlas : null,
    depth: word<SceneDepth>(value.depth, DEPTHS, "over"),
    occlude: occludeOf(value.occlude),
    delayMs: clamp(Math.round(num(value.delayMs, 0)), -120_000, 120_000),
    opacity: envelopeOf(value.opacity, 0, 1),
    shadow: shadowOf(value.shadow),
    repeat: word<SceneRepeat>(value.repeat, REPEATS, "loop"),

    // Only a whole file has a clock of its own to start over. The server refuses the pair; here a
    // rectangle of the sheet asked to replay simply does not, which is what it would do anyway.
    replay: source === "file" && value.replay === true,
  };
}

/**
 * How far past the card an actor may show — but only one that covers the card.
 *
 * Dropped to nothing rather than dropping the actor: a picture fitted whole inside the card has an
 * edge of its own, and hanging that past the card shows the edge in mid-air. The server refuses the
 * pair on the way in; here it is a row authored against an older rule, and a clipped wash beats a
 * missing one.
 */
function spillOf(raw: unknown, covers: boolean): number {
  return covers ? clamp(num(raw, 0), 0, MAX_SPILL_PCT) : 0;
}

function actorOf(raw: unknown, sheet: SceneSheet | null): SceneActor | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const common = commonOf(value, sheet);

  if (common === null) return null;

  if (value.type === "wash") {
    const fit = word<SceneFit>(value.fit, FITS, "cover");

    return {
      ...common,
      type: "wash",
      fit,
      periodMs: clamp(Math.round(num(value.periodMs, 8000)), MIN_PERIOD_MS, MAX_PERIOD_MS),
      scale: envelopeOf(value.scale, 0.1, MAX_SCALE),
      grow: growOf(value.grow),
      spillPct: spillOf(value.spillPct, fit === "cover"),
      retreat: retreatOf(value.retreat),
    };
  }

  if (value.type === "sprite") {
    const from = pointOf(value.from);
    const to = pointOf(value.to);
    const sizePct = num(value.sizePct, 0);

    if (from === null || to === null || sizePct < 1 || sizePct > MAX_SIZE_PCT) return null;

    return {
      ...common,
      type: "sprite",
      sizePct,
      from,
      to,
      durationMs: clamp(Math.round(num(value.durationMs, 4000)), MIN_PERIOD_MS, MAX_PERIOD_MS),
      ease: word<SceneEase>(value.ease, EASES, "linear"),
      turn: word<SceneTurn>(value.turn, ["none", "mirror"], "none"),
      scale: envelopeOf(value.scale, 0.1, MAX_SCALE),
      rotate: envelopeOf(value.rotate, -MAX_ROTATE_DEG, MAX_ROTATE_DEG),
      bowPct: clamp(num(value.bowPct, 0), -MAX_BOW_PCT, MAX_BOW_PCT),
      bowAxis: word<SceneBowAxis>(value.bowAxis, BOW_AXES, "auto"),
      bankDeg: clamp(num(value.bankDeg, 0), -MAX_BANK_DEG, MAX_BANK_DEG),
      bobPct: clamp(num(value.bobPct, 0), 0, MAX_BOB_PCT),
      spillPct: spillOf(value.spillPct, true),
      retreat: retreatOf(value.retreat),
    };
  }

  if (value.type === "band") {
    const slice = sliceOf(value.slice);
    const thicknessPct = num(value.thicknessPct, 0);

    if (slice === null || thicknessPct < 1 || thicknessPct > 100) return null;
    if (typeof value.edge !== "string" || !EDGES.includes(value.edge)) return null;

    // `border-image-source` takes a whole picture and cannot be handed a rectangle of one, so a band
    // carries its own file. Refused rather than drawn some other way: a band that quietly stopped
    // being a nine-slice would distort its own ends on every card of a different width.
    if (common.source !== "file") return null;

    return {
      ...common,
      type: "band",
      edge: value.edge as SceneEdge,
      slice,
      thicknessPct,
      cornerPct: clamp(num(value.cornerPct, thicknessPct), 0, 100),
      outsetPct: clamp(num(value.outsetPct, 0), 0, MAX_OUTSET_PCT),
      tile: word<SceneTile>(value.tile, TILES, "round"),
      grow: growOf(value.grow),
      retreat: retreatOf(value.retreat),
    };
  }

  if (value.type === "wrap") {
    const slice = sliceOf(value.slice);
    const widthPct = sidesOf(value.widthPct, 0, 100);

    if (slice === null || widthPct === null) return null;
    if (widthPct[0] + widthPct[1] + widthPct[2] + widthPct[3] === 0) return null;

    // Same reason a band carries its own file: `border-image-source` takes a whole picture and
    // cannot be handed a rectangle of the sheet.
    if (common.source !== "file") return null;

    return {
      ...common,
      type: "wrap",
      slice,
      widthPct,
      outsetPct: clamp(num(value.outsetPct, 0), 0, MAX_OUTSET_PCT),
      tile: word<SceneTile>(value.tile, TILES, "round"),
      grow: growOf(value.grow),
      retreat: retreatOf(value.retreat),
    };
  }

  if (value.type === "emitter") {
    const count = Math.round(num(value.count, 0));
    const sizePct = num(value.sizePct, 0);

    if (count < 1 || sizePct < 1 || sizePct > MAX_SIZE_PCT) return null;
    if (typeof value.edge !== "string" || !EDGES.includes(value.edge)) return null;

    // Every copy sits at a different point of one cycle, which is done with a negative delay on an
    // animation this code controls. A self-animating file plays to its own clock, so a scatter of
    // them would fall in step — the one thing a scatter must not do.
    if (common.source !== "atlas") return null;

    const durationMs = clamp(Math.round(num(value.durationMs, 6000)), MIN_PERIOD_MS, MAX_PERIOD_MS);
    const swayPeriodMs = clamp(Math.round(num(value.swayPeriodMs, 2400)), MIN_PERIOD_MS, 120_000);

    return {
      ...common,
      type: "emitter",
      edge: value.edge as SceneEdge,
      count: Math.min(count, MAX_EMITTER_COUNT),
      seed: clamp(Math.round(num(value.seed, 0)), 0, 65_535),
      sizePct,

      // Clamped to the middle rather than refused: a spread wider than what it spreads produces
      // copies at no size, and the server already refuses that on the way in. Here it is a row
      // authored against an older rule, and a tighter scatter beats a missing one.
      sizeVarPct: clamp(num(value.sizeVarPct, 0), 0, sizePct),
      durationMs,
      durationVarMs: clamp(Math.round(num(value.durationVarMs, 0)), 0, durationMs),
      driftPct: clamp(num(value.driftPct, 0), 0, 200),
      swayPct: clamp(num(value.swayPct, 0), 0, 100),
      swayPeriodMs,

      // Clamped to the period rather than refused, for the reason `sizeVarPct` is: a spread wider
      // than what it spreads produces copies swinging backwards in time, and a tighter scatter is a
      // better answer than a broken one on a row authored against an older rule.
      swayVarMs: clamp(Math.round(num(value.swayVarMs, 0)), 0, swayPeriodMs),
      spinDeg: clamp(num(value.spinDeg, 0), 0, MAX_ROTATE_DEG),
      flutterDeg: clamp(num(value.flutterDeg, 0), 0, MAX_FLUTTER_DEG),
      bobPct: clamp(num(value.bobPct, 0), 0, MAX_BOB_PCT),
      depthSpreadPct: clamp(num(value.depthSpreadPct, 0), 0, MAX_DEPTH_SPREAD_PCT),
    };
  }

  return null;
}

export default defineCosmeticKind<ProfileScenePayload>({
  key: "profile.scene",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "sceneStage",
  layer: 750,
  scope: "both",
  labelKey: "cosmetic_kind_profile_scene",

  /**
   * <b>Where the server refuses, this degrades.</b> The two are not the same job: a row is checked
   * once, on the way into the catalogue, by something that can tell an operator what is wrong. This
   * runs on somebody else's profile card, against a row that may have been authored for a newer
   * build — so an actor it cannot read is dropped, a channel it cannot read is not animated, and
   * only a scene with nothing left in it comes back null.
   */
  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as Record<string, unknown>;

    if (!Array.isArray(value.actors)) return null;

    const reach = value.reach;

    if (reach !== "content" && reach !== "card" && reach !== "choice") return null;

    const sheet = sheetOf(value.sheet);
    const actors: SceneActor[] = [];

    for (const candidate of value.actors.slice(0, MAX_ACTORS)) {
      const actor = actorOf(candidate, sheet);

      if (actor !== null) actors.push(actor);
    }

    if (actors.length === 0) return null;

    return {
      reach,
      defaultReach: word<SceneReach>(value.defaultReach, ["content", "card"], "card"),
      minWidthPx: clamp(Math.round(num(value.minWidthPx, 0)), 0, MAX_MIN_WIDTH_PX),
      sheet,
      actors,
    };
  },

  tuning: {
    empty: () => ({ reach: null }),

    parse(raw) {
      if (typeof raw !== "object" || raw === null) return { reach: null };

      const { reach } = raw as { reach?: unknown };

      return { reach: reach === "content" || reach === "card" ? reach : null };
    },

    isEmpty: (value: ProfileSceneTuning) => value.reach === null,

    /**
     * Only a row that says the wearer may decide. A scene authored to take the whole card, bottom to
     * top, has one answer and nothing to ask — and a dial that changes nothing reads as broken
     * rather than as absent.
     */
    appliesTo: (payload: unknown) =>
      typeof payload === "object" && payload !== null
      && (payload as { reach?: unknown }).reach === "choice",

    editor: SceneTuning,
  },

  // No insetsOf, outsetsOf or hidesEdges, and that is the difference between a scene and a frame. A
  // scene is clipped by the card it plays on: it asks for no room outside, pushes nothing in, and
  // replaces none of the card's own edges. Something that both moves and leaves the card is
  // something that moves over somebody else's messages. An actor's `spillPct` is a margin on that
  // clip and not a hole in it: a quarter of the card's width at the most, and it asks the card for
  // no room either — what hangs past the edge hangs over whatever is there, as a frame's prop does.
});
