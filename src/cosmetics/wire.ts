import {
  AssetSlot,
  FrameAnchor as WireFrameAnchor,
  FrameRepeat as WireFrameRepeat,
  NicknameGradientShape as WireGradientShape,
  WornItem,
  WornNickname,
  type CosmeticAsset,
  type FrameMotion as WireFrameMotion,
  type FrameProp,
  type FrameRing,
  type FrameSides as WireFrameSides,
  type FrameSprite as WireFrameSprite,
  type FrameSurround,
  type ICosmeticPayload,
  type IFramePart,
  type PayloadAvatarDecoration,
  type PayloadFont,
  type PayloadProfileFrame,
} from "@argon/glue";

import {
  parseAvatarDecorationPayload,
  type AvatarDecorationPayload,
} from "@/cosmetics/kinds/avatar-decoration";
import {
  parseNicknameStyleTuning,
  type NicknameGradientShape,
  type NicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import {
  parseFontOptionPayload,
  type FontOptionPayload,
} from "@/cosmetics/kinds/option-font";
import {
  parseTextEffectOptionPayload,
  type TextEffectOptionPayload,
} from "@/cosmetics/kinds/option-text-effect";
import {
  parseProfileFramePayload,
  type FrameAnchor,
  type FrameRepeat,
  type FrameSides,
  type FrameSlot,
  type ProfileFramePayload,
} from "@/cosmetics/kinds/profile-frame";
import type { CosmeticFacet } from "@/cosmetics/types";
import { unionKeyOf } from "@/cosmetics/wornEntry";

export type CosmeticAssets = Readonly<Partial<Record<FrameSlot, string>>>;

/** The axes a worn nickname composes, keyed by the facet id its kind declares. */
export type NicknameAxes = Readonly<Record<CosmeticFacet["id"], string | null>>;

const SLOT_NAMES: ReadonlyMap<AssetSlot, FrameSlot> = new Map([
  [AssetSlot.Primary, "primary"],
  [AssetSlot.Secondary, "secondary"],
  [AssetSlot.Tertiary, "tertiary"],
  [AssetSlot.Quaternary, "quaternary"],
]);

const ANCHOR_NAMES: ReadonlyMap<WireFrameAnchor, FrameAnchor> = new Map([
  [WireFrameAnchor.TopLeft, "topLeft"],
  [WireFrameAnchor.Top, "top"],
  [WireFrameAnchor.TopRight, "topRight"],
  [WireFrameAnchor.Left, "left"],
  [WireFrameAnchor.Center, "center"],
  [WireFrameAnchor.Right, "right"],
  [WireFrameAnchor.BottomLeft, "bottomLeft"],
  [WireFrameAnchor.Bottom, "bottom"],
  [WireFrameAnchor.BottomRight, "bottomRight"],
]);

const REPEAT_NAMES: ReadonlyMap<WireFrameRepeat, FrameRepeat> = new Map([
  [WireFrameRepeat.Stretch, "stretch"],
  [WireFrameRepeat.Repeat, "repeat"],
  [WireFrameRepeat.Round, "round"],
  [WireFrameRepeat.Space, "space"],
]);

const SHAPE_NAMES: ReadonlyMap<WireGradientShape, NicknameGradientShape> = new Map([
  [WireGradientShape.Linear, "linear"],
  [WireGradientShape.Radial, "radial"],
  [WireGradientShape.Conic, "conic"],
]);

const SHAPE_VALUES: ReadonlyMap<NicknameGradientShape, WireGradientShape> = new Map([
  ["linear", WireGradientShape.Linear],
  ["radial", WireGradientShape.Radial],
  ["conic", WireGradientShape.Conic],
]);

const NO_SIDES: FrameSides = [0, 0, 0, 0];

export function slotName(slot: AssetSlot): FrameSlot | null {
  return SLOT_NAMES.get(slot) ?? null;
}

export function anchorName(anchor: WireFrameAnchor): FrameAnchor | null {
  return ANCHOR_NAMES.get(anchor) ?? null;
}

export function repeatName(repeat: WireFrameRepeat): FrameRepeat | null {
  return REPEAT_NAMES.get(repeat) ?? null;
}

export function shapeName(shape: WireGradientShape | null): NicknameGradientShape | null {
  if (shape === null) {
    return null;
  }

  return SHAPE_NAMES.get(shape) ?? null;
}

export function shapeValue(shape: NicknameGradientShape | null): WireGradientShape | null {
  if (shape === null) {
    return null;
  }

  return SHAPE_VALUES.get(shape) ?? null;
}

export function sidesOf(sides: WireFrameSides | null | undefined): FrameSides | null {
  if (typeof sides !== "object" || sides === null) {
    return null;
  }

  return [sides.top, sides.right, sides.bottom, sides.left];
}

export function assetsOf(assets: readonly CosmeticAsset[] | null | undefined): CosmeticAssets {
  const bySlot: Partial<Record<FrameSlot, string>> = {};

  for (const asset of assets ?? []) {
    const slot = slotName(asset.slot);

    if (slot !== null && typeof asset.fileId === "string" && asset.fileId.length > 0) {
      bySlot[slot] = asset.fileId;
    }
  }

  return bySlot;
}

function motionOf(motion: WireFrameMotion | null | undefined): Record<string, unknown> | null {
  if (typeof motion !== "object" || motion === null) {
    return null;
  }

  return {
    kind: motion.kind,
    amount: motion.amount,
    periodMs: motion.periodMs,
    phaseMs: motion.phaseMs,
  };
}

function spriteOf(sprite: WireFrameSprite | null | undefined): Record<string, unknown> | null {
  if (typeof sprite !== "object" || sprite === null) {
    return null;
  }

  return {
    frames: sprite.frames,
    columns: sprite.columns,
    fps: sprite.fps,
    still: sprite.still,
  };
}

function commonOf(part: IFramePart): Record<string, unknown> {
  return {
    over: part.over,
    opacityPct: part.opacityPct,
    inset: sidesOf(part.inset) ?? NO_SIDES,
    motion: motionOf(part.motion),
  };
}

function surroundOf(part: FrameSurround): Record<string, unknown> {
  return {
    ...commonOf(part),
    type: "surround",
    slot: slotName(part.slot),
    slice: sidesOf(part.slice),
    width: sidesOf(part.width),
    outset: sidesOf(part.outset) ?? NO_SIDES,
    repeat: repeatName(part.repeat),
    fill: part.fill,
  };
}

function propOf(part: FrameProp): Record<string, unknown> {
  return {
    ...commonOf(part),
    type: "prop",
    slot: slotName(part.slot),
    anchor: anchorName(part.anchor),
    w: part.w,
    h: part.h,
    dx: part.dx,
    dy: part.dy,
    sprite: spriteOf(part.sprite),
  };
}

function ringOf(part: FrameRing): Record<string, unknown> {
  return {
    ...commonOf(part),
    type: "ring",
    thickness: part.thickness,
    colors: Array.isArray(part.colors) ? [...part.colors] : [],
    angle: part.angle,
    glowPct: part.glowPct,
  };
}

/** One part as the upstream parser reads it, or null for a part type this build does not know. */
export function framePartOf(part: IFramePart): Record<string, unknown> | null {
  switch (unionKeyOf(part)) {
    case "FrameSurround":
      return surroundOf(part as FrameSurround);

    case "FrameProp":
      return propOf(part as FrameProp);

    case "FrameRing":
      return ringOf(part as FrameRing);

    default:
      return null;
  }
}

export function avatarDecorationOf(payload: ICosmeticPayload | null | undefined): AvatarDecorationPayload | null {
  if (unionKeyOf(payload) !== "PayloadAvatarDecoration") {
    return null;
  }

  const decoration = payload as PayloadAvatarDecoration;

  return parseAvatarDecorationPayload({
    insetPct: decoration.insetPct,
    beneath: decoration.beneath,
  });
}

export function profileFrameOf(payload: ICosmeticPayload | null | undefined): ProfileFramePayload | null {
  if (unionKeyOf(payload) !== "PayloadProfileFrame") {
    return null;
  }

  const frame = payload as PayloadProfileFrame;

  if (!Array.isArray(frame.parts)) {
    return null;
  }

  const parts: Array<Record<string, unknown> | null> = [];

  for (const part of frame.parts) {
    parts.push(framePartOf(part));
  }

  return parseProfileFramePayload({ parts });
}

export function fontOptionOf(payload: ICosmeticPayload | null | undefined): FontOptionPayload | null {
  if (unionKeyOf(payload) !== "PayloadFont") {
    return null;
  }

  return parseFontOptionPayload({ cssFamily: (payload as PayloadFont).cssFamily });
}

export function textEffectOptionOf(payload: ICosmeticPayload | null | undefined): TextEffectOptionPayload | null {
  if (unionKeyOf(payload) !== "PayloadTextEffect") {
    return null;
  }

  return parseTextEffectOptionPayload({});
}

/** The wearer's own part of a nickname look, bounded, or null when the server sent more than a client may draw. */
export function tuningOf(worn: WornNickname): NicknameStyleTuning | null {
  return parseNicknameStyleTuning({
    colors: worn.colors,
    angle: worn.angle,
    shape: shapeName(worn.shape),
    animate: worn.animate,
    weight: worn.weight,
    letterSpacingCentiEm: worn.letterSpacing,
  });
}

export function nicknameAxesOf(worn: WornNickname): NicknameAxes {
  return {
    font: worn.font ?? null,
    effect: worn.effect ?? null,
  };
}

export function toWornItem(itemId: string): WornItem {
  return new WornItem(itemId);
}

export function toWornNickname(axes: NicknameAxes, tuning: NicknameStyleTuning): WornNickname {
  return new WornNickname(
    axes.font,
    axes.effect,
    tuning.colors === null ? null : [...tuning.colors],
    tuning.angle,
    shapeValue(tuning.shape),
    tuning.animate,
    tuning.weight,
    tuning.letterSpacingCentiEm,
  );
}
