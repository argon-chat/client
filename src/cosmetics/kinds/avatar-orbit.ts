import { defineCosmeticKind } from "@/cosmetics/types";

/** A figure's picture read as a strip of frames rather than as one drawing. */
export interface OrbitSpriteSpec {
  readonly frames: number;
  readonly columns: number;
  readonly fps: number;

  /** The frame to stand on when nothing is moving. */
  readonly still: number;
}

/**
 * One figure travelling a ring around a face.
 *
 * Every measurement is a percentage of the face's own size, never a pixel. The same row is drawn at
 * 96 pixels on a profile and at 22 in a member list, and a pixel would make those two different
 * cosmetics.
 */
export interface OrbitSatellite {
  readonly type: "satellite";
  readonly slot: string;
  readonly sprite: OrbitSpriteSpec | null;

  /**
   * How far from the centre of the face it travels. Fifty is the edge of the face.
   *
   * <b>Past fifty plus half the figure is the number that matters, and it is the one thing here
   * that cannot be fudged.</b> The figure crosses from in front of the face to behind it at the two
   * points where it is furthest to the side. Whatever is lying over the face at that moment has to
   * be taken away, and taking away half a body reads as the body being eaten however smoothly it is
   * done. Clear of the face there and the crossing cannot be seen at all — and the figure still
   * travels over the picture, because that is what a high <c>tiltDeg</c> is for: the ring is flatter
   * than the face, so its near half lies across it while its ends stay outside the edge.
   */
  readonly radiusPct: number;

  /**
   * How far the ring is tipped out of the screen.
   *
   * Zero is a halo lying flat against the screen — a full circle, nothing ever behind anything.
   * Ninety is edge-on: a straight line across the face, half of it hidden.
   */
  readonly tiltDeg: number;

  /** How far the ring is leaned over on the screen. */
  readonly yawDeg: number;

  /**
   * How far the ring's lean rocks either side of that, and how long one rock takes.
   *
   * <b>What turns one circle into a sphere.</b> A figure on a fixed ring walks the same line for
   * ever; rocking the ring sweeps that line across the face and back, so the figure covers the whole
   * of it — and it leans with the ring, which is what anything walking on a curved surface does.
   *
   * A rock rather than a turn all the way round: a ring that kept going would carry the figure
   * upside down and hold it there for a quarter of every sweep.
   */
  readonly yawSwingDeg: number;
  readonly yawSwingMs: number;

  readonly periodMs: number;
  readonly phaseMs: number;
  readonly reverse: boolean;

  /** Where on the circuit it stands when nothing moves — reduced motion, or a face too small. */
  readonly stillDeg: number;

  readonly widthPct: number;
  readonly heightPct: number;
  readonly opacity: number;

  /**
   * Which way the picture points, before any turning: a lean for something upright, and the whole
   * heading for something seen from above.
   *
   * <b>It is also the axis the turn is measured along.</b> A figure drawn pointing down a vertical
   * ring reverses when its travel down that ring reverses, not when its sideways travel does — so
   * this is what decides where it turns as well as how it sits.
   */
  readonly leanDeg: number;

  /** Whether the picture is turned to face the way it is going. */
  readonly faceTravel: boolean;

  /**
   * How it turns round when it does: mirrored, or through half a circle.
   *
   * <b>Which one is right follows from how the picture was drawn, not from taste.</b> A creature
   * seen from the side turns round by being mirrored. One seen from above does not — mirrored, a
   * spider pointing down a vertical ring still points down, and it crawls backwards for half of
   * every lap. Half a circle points it back the way it came, which is what turning round is.
   */
  readonly turn: "mirror" | "spin";

  readonly nearScale: number;
  readonly farScale: number;

  /** How much brightness, opacity and focus it loses at the farthest point. */
  readonly dim: number;
  readonly haze: number;
  readonly blurPct: number;

  /** Whether the face hides it while it passes behind. Off makes it a light rather than an object. */
  readonly occlude: boolean;

  readonly bobPct: number;
  readonly bobPeriodMs: number;
}

export interface AvatarOrbitPayload {
  readonly satellites: readonly OrbitSatellite[];

  /**
   * The size of face below which the whole arrangement stands still. Zero — never.
   *
   * The sizes this decides between are not hypothetical: a message head is 36, a member row 34 and
   * the smallest face in the product 22. Anything above the number moves; anything at or below it
   * draws the frame at `stillDeg` and runs nothing at all.
   */
  readonly minSizePx: number;
}

/** As many as the console's own list editor holds, so a row it can build is a row this accepts. */
const MAX_SATELLITES = 8;
const MAX_RADIUS_PCT = 200;
const MAX_SIZE_PCT = 200;
const MAX_BLUR_PCT = 12;
const MAX_BOB_PCT = 50;
const MIN_PERIOD_MS = 240;
const MAX_PERIOD_MS = 120_000;
const MAX_SPRITE_FRAMES = 64;
const MIN_DEPTH_SCALE = 0.1;
const MAX_DEPTH_SCALE = 4;
const MAX_MIN_SIZE_PX = 512;

/**
 * Where a figure stands when it is standing still: the nearest point of its travel.
 *
 * In front of the face and below it, which is the pose that reads as a creature beside a head
 * rather than as a mark on one.
 */
const DEFAULT_STILL_DEG = 90;

/**
 * A ring lying almost flat, seen from a little above.
 *
 * <b>Flat is the interesting one, and it was not the obvious choice.</b> A shallow tilt is an
 * ellipse tall enough to clear the head, which is a figure circling a face. Past sixty the ellipse
 * is flatter than the face, so the figure spends its near half crossing the face itself and its far
 * half behind the head — on the avatar rather than around it, which is the whole reason for a kind
 * that can put something behind a head.
 */
const DEFAULT_TILT_DEG = 62;

/**
 * Nothing, so an arrangement moves wherever it is drawn until somebody decides otherwise.
 *
 * <b>A renderer that quietly stopped animating below some size would be a cosmetic that is live,
 * correct and invisible</b>, with nothing anywhere to say why — the same failure `CosmeticKindGate`
 * refuses for a kind's own switch. Whether a figure is worth running on a face 22 pixels across
 * depends on what was drawn on it, so it is a number in the row rather than a rule in here.
 */
const DEFAULT_MIN_SIZE_PX = 0;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function num(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/** A number that has to be there for the figure to mean anything, or null. */
function required(raw: unknown, low: number, high: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw < low || raw > high) return null;

  return raw;
}

function spriteOf(raw: unknown): OrbitSpriteSpec | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const frames = Math.round(num(value.frames, 0));
  const columns = Math.round(num(value.columns, 0));

  if (frames < 2 || frames > MAX_SPRITE_FRAMES) return null;
  if (columns < 1 || columns > frames || frames % columns !== 0) return null;

  const still = Math.round(num(value.still, 0));

  return {
    frames,
    columns,
    fps: clamp(Math.round(num(value.fps, 12)), 1, 60),
    still: still >= 0 && still < frames ? still : 0,
  };
}

function satelliteOf(raw: unknown): OrbitSatellite | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;

  if (value.type !== "satellite") return null;
  if (typeof value.slot !== "string" || value.slot.length === 0) return null;

  const radiusPct = required(value.radiusPct, 0, MAX_RADIUS_PCT);
  const widthPct = required(value.widthPct, 1, MAX_SIZE_PCT);
  const heightPct = required(value.heightPct, 1, MAX_SIZE_PCT);
  const periodMs = required(value.periodMs, MIN_PERIOD_MS, MAX_PERIOD_MS);

  if (radiusPct === null || widthPct === null || heightPct === null || periodMs === null) return null;

  return {
    type: "satellite",
    slot: value.slot,
    sprite: spriteOf(value.sprite),

    radiusPct,
    tiltDeg: clamp(num(value.tiltDeg, DEFAULT_TILT_DEG), 0, 90),
    yawDeg: clamp(num(value.yawDeg, 0), -180, 180),
    yawSwingDeg: clamp(num(value.yawSwingDeg, 0), 0, 180),
    yawSwingMs: clamp(Math.round(num(value.yawSwingMs, 12_000)), MIN_PERIOD_MS, MAX_PERIOD_MS),
    periodMs: Math.round(periodMs),
    phaseMs: clamp(Math.round(num(value.phaseMs, 0)), -MAX_PERIOD_MS, MAX_PERIOD_MS),
    reverse: value.reverse === true,
    stillDeg: clamp(num(value.stillDeg, DEFAULT_STILL_DEG), 0, 360),

    widthPct,
    heightPct,
    opacity: clamp(num(value.opacity, 1), 0.05, 1),
    leanDeg: clamp(num(value.leanDeg, 0), -180, 180),
    faceTravel: value.faceTravel !== false,
    turn: value.turn === "spin" ? "spin" : "mirror",

    nearScale: clamp(num(value.nearScale, 1.15), MIN_DEPTH_SCALE, MAX_DEPTH_SCALE),
    farScale: clamp(num(value.farScale, 0.78), MIN_DEPTH_SCALE, MAX_DEPTH_SCALE),
    dim: clamp(num(value.dim, 0.35), 0, 1),
    haze: clamp(num(value.haze, 0.15), 0, 1),
    blurPct: clamp(num(value.blurPct, 0), 0, MAX_BLUR_PCT),
    occlude: value.occlude !== false,

    bobPct: clamp(num(value.bobPct, 0), 0, MAX_BOB_PCT),
    bobPeriodMs: clamp(Math.round(num(value.bobPeriodMs, 900)), MIN_PERIOD_MS, MAX_PERIOD_MS),
  };
}

/**
 * Figures travelling a ring around a face, hidden by it as they pass behind.
 *
 * <b>Not an avatar decoration with more numbers.</b> A decoration is one picture composited with the
 * face at a size, and a picture is one layer — there is no inset, opacity or z-order that puts half
 * of it behind a head and the other half in front. This kind carries bodies with positions in three
 * dimensions, and occlusion is the thing it can say that nothing else can.
 *
 * Which is why it stacks with that one instead of replacing it: a ring of thorns that never moves
 * should not have to carry twenty numbers about depth in order to say so.
 */
export default defineCosmeticKind<AvatarOrbitPayload>({
  key: "avatar.orbit",
  surfaces: ["avatar"],
  primitive: "orbitStage",
  layer: 250,
  scope: "both",
  labelKey: "cosmetic_kind_avatar_orbit",

  /**
   * A figure this build cannot read is dropped and the rest are kept.
   *
   * The same judgement the frame makes, for the same reason: an orbit authored against a newer
   * build is most likely one whose cat this build understands and whose second creature it does
   * not, and drawing the cat is closer to what its wearer chose than drawing nothing.
   */
  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as { satellites?: unknown; minSizePx?: unknown };

    if (!Array.isArray(value.satellites)) return null;

    const satellites: OrbitSatellite[] = [];

    for (const candidate of value.satellites.slice(0, MAX_SATELLITES)) {
      const satellite = satelliteOf(candidate);

      if (satellite !== null) satellites.push(satellite);
    }

    if (satellites.length === 0) return null;

    return {
      satellites,
      minSizePx: clamp(Math.round(num(value.minSizePx, DEFAULT_MIN_SIZE_PX)), 0, MAX_MIN_SIZE_PX),
    };
  },
});
