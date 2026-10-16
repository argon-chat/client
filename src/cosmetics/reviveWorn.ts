import {
  WornItem,
  WornNickname,
  type IWornCosmetic,
} from "@argon/glue";

import {
  asWornItem,
  asWornNickname,
} from "@/cosmetics/wornEntry";

function reviveWornCosmetic(worn: unknown): IWornCosmetic | null {
  const item = asWornItem(worn);

  if (item !== null) {
    return new WornItem(item.itemId);
  }

  const nickname = asWornNickname(worn);

  if (nickname === null) {
    return null;
  }

  return new WornNickname(
    nickname.font ?? null,
    nickname.effect ?? null,
    Array.isArray(nickname.colors) ? [...nickname.colors] : null,
    nickname.angle ?? null,
    nickname.shape ?? null,
    nickname.animate ?? null,
    nickname.weight ?? null,
    nickname.letterSpacing ?? null,
  );
}

/**
 * Worn cosmetics with their classes back, for a profile read out of IndexedDB.
 *
 * Null stays null ("not told"); anything this build cannot recognise is dropped.
 */
export function reviveWornCosmetics(worn: unknown): IWornCosmetic[] | null {
  if (!Array.isArray(worn)) {
    return null;
  }

  const revived: IWornCosmetic[] = [];

  for (const entry of worn) {
    const cosmetic = reviveWornCosmetic(entry);

    if (cosmetic !== null) {
      revived.push(cosmetic);
    }
  }

  return revived;
}
