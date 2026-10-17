import type { IWornCosmetic } from "@argon/glue";

import {
  emptyNicknameStyleTuning,
  isNicknameStyleTuningEmpty,
  type NicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import {
  nicknameAxesOf,
  toWornNickname,
  tuningOf,
  type NicknameAxes,
} from "@/cosmetics/wire";
import { asWornNickname } from "@/cosmetics/wornEntry";

import {
  equipChange,
  unequipChange,
  type WardrobeChange,
} from "./wardrobeChange";

/** A nickname look being edited: the two axis rows and the wearer's own tuning. */
export interface NicknameDraft {
  readonly axes: NicknameAxes;
  readonly tuning: NicknameStyleTuning;
}

/** Whether an axis row can still be offered: present in the catalogue, of the facet's kind, and switched on. */
export type AxisOffered = (axis: keyof NicknameAxes, optionId: string) => boolean;

const OFFERS_EVERYTHING: AxisOffered = () => true;

export function emptyNicknameDraft(): NicknameDraft {
  return {
    axes: { font: null, effect: null },
    tuning: emptyNicknameStyleTuning(),
  };
}

function offeredOrNull(axis: keyof NicknameAxes, optionId: string | null, isOffered: AxisOffered): string | null {
  if (optionId === null || !isOffered(axis, optionId)) {
    return null;
  }

  return optionId;
}

/**
 * The draft a worn entry opens as; anything that is not a readable nickname opens empty. An axis row
 * the picker cannot offer is dropped, so the next Apply does not send it back.
 */
export function nicknameDraftOf(worn: IWornCosmetic | null, isOffered: AxisOffered = OFFERS_EVERYTHING): NicknameDraft {
  const nickname = asWornNickname(worn);

  if (nickname === null) {
    return emptyNicknameDraft();
  }

  const axes = nicknameAxesOf(nickname);

  return {
    axes: {
      font: offeredOrNull("font", axes.font, isOffered),
      effect: offeredOrNull("effect", axes.effect, isOffered),
    },
    tuning: tuningOf(nickname) ?? emptyNicknameStyleTuning(),
  };
}

/** Angle, shape and motion only show on a gradient or under an effect; the picker hides them otherwise. */
export function isNicknameDraftAimable(draft: NicknameDraft): boolean {
  return (draft.tuning.colors?.length ?? 0) > 1 || draft.axes.effect !== null;
}

/** The tuning as the wearer can see it: an aim the picker hides is not saved as an invisible look. */
function visibleTuning(draft: NicknameDraft): NicknameStyleTuning {
  if (isNicknameDraftAimable(draft)) {
    return draft.tuning;
  }

  return {
    ...draft.tuning,
    angle: null,
    shape: null,
    animate: null,
  };
}

export function isNicknameDraftEmpty(draft: NicknameDraft): boolean {
  return draft.axes.font === null
    && draft.axes.effect === null
    && isNicknameStyleTuningEmpty(visibleTuning(draft));
}

/** Option ids compare case-insensitively: guids reach the client from services that disagree on case. */
function sameOption(left: string | null, right: string | null): boolean {
  return (left?.toLowerCase() ?? null) === (right?.toLowerCase() ?? null);
}

function sameColours(left: readonly number[] | null, right: readonly number[] | null): boolean {
  const leftColours = left ?? [];
  const rightColours = right ?? [];

  if (leftColours.length !== rightColours.length) {
    return false;
  }

  for (let index = 0; index < leftColours.length; index++) {
    if ((leftColours[index] | 0) !== (rightColours[index] | 0)) {
      return false;
    }
  }

  return true;
}

export function sameNicknameDraft(left: NicknameDraft, right: NicknameDraft): boolean {
  return sameOption(left.axes.font, right.axes.font)
    && sameOption(left.axes.effect, right.axes.effect)
    && sameColours(left.tuning.colors, right.tuning.colors)
    && left.tuning.angle === right.tuning.angle
    && left.tuning.shape === right.tuning.shape
    && left.tuning.animate === right.tuning.animate
    && left.tuning.weight === right.tuning.weight
    && left.tuning.letterSpacingCentiEm === right.tuning.letterSpacingCentiEm;
}

/** Nothing chosen takes the look off rather than saving an empty one. */
export function nicknameChange(draft: NicknameDraft, kindKey: string): WardrobeChange {
  if (isNicknameDraftEmpty(draft)) {
    return unequipChange(kindKey);
  }

  return equipChange(kindKey, toWornNickname(draft.axes, visibleTuning(draft)));
}
