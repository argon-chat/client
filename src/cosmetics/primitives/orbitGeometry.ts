import type { AvatarOrbitPayload, OrbitSatellite } from "@/cosmetics/kinds/avatar-orbit";

/**
 * Where a figure orbiting a face is at every moment, and what the browser is told so that it works
 * that out for itself.
 *
 * <b>The whole of the arithmetic is here and none of it is in the component.</b> A ring on a sphere
 * is two vectors and a phase; getting a sign wrong sends a cat round the wrong way, or puts the near
 * half behind the head — and neither is a type error, neither shows in a diff, and both look exactly
 * like a rendering bug.
 *
 * <b>Nothing below runs per frame.</b> The path is a fixed set of keyframes installed once, sampled
 * from a cosine, and every number a row carries arrives as a custom property the keyframes multiply.
 * So a member list showing forty people wearing forty different orbits adds forty style objects and
 * no JavaScript at all — the alternative is a rAF loop per face, which is the one thing a decoration
 * drawn beside every avatar cannot be.
 */

type Style = Record<string, string>;

/**
 * How finely the circle is sampled.
 *
 * Linear interpolation between stops of a cosine is short by about a fiftieth of a per cent of the
 * radius at this count — under a tenth of a pixel on a face — and doubling it doubles a stylesheet
 * that is parsed once. Twenty-four is also divisible by four, so the extremes of the ellipse land on
 * stops rather than between them, which is where a polygon would show.
 */
const PATH_STOPS = 24;

/**
 * How far the cut at the edge of the face is feathered, in hundredths of the stage's radius.
 *
 * A knife-edge is what a mask does by default, and a hard cut across a body reads as a body being
 * clipped rather than as a body going behind something. A pixel or so of softness reads as the
 * depth of field the rest of the arrangement is already implying.
 */
const SILHOUETTE_FEATHER = 3;

/**
 * How wide the edge that sweeps across the figure is, in hundredths of the stage's radius.
 *
 * Wider than the silhouette's own, because this one is meant to be seen moving: a hard line
 * travelling across a body reads as a wipe, and a soft one reads as a body passing an edge.
 */
const WIPE_FEATHER = 9;

/** Far enough for the wildest arrangement, close enough that a row cannot cover a message. */
const MAX_REACH_PCT = 300;

/**
 * How long the near drawing takes to sink away behind the face, as a percentage of one lap.
 *
 * <b>This is what lets a figure walk on the face rather than around it, and it is not a polish
 * detail.</b> A figure whose ring is the size of the face crosses from in front to behind at the two
 * points where it is furthest to the side — straddling the edge, half of it over the face. Swap the
 * two drawings there and that half appears or vanishes in one frame, which is the single artefact
 * this whole arrangement can produce, and it is on the most interesting setting there is.
 *
 * So the swap is not symmetrical. The far drawing comes on hard, and over this window the near one
 * is taken away — and because the far drawing is already at full opacity everywhere outside the
 * face, that is only ever seen on the part lying over it.
 *
 * <b>Taken away by an edge sweeping outwards from the middle of the face, not by fading.</b> A body
 * going behind a head does not dim; the head's edge crosses it, nearest part first. Fading the whole
 * of it at once is what a timer does, and it is what made this read as a picture being switched off
 * rather than as something going behind something — which is the one thing this kind is for. Coming
 * back out is the same edge running the other way, so the part furthest from the head appears first,
 * which is also what actually happens.
 */
const SINK_PCT = 7;

export const PATH_ANIMATION = "cosmetic-avatar-orbit-path";
export const SHADE_ANIMATION = "cosmetic-avatar-orbit-shade";
export const NEAR_ANIMATION = "cosmetic-avatar-orbit-near";
export const FAR_ANIMATION = "cosmetic-avatar-orbit-far";
export const BOB_ANIMATION = "cosmetic-avatar-orbit-bob";
export const ROCK_ANIMATION = "cosmetic-avatar-orbit-rock";
export const HEADING_ANIMATION = "cosmetic-avatar-orbit-heading";

/**
 * How many shapes of course this build ships, from edge-on to flat.
 *
 * <b>The heading of a figure following an ellipse is not a sinusoid and not a line.</b> It is the
 * angle of a vector that itself traces an ellipse, so unlike everything else here it cannot be one
 * static track multiplied by a number the row carries — its <i>shape</i> depends on how flat the
 * ring is, not just its size. What the shape actually depends on is a single ratio, though: how
 * short the ring's minor axis is against its major one. So the set is five tracks cut at five
 * flatnesses and the nearest is used, which keeps the rule this file lives by — the vocabulary is
 * code, the amounts are data — instead of writing a stylesheet per catalogue row.
 *
 * At the flat end the course is a plain steady turn; at the edge-on end it is two half-circle turns
 * a lap apart, which is the hard reversal this replaced. Everything worth wearing is in between, and
 * five cuts put the worst error under a dozen degrees on a figure the size of a thumbnail.
 */
const COURSE_LEVELS = 5;

export function courseAnimation(level: number): string {
  return `cosmetic-avatar-orbit-course-${level}`;
}
export const SHEET_X_ANIMATION = "cosmetic-avatar-orbit-sheet-x";
export const SHEET_Y_ANIMATION = "cosmetic-avatar-orbit-sheet-y";

/**
 * The box everything is drawn in: the face, grown by as far as the widest figure gets outside it.
 *
 * <b>One box for every figure rather than one each.</b> Every measurement below is a percentage of
 * that box, and sharing it means the conversion from "percentage of the face" is one division done
 * once — two boxes would be two divisors and one of them would eventually be applied to the other's
 * numbers.
 */
export interface OrbitStageBox {
  /** How far past the edge of the face the box goes, per side, as a percentage of the face. */
  readonly reachPct: number;

  /** The width of the box, as a percentage of the face. */
  readonly spanPct: number;
}

/** One figure's two drawings: the one the face hides, and the one that covers the face. */
export interface OrbitCopy {
  /** Which half of the circuit this drawing is for, and whether it is cut at the face's edge. */
  readonly behind: boolean;

  readonly gate: Style;

  /**
   * The ring's own lean, rocking — a plain box when it does not.
   *
   * Outside the travel and inside the cut, which is the only place it can be: the cut is the shape
   * of the face and must not turn with the ring, and the figure's own turn is measured against the
   * ring rather than against the screen — a figure that stayed upright while its ring rocked would
   * be facing the wrong way for half of every lap.
   */
  readonly rocker: Style;

  readonly mover: Style;
  readonly bobber: Style;
  readonly sprite: Style;
}

export interface DrawnSatellite {
  readonly index: number;
  readonly copies: readonly OrbitCopy[];
}

export function stageOf(payload: AvatarOrbitPayload): OrbitStageBox {
  let reachPct = 0;

  for (const satellite of payload.satellites) {
    reachPct = Math.max(reachPct, reachOf(satellite));
  }

  return { reachPct, spanPct: 100 + (reachPct * 2) };
}

/**
 * How far past the edge of the face one figure gets, at its largest.
 *
 * The diagonal rather than the width, because a figure is allowed to lean and a leaning box is
 * wider than it was. The same arithmetic the server holds a row to before it will accept it, kept
 * here because the drawing needs the answer and cannot ask the server for it.
 */
function reachOf(satellite: OrbitSatellite): number {
  const scale = Math.max(satellite.nearScale, satellite.farScale);
  const extent = (satellite.radiusPct + halfOf(satellite) + satellite.bobPct) * scale;

  return Math.min(MAX_REACH_PCT, Math.max(0, extent - 50));
}

/**
 * How far a figure reaches from the middle of itself, in the worst direction.
 *
 * The diagonal only for a figure that turns: a box lying square to the screen never reaches past
 * half its own side, and charging it for a corner it never presents put half again as much air
 * around every ornament that only ever mirrors.
 */
function halfOf(satellite: OrbitSatellite): number {
  const turns = satellite.faceTravel && satellite.turn === "spin";

  return turns || satellite.leanDeg !== 0
    ? Math.hypot(satellite.widthPct, satellite.heightPct) / 2
    : Math.max(satellite.widthPct, satellite.heightPct) / 2;
}

/**
 * The two vectors the circle is drawn from, and how deep it goes.
 *
 * <b>A ring on a sphere projects to exactly this and nothing more.</b> Take a circle of radius R,
 * tip its plane out of the screen by <c>tilt</c> and lean it by <c>yaw</c>, and every point of it is
 * <c>A·cos θ + B·sin θ</c> on the screen with a depth of <c>D·sin θ</c> — so two vectors and one
 * number hold the whole path, whatever the plane. Which is why the payload carries angles and this
 * carries vectors: an ellipse and a phase would draw the same picture and could not say which half
 * of it is nearer, and which half is nearer is the entire point of the kind.
 *
 * Going the other way round is the parameter running backwards, which negates <c>B</c> and the depth
 * together. Negating only one of them is a figure that travels one way and is lit as though it
 * travelled the other.
 */
interface OrbitBasis {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;

  /** Positive towards the viewer, at <c>sin θ = 1</c>. */
  readonly depth: number;
}

function basisOf(satellite: OrbitSatellite, stage: OrbitStageBox): OrbitBasis {
  const radius = toStage(satellite.radiusPct, stage);
  const yaw = radians(satellite.yawDeg);
  const tilt = radians(satellite.tiltDeg);
  const sign = satellite.reverse ? -1 : 1;

  // The unleaned ring: x runs with cos θ, and both the drop down the screen and the depth run with
  // sin θ — the far half is the high half, which is a ring seen from a little above.
  const flat = radius * Math.cos(tilt);

  return {
    ax: radius * Math.cos(yaw),
    ay: radius * Math.sin(yaw),
    bx: -flat * Math.sin(yaw) * sign,
    by: flat * Math.cos(yaw) * sign,
    depth: radius * Math.sin(tilt) * sign,
  };
}

/**
 * Everything one figure needs, as the style objects for the four elements that draw it.
 *
 * Two copies when the face is meant to hide it: the same drawing twice, one cut to the shape of the
 * face and shown only while the figure is behind. A hard swap between them at the moment the figure
 * crosses the edge of the face, because at that moment the two are the same picture in the same
 * place — the only thing that changes is which side of the head it is on, which is the thing being
 * drawn.
 */
export function drawSatellite(
  satellite: OrbitSatellite,
  index: number,
  stage: OrbitStageBox,
  url: string | null,
  moving: boolean,

  /**
   * Standing still in the middle of the box rather than at its place on the ring.
   *
   * <b>Only for a host that has no face under this.</b> A reader who asked for less movement
   * still has a face in front of them, and a figure parked off to one side of it is where that
   * figure belongs. A line in a wardrobe has no face and one question — which orbit is this —
   * and the place to answer it is the middle. The pose and the light stay the author's; only
   * the displacement goes.
   */
  centred = false,
): DrawnSatellite | null {
  if (url === null) return null;

  const basis = basisOf(satellite, stage);

  if (!moving) {
    return { index, copies: [stillCopy(satellite, basis, stage, url, centred)] };
  }

  // Nothing to hide behind: a ring lying flat against the screen never goes anywhere, and a figure
  // its author declared a light is meant to pass through the head rather than round it.
  const split = satellite.occlude && Math.abs(basis.depth) > 0.01;

  const near = movingCopy(satellite, basis, stage, url, false, split);

  return split
    ? { index, copies: [movingCopy(satellite, basis, stage, url, true, split), near] }
    : { index, copies: [near] };
}

function movingCopy(
  satellite: OrbitSatellite,
  basis: OrbitBasis,
  stage: OrbitStageBox,
  url: string,
  behind: boolean,
  split: boolean,
): OrbitCopy {
  const delay = -satellite.phaseMs;
  const gate: Style = { ...gateBox(stage) };

  if (split) {
    // The near half of the circuit is the first half of the timeline, and going round the other way
    // reverses the depth along with the travel — which is half a lap later, not a different track.
    const turned = satellite.reverse ? satellite.periodMs / 2 : 0;

    gate.animation = timed(behind ? FAR_ANIMATION : NEAR_ANIMATION, satellite.periodMs, delay + turned);
  }

  if (behind) Object.assign(gate, silhouette(stage));
  else if (split) Object.assign(gate, veil(satellite, stage));

  const mover: Style = { ...fill(), ...pathVariables(basis, satellite, stage) };
  const running = [timed(PATH_ANIMATION, satellite.periodMs, delay)];

  if (satellite.dim > 0 || satellite.haze > 0 || satellite.blurPct > 0) {
    running.push(timed(SHADE_ANIMATION, satellite.periodMs, delay));
  }

  mover.animation = running.join(", ");

  return {
    behind,
    gate,
    rocker: rocker(satellite),
    mover,
    bobber: bobber(satellite, stage),
    sprite: movingSprite(satellite, basis, url, stage),
  };
}

/**
 * The ring tipping from side to side, so that one circle covers a sphere.
 *
 * <b>A figure on a fixed ring walks the same line for ever.</b> Rocking the ring's lean is the one
 * thing that makes it read as a creature on a ball rather than a creature on a track — the line it
 * walks sweeps across the face and back, and the figure leans with it the way anything walking on a
 * curved surface does.
 *
 * A rocking rather than a turn all the way round, which would take the figure upside down and keep
 * it there for a quarter of every sweep.
 */
function rocker(satellite: OrbitSatellite): Style {
  if (satellite.yawSwingDeg <= 0) return fill();

  return {
    ...fill(),
    "--ao-rock": `${n(satellite.yawSwingDeg)}deg`,
    animation: timed(ROCK_ANIMATION, satellite.yawSwingMs, -satellite.phaseMs, "ease-in-out"),
  };
}

/**
 * The figure standing where its author left it, for a reduced-motion preference and for every face
 * too small to run an orbit on.
 *
 * It is still placed by the same arithmetic and still cut by the face if that is where it stands —
 * a still pose that ignores its own depth is a figure sitting on top of a head it was behind.
 */
function stillCopy(
  satellite: OrbitSatellite,
  basis: OrbitBasis,
  stage: OrbitStageBox,
  url: string,
  centred: boolean,
): OrbitCopy {
  const angle = radians(satellite.stillDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const depth = basis.depth * sin;

  // Centred, there is no face to go behind and nothing to be cut against.
  const behind = !centred && satellite.occlude && depth < 0;

  const x = centred ? 0 : (basis.ax * cos) + (basis.bx * sin);
  const y = centred ? 0 : (basis.ay * cos) + (basis.by * sin);
  const scale = mid(satellite.nearScale, satellite.farScale) + (half(satellite.nearScale, satellite.farScale) * sin);

  const gate: Style = { ...gateBox(stage) };

  if (behind) Object.assign(gate, silhouette(stage));

  const mover: Style = {
    ...fill(),
    transform: `translate(${pct(x)}, ${pct(y)}) scale(${n(scale)})`,
  };

  const brightness = 1 - (satellite.dim * (1 - sin) / 2);
  const blur = toStage(satellite.blurPct, stage) * (1 - sin) / 2;

  if (satellite.dim > 0 || satellite.blurPct > 0) {
    mover.filter = `brightness(${n(brightness)}) blur(${n(blur)}cqmin)`;
  }

  if (satellite.haze > 0) mover.opacity = n(1 - (satellite.haze * (1 - sin) / 2));

  return {
    behind,
    gate,

    // At rest the ring is level: the rocking passes through no lean twice a sweep, and a still pose
    // showing one of its extremes would be a figure frozen mid-stumble.
    rocker: fill(),

    mover,
    bobber: bobber(satellite, stage),
    sprite: stillSprite(satellite, basis, url, stage, angle),
  };
}

/** The box a figure is drawn in: the face, grown on every side by how far the figure gets outside it. */
function gateBox(stage: OrbitStageBox): Style {
  return {
    position: "absolute",
    inset: `-${n(stage.reachPct)}%`,
    pointerEvents: "none",

    // So a length below can be a percentage of the face at whatever size the face happens to be
    // drawn. A blur is the one measurement here that cannot be written as a percentage of anything.
    containerType: "size",
  };
}

/**
 * The cut that makes the face solid: everything outside the face is drawn, everything over it is not.
 *
 * <b>This is the occlusion, and it is exact.</b> A z-index would put the figure behind the avatar's
 * picture and in front of whatever the avatar has for a background — so a face with no picture, or a
 * transparent corner, would show a cat through the head. Cutting the figure to the shape of the face
 * asks nothing of the avatar at all: it works the same over a photograph, a letter on a coloured
 * disc and a hole, because the shape is what the face occupies rather than what it drew.
 */
function silhouette(stage: OrbitStageBox): Style {
  const hole = 10_000 / stage.spanPct;
  const mask = `radial-gradient(circle closest-side at 50% 50%, `
    + `transparent 0 ${n(hole)}%, #000 ${n(hole + SILHOUETTE_FEATHER)}%)`;

  return { maskImage: mask, WebkitMaskImage: mask };
}

/**
 * The edge that crosses the figure as it goes behind the face, and back the other way as it comes
 * out — the near drawing's own cut, which moves.
 *
 * <b>It is the same shape as the face and it grows past the figure.</b> The face's edge is a circle
 * about the middle of it, so a body going behind that edge loses its nearest part first and its
 * furthest part last; sweeping a circle outwards from the middle is that, exactly, and nothing else
 * has to know which way the figure is travelling.
 *
 * Both ends of the sweep are worked out from where the figure can reach, so the start clears it
 * entirely — nothing is cut while the figure is in front — and the end covers it entirely, which is
 * what takes the drawing away without a fade. On the half of the lap it spends behind, the figure's
 * own scale is never more than the middle one, so the far end is a bound and not a guess.
 */
function veil(satellite: OrbitSatellite, stage: OrbitStageBox): Style {
  const scale = mid(satellite.nearScale, satellite.farScale);
  const half = Math.hypot(satellite.widthPct, satellite.heightPct) / 2;

  // A measurement of the face, as a percentage of the stage's own radius — which is what a stop in
  // a `closest-side` gradient is measured against.
  const toEdge = 200 / stage.spanPct;

  // Nothing, and it has to be nothing rather than the figure's own inner edge — which is what this
  // was. That edge is only where the figure sits at the two crossings; on the pass across the face
  // it comes far closer in, so a resting hole cut to the crossing swallowed the whole of it for
  // that half of the lap. A hole of no radius cuts nothing, which is the only safe place to start.
  const inner = 0;
  const outer = ((satellite.radiusPct + half + satellite.bobPct) * scale * toEdge) + WIPE_FEATHER;

  // The soft band ends at the sweep rather than starting there, so a sweep of nothing hides nothing.
  // The other way round leaves a soft hole in the middle of the face whenever the figure is bigger
  // than the ring it travels — which is every figure worth looking at.
  const mask = `radial-gradient(circle closest-side at 50% 50%, `
    + `transparent 0 calc(var(--ao-veil) - ${WIPE_FEATHER}%), #000 var(--ao-veil))`;

  return {
    "--ao-veil-in": pct(inner),
    "--ao-veil-out": pct(outer),
    "--ao-veil": pct(inner),
    maskImage: mask,
    WebkitMaskImage: mask,
  };
}

function fill(): Style {
  return { position: "absolute", inset: "0" };
}

/**
 * The numbers the keyframes multiply: two vectors for the path, and the middle and swing of
 * everything that follows the depth.
 *
 * Each one is written as a middle plus an amount, because a keyframe interpolates and the sampled
 * cosine is already in the rule — <c>middle + swing · sin θ</c> is the same curve as the path, so
 * every depth cue stays in step with the travel however the row is phased.
 */
function pathVariables(basis: OrbitBasis, satellite: OrbitSatellite, stage: OrbitStageBox): Style {
  const style: Style = {
    "--ao-ax": pct(basis.ax),
    "--ao-ay": pct(basis.ay),
    "--ao-bx": pct(basis.bx),
    "--ao-by": pct(basis.by),
    "--ao-scale-mid": n(mid(satellite.nearScale, satellite.farScale)),
    "--ao-scale-swing": n(half(satellite.nearScale, satellite.farScale)),
  };

  if (satellite.dim > 0 || satellite.haze > 0 || satellite.blurPct > 0) {
    const blur = toStage(satellite.blurPct, stage);

    style["--ao-light-mid"] = n(1 - (satellite.dim / 2));
    style["--ao-light-swing"] = n(satellite.dim / 2);
    style["--ao-veil-mid"] = n(1 - (satellite.haze / 2));
    style["--ao-veil-swing"] = n(satellite.haze / 2);
    style["--ao-blur-mid"] = `${n(blur / 2)}cqmin`;
    style["--ao-blur-swing"] = `${n(-blur / 2)}cqmin`;
  }

  return style;
}

/**
 * The rise and fall, on a period of its own.
 *
 * Deliberately not a fraction of the circuit: a bounce that divides the lap evenly lands in the same
 * place every time round, and that is the difference between a thing running and a thing on a wheel.
 */
function bobber(satellite: OrbitSatellite, stage: OrbitStageBox): Style {
  const style: Style = { ...fill(), opacity: n(satellite.opacity) };

  if (satellite.bobPct > 0) {
    style["--ao-bob"] = pct(toStage(satellite.bobPct, stage));

    // Phased with the circuit rather than started from zero, so two figures on one face do not rise
    // and fall together — which is the thing that makes two creatures read as one animated picture.
    style.animation = timed(BOB_ANIMATION, satellite.bobPeriodMs, -satellite.phaseMs, "ease-in-out");
  }

  return style;
}

function spriteBox(satellite: OrbitSatellite, url: string, stage: OrbitStageBox): Style {
  const width = toStage(satellite.widthPct, stage);
  const height = toStage(satellite.heightPct, stage);

  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: pct(width),
    height: pct(height),
    marginLeft: pct(-width / 2),
    marginTop: pct(-height / 2),
    backgroundImage: `url("${url}")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "0% 0%",
    backgroundSize: sizeOf(satellite),
  };
}

function movingSprite(
  satellite: OrbitSatellite,
  basis: OrbitBasis,
  url: string,
  stage: OrbitStageBox,
): Style {
  const style: Style = { ...spriteBox(satellite, url, stage), "--ao-lean": `${n(leanOf(satellite))}deg` };
  const running: string[] = [];
  const backwards: string[] = [];

  if (!satellite.faceTravel) {
    style.transform = `rotate(var(--ao-lean))`;
  } else if (satellite.turn === "spin") {
    // The course runs on the circuit's own phase: its start is the start of the lap, not the moment
    // the figure turns — there is no such moment any more.
    running.push(timed(courseAnimation(courseLevel(basis)), satellite.periodMs, -satellite.phaseMs));
    backwards.push(satellite.reverse ? "reverse" : "normal");
  } else {
    running.push(timed(HEADING_ANIMATION, satellite.periodMs, headingDelay(satellite, basis)));
    backwards.push("normal");
  }

  for (const sheet of sheetAnimations(satellite, style)) {
    running.push(sheet);
    backwards.push("normal");
  }

  if (running.length > 0) {
    style.animation = running.join(", ");

    // Only ever set for the course, and only when the figure goes round the other way: the same
    // shape of turn read backwards, which is exactly what turning the other way is. The strip of
    // drawings must not come with it — legs that ran backwards would undo the whole point.
    if (backwards.includes("reverse")) style.animationDirection = backwards.join(", ");
  }

  return style;
}

/**
 * Where the art points before the course is added: the ring's own lean, and half a turn on from it
 * when the figure goes round the other way.
 *
 * Reversing negates the ring's minor axis, which mirrors the frame the course is measured in. Read
 * the same course backwards and add half a turn and the two cancel exactly — which is why there is
 * one family of tracks rather than two.
 */
function leanOf(satellite: OrbitSatellite): number {
  return satellite.leanDeg + (satellite.turn === "spin" && satellite.reverse ? 180 : 0);
}

/** Which of the cut courses this ring is nearest: how short its minor axis is against its major. */
function courseLevel(basis: OrbitBasis): number {
  const major = Math.hypot(basis.ax, basis.ay);
  const minor = Math.hypot(basis.bx, basis.by);
  const flat = major > 0 ? Math.min(1, minor / major) : 0;

  return Math.round(flat * (COURSE_LEVELS - 1));
}

/** The heading the cut course would be showing at one angle, worked out rather than sampled. */
function courseAt(basis: OrbitBasis, angle: number): number {
  const major = Math.hypot(basis.ax, basis.ay);
  const minor = Math.hypot(basis.bx, basis.by);
  const flat = major > 0 ? Math.min(1, minor / major) : 0;

  return degrees(Math.atan2(flat * Math.cos(angle), -Math.sin(angle)));
}

function stillSprite(
  satellite: OrbitSatellite,
  basis: OrbitBasis,
  url: string,
  stage: OrbitStageBox,
  angle: number,
): Style {
  const style = { ...spriteBox(satellite, url, stage) };

  if (satellite.faceTravel && satellite.turn === "spin") {
    // The same course the animation would be running, at the one angle it is standing at — worked
    // out rather than read off a cut track, because nothing here has to be shared with a keyframe.
    style.transform = `rotate(${n(leanOf(satellite) + courseAt(basis, satellite.reverse ? -angle : angle))}deg)`;
  } else {
    const mirror = satellite.faceTravel && facingBackwards(satellite, basis, angle) ? "scaleX(-1) " : "";

    style.transform = `${mirror}rotate(${n(satellite.leanDeg)}deg)`;
  }

  if (satellite.sprite !== null) {
    const { columns, frames, still } = satellite.sprite;
    const rows = frames / columns;

    style.backgroundPosition = `${cell(still % columns, columns)} ${cell(Math.floor(still / columns), rows)}`;
  }

  return style;
}

/**
 * Walking the strip, one cell per step.
 *
 * The far end of the travel is <c>100% · n/(n-1)</c> rather than 100%, and that is not a fudge: a
 * percentage background-position is measured against the picture overhanging its box, so 100% is the
 * <i>last</i> cell rather than one past it. Stepping to 100% in n steps therefore lands between
 * cells every time, which shows as two half frames at once.
 */
function sheetAnimations(satellite: OrbitSatellite, style: Style): string[] {
  if (satellite.sprite === null) return [];

  const { columns, frames, fps } = satellite.sprite;
  const rows = frames / columns;
  const running: string[] = [];

  if (columns > 1) {
    style["--ao-sheet-x"] = pct((100 * columns) / (columns - 1));
    running.push(`${SHEET_X_ANIMATION} ${(columns / fps) * 1000}ms steps(${columns}) infinite`);
  }

  if (rows > 1) {
    style["--ao-sheet-y"] = pct((100 * rows) / (rows - 1));
    running.push(`${SHEET_Y_ANIMATION} ${(frames / fps) * 1000}ms steps(${rows}) infinite`);
  }

  return running;
}

function sizeOf(satellite: OrbitSatellite): string {
  if (satellite.sprite === null) return "100% 100%";

  const { columns, frames } = satellite.sprite;

  return `${columns * 100}% ${(frames / columns) * 100}%`;
}

function cell(index: number, count: number): string {
  return count > 1 ? pct((index * 100) / (count - 1)) : "0%";
}

/**
 * When the figure turns round.
 *
 * It faces left for exactly half of every circuit, and which half depends on where the ring is
 * leaning: the moment its travel across the screen changes direction is <c>90° − atan2(ax, bx)</c>
 * round the circle, and the mirror is a square wave starting there. A delay is how a keyframe track
 * is moved to start somewhere else.
 */
function headingDelay(satellite: OrbitSatellite, basis: OrbitBasis): number {
  const { along, across } = facingAxis(satellite, basis);

  if (along === 0 && across === 0) return -satellite.phaseMs;

  const turn = 90 - degrees(Math.atan2(along, across));

  return -satellite.phaseMs + (satellite.periodMs * (((turn % 360) + 360) % 360) / 360);
}

/**
 * The travel, measured along the direction the figure is drawn pointing rather than along the screen.
 *
 * <b>Which way a figure is going is only a question about x for a figure that faces along x.</b>
 * This asked about horizontal travel outright, which is right for anything upright and wrong the
 * moment a figure is leaned: a creature pointing down a vertical ring turns round at the two moments
 * its <i>sideways</i> travel reverses, which on that ring is the middle of each pass across the face
 * — the most visible place there is. Projected onto its own heading instead, it turns where its
 * travel actually reverses, which on the same ring is where it goes behind the head.
 */
function facingAxis(satellite: OrbitSatellite, basis: OrbitBasis): { along: number; across: number } {
  const lean = radians(satellite.leanDeg);
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);

  return {
    along: (basis.ax * cos) + (basis.ay * sin),
    across: (basis.bx * cos) + (basis.by * sin),
  };
}

function facingBackwards(satellite: OrbitSatellite, basis: OrbitBasis, angle: number): boolean {
  const { along, across } = facingAxis(satellite, basis);

  return ((-along * Math.sin(angle)) + (across * Math.cos(angle))) < 0;
}

function timed(name: string, periodMs: number, delayMs: number, easing = "linear"): string {
  return `${name} ${Math.round(periodMs)}ms ${easing} ${Math.round(started(delayMs, periodMs))}ms infinite`;
}

/**
 * The same phase, expressed as an animation that is already underway rather than one that is
 * waiting.
 *
 * A positive delay is a wait, and a figure that waits is a figure sitting motionless at the start of
 * its path for up to a whole circuit after somebody opens a profile. Every phase here has an
 * equivalent negative delay a period further back, which begins immediately at the same point.
 */
function started(delayMs: number, periodMs: number): number {
  const offset = ((delayMs % periodMs) + periodMs) % periodMs;

  return offset === 0 ? 0 : offset - periodMs;
}

/** A measurement of the face, as a measurement of the box everything is drawn in. */
function toStage(pctOfFace: number, stage: OrbitStageBox): number {
  return (pctOfFace * 100) / stage.spanPct;
}

function mid(near: number, far: number): number {
  return (near + far) / 2;
}

function half(near: number, far: number): number {
  return (near - far) / 2;
}

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function degrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function pct(value: number): string {
  return `${n(value)}%`;
}

function n(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/**
 * The circle, sampled, plus the handful of square waves that go with it — put on the page once.
 *
 * <b>Generated here rather than written out, and still not data.</b> Every number in these rules is
 * a cosine; not one of them comes from a catalogue row. What a row carries is the custom properties
 * the rules multiply, which is the same line <c>frameMotion</c> draws for a frame's movements: the
 * vocabulary is code, the amounts are data. A row carrying keyframes would be CSS arriving from the
 * database onto everybody who opens a profile.
 *
 * Here rather than in the component's stylesheet because the rules that name these animations are
 * inline styles, and an inline style cannot see a scoped one.
 */
let keyframesInstalled = false;

export function installOrbitKeyframes(): void {
  if (keyframesInstalled || typeof document === "undefined") return;

  keyframesInstalled = true;

  const style = document.createElement("style");

  style.dataset.cosmeticAvatarOrbit = "";
  style.textContent = [
    pathKeyframes(),
    shadeKeyframes(),
    gateKeyframes(),
    courseKeyframes(),
    FIXED_KEYFRAMES,
  ].join("\n");

  document.head.appendChild(style);
}

function pathKeyframes(): string {
  return sampled(PATH_ANIMATION, (cos, sin) =>
    `transform: translate(${axis("--ao-ax", "--ao-bx", cos, sin)}, ${axis("--ao-ay", "--ao-by", cos, sin)})`
    + ` scale(${swing("--ao-scale-mid", "--ao-scale-swing", sin)});`);
}

function shadeKeyframes(): string {
  return sampled(SHADE_ANIMATION, (_, sin) =>
    `filter: brightness(${swing("--ao-light-mid", "--ao-light-swing", sin)})`
    + ` blur(${swing("--ao-blur-mid", "--ao-blur-swing", sin)});`
    + ` opacity: ${swing("--ao-veil-mid", "--ao-veil-swing", sin)};`);
}

/**
 * The five courses: how a figure that follows its path is turned at every point of the lap.
 *
 * <b>Unwrapped, which is the whole of the difficulty.</b> An angle read off `atan2` jumps from a
 * hundred and eighty to minus a hundred and eighty, and a keyframe told to go between those two
 * takes the long way round — the figure would spin a whole turn backwards in one step, twice a lap.
 * Kept climbing instead, each stop at least as large as the one before, so a lap is exactly one
 * turn and the track's end differs from its start by a whole revolution, which draws the same.
 */
function courseKeyframes(): string {
  const rules: string[] = [];

  for (let level = 0; level < COURSE_LEVELS; level++) {
    const flat = level / (COURSE_LEVELS - 1);
    const lines: string[] = [`@keyframes ${courseAnimation(level)} {`];
    let climbing = -720;

    for (let stop = 0; stop <= PATH_STOPS; stop++) {
      const angle = (stop / PATH_STOPS) * Math.PI * 2;
      let heading = degrees(Math.atan2(flat * Math.cos(angle), -Math.sin(angle)));

      while (heading < climbing) heading += 360;

      climbing = heading;

      lines.push(`  ${n((stop / PATH_STOPS) * 100)}% `
        + `{ transform: rotate(calc(var(--ao-lean) + ${n(heading)}deg)); }`);
    }

    lines.push("}");
    rules.push(lines.join("\n"));
  }

  return rules.join("\n");
}

function sampled(name: string, declare: (cos: number, sin: number) => string): string {
  const lines: string[] = [`@keyframes ${name} {`];

  for (let stop = 0; stop <= PATH_STOPS; stop++) {
    const angle = (stop / PATH_STOPS) * Math.PI * 2;

    lines.push(`  ${n((stop / PATH_STOPS) * 100)}% { ${declare(Math.cos(angle), Math.sin(angle))} }`);
  }

  lines.push("}");

  return lines.join("\n");
}

function axis(along: string, across: string, cos: number, sin: number): string {
  return `calc(var(${along}) * ${n(cos)} + var(${across}) * ${n(sin)})`;
}

function swing(middle: string, amount: string, sin: number): string {
  return `calc(var(${middle}) + var(${amount}) * ${n(sin)})`;
}

/**
 * Which half of the circuit each drawing belongs to — and the two are deliberately not mirror
 * images of each other.
 *
 * <b>The far drawing comes on hard and the near one sinks away.</b> Both are the same picture in the
 * same place at the moment of the swap, so the far one appearing changes nothing that can be seen:
 * everywhere outside the face it is already drawing exactly what the near one was. Which leaves the
 * fade to be seen only where the two differ — the part of the figure lying across the face, which is
 * precisely the part that is going behind it.
 *
 * A symmetrical crossfade would be wrong in both directions: two copies of one picture at half
 * opacity come out at three quarters rather than whole, so the whole figure would blink every time
 * it crossed, and the part over the face would still not sink.
 *
 * The near track therefore runs a little past its own half at each end — sinking after it, rising
 * before it — which is why it is generated rather than written out.
 */
function gateKeyframes(): string {
  return `@property --ao-veil {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 0%;
}

@keyframes ${NEAR_ANIMATION} {
  0%   { --ao-veil: var(--ao-veil-in); opacity: 1; }
  50%  { --ao-veil: var(--ao-veil-in); opacity: 1; }
  ${n(50 + SINK_PCT)}%     { --ao-veil: var(--ao-veil-out); opacity: 1; }
  ${n(50 + SINK_PCT)}.01%  { --ao-veil: var(--ao-veil-out); opacity: 0; }
  ${n(100 - SINK_PCT)}%    { --ao-veil: var(--ao-veil-out); opacity: 0; }
  ${n(100 - SINK_PCT)}.01% { --ao-veil: var(--ao-veil-out); opacity: 1; }
  100% { --ao-veil: var(--ao-veil-in); opacity: 1; }
}

@keyframes ${FAR_ANIMATION} {
  0%, 49.99%  { opacity: 0; }
  50%, 100%   { opacity: 1; }
}`;
}

/** The parts that are not a curve: the rise and fall, the ring's lean, the turn, and the strip. */
const FIXED_KEYFRAMES = `
@keyframes ${ROCK_ANIMATION} {
  0%, 100% { transform: rotate(calc(var(--ao-rock) * -1)); }
  50%      { transform: rotate(var(--ao-rock)); }
}

@keyframes ${BOB_ANIMATION} {
  0%, 100% { transform: translateY(calc(var(--ao-bob) * -1)); }
  50%      { transform: translateY(var(--ao-bob)); }
}

/*
 * Turning round, for anything drawn from the side.
 *
 * <b>Through zero rather than in one step.</b> A mirror applied in a single frame is a figure
 * that was facing one way and is now facing the other, which reads as a mistake; taken through
 * zero over a twentieth of a lap it narrows, disappears edge-on and opens out the other way, which
 * reads as a thing banking round. It costs one ramp and it is the difference between the two.
 *
 * The turn finishes on the moment the travel actually reverses, so the figure begins it just
 * before — which is also what anything turning round does.
 */
@keyframes ${HEADING_ANIMATION} {
  0%, 45%    { transform: scaleX(-1) rotate(var(--ao-lean)); }
  50%, 95%   { transform: scaleX(1) rotate(var(--ao-lean)); }
  100%       { transform: scaleX(-1) rotate(var(--ao-lean)); }
}

@keyframes ${SHEET_X_ANIMATION} {
  from { background-position-x: 0%; }
  to   { background-position-x: var(--ao-sheet-x); }
}

@keyframes ${SHEET_Y_ANIMATION} {
  from { background-position-y: 0%; }
  to   { background-position-y: var(--ao-sheet-y); }
}`;
