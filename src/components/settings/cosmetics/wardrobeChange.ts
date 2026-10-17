import {
  CosmeticError,
  type IWornCosmetic,
} from "@argon/glue";

import { toWornItem } from "@/cosmetics/wire";

/** What one Apply in the wardrobe asks the server for: put one look on, or take a kind off. */
export type WardrobeChange =
  | {
    readonly action: "equip";
    readonly kindKey: string;
    readonly worn: IWornCosmetic;
  }
  | {
    readonly action: "unequip";
    readonly kindKey: string;
  };

export function equipChange(kindKey: string, worn: IWornCosmetic): WardrobeChange {
  return { action: "equip", kindKey, worn };
}

export function unequipChange(kindKey: string): WardrobeChange {
  return { action: "unequip", kindKey };
}

/** A kind worn as one catalogue row: a row replaces whatever is on, no row takes the kind off. */
export function itemChange(kindKey: string, itemId: string | null): WardrobeChange {
  if (itemId === null) {
    return unequipChange(kindKey);
  }

  return equipChange(kindKey, toWornItem(itemId));
}

/** The entry a change leaves on the profile for its kind, for drawing a draft before it is applied. */
export function wornAfter(change: WardrobeChange): IWornCosmetic | null {
  if (change.action === "equip") {
    return change.worn;
  }

  return null;
}

/** Taking off a kind that was already off is the state the wearer asked for, not a failure. */
export function refusalOf(change: WardrobeChange, refusal: CosmeticError | null): CosmeticError | null {
  if (change.action === "unequip" && refusal === CosmeticError.NOT_FOUND) {
    return null;
  }

  return refusal;
}
