import type { CatalogueCosmetic } from "@argon/glue";

/** Why a catalogue row cannot be put on: it comes with Ultima, or it is handed out rather than taken. */
export type CosmeticLockReason = "ultima" | "granted";

/** `wearable` is the store's `mayWear`: free, or owned (Ultima rows arrive as owned via the subscription). */
export function lockReasonOf(item: CatalogueCosmetic, wearable: boolean): CosmeticLockReason | null {
  if (wearable) {
    return null;
  }

  return item.ultima ? "ultima" : "granted";
}

export function availableUntilOf(item: Pick<CatalogueCosmetic, "availableUntil">): Date | null {
  const until = item.availableUntil;

  if (!until || typeof until.toDate !== "function") {
    return null;
  }

  const date = until.toDate();

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/** A row's name as assistive technology hears it: a locked row says so, since its padlock is only drawn. */
export function lockedAccessibleName(name: string, wearable: boolean, lockedWord: string): string {
  if (wearable) {
    return name;
  }

  return `${name}, ${lockedWord}`;
}
