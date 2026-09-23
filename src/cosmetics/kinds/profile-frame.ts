import type { CosmeticEdges, CosmeticSides } from "@/cosmetics/edges";

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
 * numbers, names from a closed set, and the slots of uploaded files. So a new frame is a row
 * somebody creates in the console, and this file does not grow when one is added.
 *
 * <b>This file is the payload and nothing else.</b> What the payload means to the wardrobe — its
 * key, its surfaces, the component that draws it — arrives with the kind module, which needs the
 * wire contract. The parsing and the arithmetic do not, and they are the half worth having tests
 * for.
 */

/** Four numbers — top, right, bottom, left — in that order, as every box in CSS is written. */
export type FrameSides = readonly [number, number, number, number];

export type FrameAnchor =
  | "topLeft" | "top" | "topRight"
  | "left" | "center" | "right"
  | "bottomLeft" | "bottom" | "bottomRight";

export type FrameRepeat = "stretch" | "repeat" | "round" | "space";

/**
 * Which of the item's files a part draws.
 *
 * The same word the server writes into the asset map's key, so that a part naming `primary` finds
 * the file stored under `primary`. Ordinal rather than named after a role: the role is the
 * payload's to say, and a slot called `surround` would be one kind's vocabulary in a name every
 * kind shares.
 */
export type FrameSlot = "primary" | "secondary" | "tertiary" | "quaternary";

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

  /** How solid the part is, in whole percent. Never below five: invisible is not a choice. */
  readonly opacityPct: number;

  readonly inset: FrameSides;
  readonly motion: FrameMotionSpec | null;
}

/** A picture wrapped round the card as a nine-slice. */
export interface FrameSurroundPart extends FramePartCommon {
  readonly type: "surround";
  readonly slot: FrameSlot;
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
  readonly slot: FrameSlot;
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

  /** ARGB, one to four of them. A list of integers, never hex strings. */
  readonly colors: readonly number[];

  readonly angle: number;

  /** How far the colour bleeds past the edge, in whole percent. Zero is a clean line. */
  readonly glowPct: number;
}

export type FramePart = FrameSurroundPart | FramePropPart | FrameRingPart;

export interface ProfileFramePayload {
  readonly parts: readonly FramePart[];
}

export const MAX_PARTS = 8;
export const MAX_OUTSET = 96;

const MAX_WIDTH = 64;
const MAX_INSET = 64;
const MAX_SLICE = 512;
const MAX_PROP_SIZE = 512;
const MAX_OFFSET = 256;
const MAX_SPRITE_FRAMES = 64;
const MAX_RING_COLORS = 4;

const ANCHORS: readonly string[] = [
  "topLeft", "top", "topRight",
  "left", "center", "right",
  "bottomLeft", "bottom", "bottomRight",
];

const REPEATS: readonly string[] = ["stretch", "repeat", "round", "space"];
const SLOTS: readonly string[] = ["primary", "secondary", "tertiary", "quaternary"];

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
    amount: clamp(Math.round(num(value.amount, 0)), -360, 360),
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
    opacityPct: clamp(Math.round(num(value.opacityPct, 100)), 5, 100),
    inset: sides(value.inset, 0, MAX_INSET) ?? ZERO,
    motion: motionOf(value.motion),
  };
}

function slotOf(value: Record<string, unknown>): FrameSlot | null {
  return typeof value.slot === "string" && SLOTS.includes(value.slot)
    ? value.slot as FrameSlot
    : null;
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
      ? value.colors.filter(colour => typeof colour === "number" && Number.isFinite(colour)) as number[]
      : [];

    if (colors.length === 0 || colors.length > MAX_RING_COLORS) return null;

    return {
      ...common,
      type: "ring",
      thickness: clamp(Math.round(num(value.thickness, 2)), 1, 8),
      colors,
      angle: clamp(Math.round(num(value.angle, 135)), 0, 360),
      glowPct: clamp(Math.round(num(value.glowPct, 0)), 0, 100),
    };
  }

  return null;
}

/**
 * How far a ring's glow spreads past the edge, in pixels at full size.
 *
 * Three thicknesses at full strength, scaled by `glowPct`. One function because two readers need
 * it — the paint that draws the glow and the reach a host reserves room for — and a glow that is
 * drawn wider than the room kept for it is clipped by whatever sits beside the card.
 */
export function ringGlowRadius(part: FrameRingPart): number {
  // Multiplied before it is divided: 9 * 0.6 is 5.3999999999999995 in floating point, and that
  // string would reach the style attribute.
  return (part.thickness * 3 * part.glowPct) / 100;
}

/**
 * A part this build cannot read is dropped and the rest are kept.
 *
 * Deliberately not all-or-nothing. A frame authored against a newer build is most likely one whose
 * band this build understands and whose fourth piece it does not, and drawing the band is closer to
 * what its wearer chose than drawing nothing at all.
 */
export function parseProfileFramePayload(raw: unknown): ProfileFramePayload | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as { parts?: unknown };

  if (!Array.isArray(value.parts)) return null;

  const parts: FramePart[] = [];

  for (const candidate of value.parts.slice(0, MAX_PARTS)) {
    const part = partOf(candidate);

    if (part !== null) parts.push(part);
  }

  return parts.length > 0 ? { parts } : null;
}

/** How far the frame pushes the card's own content in, per side. */
export function frameInsets(payload: ProfileFramePayload): CosmeticEdges {
  return widestOf(payload.parts, part => ({
    top: part.inset[0],
    right: part.inset[1],
    bottom: part.inset[2],
    left: part.inset[3],
  }));
}

/** How far the frame reaches outside the card, per side, so a host can reserve the room. */
export function frameOutsets(payload: ProfileFramePayload): CosmeticEdges {
  return widestOf(payload.parts, reachOf);
}

/**
 * A band covers the sides it is thick on; a ring covers all four, being the edge itself.
 *
 * A piece hung off a corner covers nothing: it sits at one point and the card's edge runs on past
 * it in both directions, so hiding an edge for it would take away more than the piece replaces.
 */
export function frameHidesEdges(payload: ProfileFramePayload): CosmeticSides {
  let top = false;
  let right = false;
  let bottom = false;
  let left = false;

  for (const part of payload.parts) {
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
}

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
 * <b>What a host reserves, not what the server accepts.</b> The server bounds a part against the
 * smallest card it could ever be drawn on, because it has to answer before anybody is looking; this
 * runs where the real card is, so a piece centred on an edge is counted as reaching only in the
 * direction it was pinned. The two are allowed to differ, and the strict one is the one that
 * decides what may be published.
 */
function reachOf(part: FramePart): CosmeticEdges {
  if (part.type === "surround") {
    return { top: part.outset[0], right: part.outset[1], bottom: part.outset[2], left: part.outset[3] };
  }

  if (part.type === "ring") {
    // What the glow's drop-shadow spreads to, which is the only way a ring leaves the card.
    // Rounded up, so the room reserved is never a fraction short of what is drawn.
    const glow = Math.ceil(ringGlowRadius(part));

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
