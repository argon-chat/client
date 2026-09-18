import { defineCosmeticKind, type CosmeticEdges, type CosmeticSides } from "@/cosmetics/types";

/**
 * Four numbers — top, right, bottom, left — in that order, as every box in CSS is written.
 */
export type FrameSides = readonly [number, number, number, number];

export type FrameAnchor =
  | "topLeft" | "top" | "topRight"
  | "left" | "center" | "right"
  | "bottomLeft" | "bottom" | "bottomRight";

export type FrameRepeat = "stretch" | "repeat" | "round" | "space";

export interface FrameMotionSpec {
  /** Names a file under `motions/`. One this build does not have simply does not move the part. */
  readonly kind: string;
  readonly amount: number;
  readonly periodMs: number;
  readonly phaseMs: number;
}

export interface FrameSpriteSpec {
  readonly frames: number;
  readonly columns: number;
  readonly fps: number;

  /** The frame to stand on when movement is off. */
  readonly still: number;
}

interface FramePartCommon {
  readonly over: boolean;
  readonly opacity: number;
  readonly inset: FrameSides;
  readonly motion: FrameMotionSpec | null;
}

/** A picture wrapped round the card as a nine-slice. */
export interface FrameSurroundPart extends FramePartCommon {
  readonly type: "surround";
  readonly slot: string;
  readonly slice: FrameSides;

  /**
   * How thick the band is per side, and therefore the frame's shape: a side of zero is a side with
   * no band on it.
   */
  readonly width: FrameSides;

  readonly outset: FrameSides;
  readonly repeat: FrameRepeat;
  readonly fill: boolean;
}

/** A picture at its own size, hung off one of the card's nine points. */
export interface FramePropPart extends FramePartCommon {
  readonly type: "prop";
  readonly slot: string;
  readonly anchor: FrameAnchor;
  readonly w: number;
  readonly h: number;
  readonly dx: number;
  readonly dy: number;
  readonly sprite: FrameSpriteSpec | null;
}

/** The painted border, and the only part that needs no file. */
export interface FrameRingPart extends FramePartCommon {
  readonly type: "ring";
  readonly thickness: number;
  readonly colors: readonly number[];
  readonly angle: number;
  readonly glow: number;
}

export type FramePart = FrameSurroundPart | FramePropPart | FrameRingPart;

export interface ProfileFramePayload {
  readonly parts: readonly FramePart[];
}

const MAX_PARTS = 8;
const MAX_OUTSET = 96;
const MAX_WIDTH = 64;
const MAX_INSET = 64;
const MAX_SLICE = 512;
const MAX_PROP_SIZE = 512;
const MAX_OFFSET = 256;
const MAX_SPRITE_FRAMES = 64;

const ANCHORS: readonly string[] = [
  "topLeft", "top", "topRight",
  "left", "center", "right",
  "bottomLeft", "bottom", "bottomRight",
];

const REPEATS: readonly string[] = ["stretch", "repeat", "round", "space"];

const ZERO: FrameSides = [0, 0, 0, 0];

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function num(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Four numbers, clamped, or null when what arrived was not four numbers.
 *
 * Null rather than a filled-in default for a side list that is wrong: a band whose thicknesses did
 * not arrive has no shape, and guessing one draws something nobody authored.
 */
function sides(raw: unknown, low: number, high: number): FrameSides | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;

  const read: number[] = [];

  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;

    read.push(clamp(Math.round(value), low, high));
  }

  return [read[0], read[1], read[2], read[3]];
}

function motionOf(raw: unknown): FrameMotionSpec | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;

  if (typeof value.kind !== "string" || value.kind.length === 0) return null;

  return {
    kind: value.kind,
    amount: clamp(num(value.amount, 0), -360, 360),
    periodMs: clamp(Math.round(num(value.periodMs, 4000)), 120, 120_000),
    phaseMs: clamp(Math.round(num(value.phaseMs, 0)), -120_000, 120_000),
  };
}

function spriteOf(raw: unknown): FrameSpriteSpec | null {
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

function commonOf(value: Record<string, unknown>): FramePartCommon {
  return {
    over: value.over !== false,
    opacity: clamp(num(value.opacity, 1), 0.05, 1),
    inset: sides(value.inset, 0, MAX_INSET) ?? ZERO,
    motion: motionOf(value.motion),
  };
}

function slotOf(value: Record<string, unknown>): string | null {
  return typeof value.slot === "string" && value.slot.length > 0 ? value.slot : null;
}

function partOf(raw: unknown): FramePart | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  const common = commonOf(value);

  if (value.type === "surround") {
    const slot = slotOf(value);
    const slice = sides(value.slice, 0, MAX_SLICE);
    const width = sides(value.width, 0, MAX_WIDTH);

    if (slot === null || slice === null || width === null) return null;
    if (width[0] + width[1] + width[2] + width[3] === 0) return null;

    const repeat = typeof value.repeat === "string" && REPEATS.includes(value.repeat)
      ? value.repeat as FrameRepeat
      : "stretch";

    return {
      ...common,
      type: "surround",
      slot,
      slice,
      width,
      outset: sides(value.outset, 0, MAX_OUTSET) ?? ZERO,
      repeat,
      fill: value.fill === true,
    };
  }

  if (value.type === "prop") {
    const slot = slotOf(value);

    if (slot === null) return null;
    if (typeof value.anchor !== "string" || !ANCHORS.includes(value.anchor)) return null;

    const w = Math.round(num(value.w, 0));
    const h = Math.round(num(value.h, 0));

    if (w < 1 || w > MAX_PROP_SIZE || h < 1 || h > MAX_PROP_SIZE) return null;

    return {
      ...common,
      type: "prop",
      slot,
      anchor: value.anchor as FrameAnchor,
      w,
      h,
      dx: clamp(Math.round(num(value.dx, 0)), -MAX_OFFSET, MAX_OFFSET),
      dy: clamp(Math.round(num(value.dy, 0)), -MAX_OFFSET, MAX_OFFSET),
      sprite: spriteOf(value.sprite),
    };
  }

  if (value.type === "ring") {
    const colors = Array.isArray(value.colors)
      ? value.colors.filter(colour => typeof colour === "number") as number[]
      : [];

    if (colors.length === 0 || colors.length > 4) return null;

    return {
      ...common,
      type: "ring",
      thickness: clamp(Math.round(num(value.thickness, 2)), 1, 8),
      colors,
      angle: clamp(Math.round(num(value.angle, 135)), 0, 360),
      glow: clamp(num(value.glow, 0), 0, 1),
    };
  }

  return null;
}

/**
 * A border around a profile card, assembled out of parts an operator arranged with numbers.
 *
 * <b>Not a border drawn as four numbers, which is what this was.</b> A width, some colours, an angle
 * and a glow describe exactly one shape — a coloured edge — and the shapes people actually want are
 * a band round the whole card, a band along its top alone, and something hanging over its edge. That
 * coloured edge is still here as a `ring` part; it is now one thing a frame may contain rather than
 * the only thing a frame may be.
 *
 * Which parts exist, where they sit, how far they hang outside the card and how they move are all
 * numbers and the names of uploaded files. So a new frame is a row somebody creates in the console,
 * and this file does not grow when one is added.
 */
export default defineCosmeticKind<ProfileFramePayload>({
  key: "profile.frame",
  surfaces: ["profileCard", "ownProfile"],
  primitive: "frameAssembly",
  layer: 600,
  scope: "both",
  labelKey: "cosmetic_kind_profile_frame",

  /**
   * A part this build cannot read is dropped and the rest are kept.
   *
   * Deliberately not all-or-nothing. A frame authored against a newer build is most likely one whose
   * band this build understands and whose fourth piece it does not, and drawing the band is closer
   * to what its wearer chose than drawing nothing at all.
   */
  parsePayload(raw) {
    if (typeof raw !== "object" || raw === null) return null;

    const value = raw as { parts?: unknown };

    if (!Array.isArray(value.parts)) return null;

    const parts: FramePart[] = [];

    for (const candidate of value.parts.slice(0, MAX_PARTS)) {
      const part = partOf(candidate);

      if (part !== null) parts.push(part);
    }

    return parts.length > 0 ? { parts } : null;
  },

  insetsOf(item): CosmeticEdges {
    return widestOf(item.payload.parts, part => ({
      top: part.inset[0],
      right: part.inset[1],
      bottom: part.inset[2],
      left: part.inset[3],
    }));
  },

  outsetsOf(item): CosmeticEdges {
    return widestOf(item.payload.parts, reachOf);
  },

  /**
   * A band covers the sides it is thick on; a ring covers all four, being the edge itself.
   *
   * A piece hung off a corner covers nothing: it sits at one point and the card's edge runs on past
   * it in both directions, so hiding an edge for it would take away more than the piece replaces.
   */
  hidesEdges(item): CosmeticSides {
    let top = false;
    let right = false;
    let bottom = false;
    let left = false;

    for (const part of item.payload.parts) {
      if (part.type === "ring") {
        top = right = bottom = left = true;
        continue;
      }

      if (part.type !== "surround") continue;

      top ||= part.width[0] > 0;
      right ||= part.width[1] > 0;
      bottom ||= part.width[2] > 0;
      left ||= part.width[3] > 0;
    }

    return { top, right, bottom, left };
  },
});

function widestOf(parts: readonly FramePart[], ask: (part: FramePart) => CosmeticEdges): CosmeticEdges {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;

  for (const part of parts) {
    const asked = ask(part);

    top = Math.max(top, asked.top);
    right = Math.max(right, asked.right);
    bottom = Math.max(bottom, asked.bottom);
    left = Math.max(left, asked.left);
  }

  return { top, right, bottom, left };
}

/**
 * How far one part reaches past the card's edge.
 *
 * The same arithmetic the server holds a row to before it will accept it, kept here because a host
 * reserving room needs the answer and cannot ask the server for it.
 *
 * A piece hung off the middle of an edge is counted as reaching only in that direction. How far it
 * goes sideways depends on how wide the card turns out to be, which is not a thing the row can know
 * — and a card too narrow for the pieces hung under it is a frame authored badly, not a layout to
 * defend against.
 */
function reachOf(part: FramePart): CosmeticEdges {
  if (part.type === "surround") {
    return { top: part.outset[0], right: part.outset[1], bottom: part.outset[2], left: part.outset[3] };
  }

  if (part.type === "ring") {
    // What the glow's drop-shadow spreads to, which is the only way a ring leaves the card.
    const glow = part.glow > 0 ? part.thickness * 3 : 0;

    return { top: glow, right: glow, bottom: glow, left: glow };
  }

  const { anchor, w, h, dx, dy } = part;

  return {
    top: anchor.startsWith("top") ? Math.max(0, h - dy) : 0,
    bottom: anchor.startsWith("bottom") ? Math.max(0, h + dy) : 0,
    left: anchor === "left" || anchor === "topLeft" || anchor === "bottomLeft" ? Math.max(0, w - dx) : 0,
    right: anchor === "right" || anchor === "topRight" || anchor === "bottomRight" ? Math.max(0, w + dx) : 0,
  };
}
