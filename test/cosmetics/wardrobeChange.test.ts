/**
 * What one Apply in the wardrobe sends. A catalogue kind wears one row (`WornItem`), and choosing
 * nothing takes the kind off instead of saving an empty look.
 */

import {
  describe,
  expect,
  test,
} from "vitest";
import {
  CosmeticError,
  WornItem,
  type CatalogueCosmetic,
  type IWornCosmetic,
} from "@argon/glue";

import {
  equipChange,
  itemChange,
  refusalOf,
  unequipChange,
  wornAfter,
} from "@/components/settings/cosmetics/wardrobeChange";
import {
  availableUntilOf,
  lockReasonOf,
  lockedAccessibleName,
} from "@/components/settings/cosmetics/cosmeticLock";

function row(overrides: Partial<CatalogueCosmetic> = {}): CatalogueCosmetic {
  return {
    cosmeticId: "aaaaaaaa-0000-0000-0000-000000000001",
    kindKey: "profile.frame",
    slug: "frame",
    nameKey: "cosmetic_frame",
    descriptionKey: null,
    rarity: null,
    version: 1,
    payload: null as never,
    assets: [],
    availableUntil: null,
    free: false,
    ultima: false,
    text: [],
    ...overrides,
  };
}

describe("item kinds", () => {
  test("a chosen row is equipped as a WornItem carrying its id", () => {
    const change = itemChange("profile.frame", "frame-1");

    expect(change.action).toBe("equip");
    expect(change.kindKey).toBe("profile.frame");

    const worn = wornAfter(change);

    expect(worn).toBeInstanceOf(WornItem);
    expect((worn as WornItem).itemId).toBe("frame-1");
  });

  test("no row is an unequip of the kind", () => {
    expect(itemChange("avatar.decoration", null)).toEqual({ action: "unequip", kindKey: "avatar.decoration" });
  });
});

describe("locks", () => {
  test("the caption says why", () => {
    expect(lockReasonOf(row({ ultima: true }), false)).toBe("ultima");
    expect(lockReasonOf(row(), false)).toBe("granted");
    expect(lockReasonOf(row(), true)).toBeNull();
  });

  test("availability is read off the row when it has an end", () => {
    const end = new Date("2026-12-31T00:00:00Z");

    expect(availableUntilOf(row())).toBeNull();
    expect(availableUntilOf(row({ availableUntil: { toDate: () => end } as never }))).toEqual(end);
  });

  test("a locked row says so in its accessible name", () => {
    expect(lockedAccessibleName("Vines", true, "Locked")).toBe("Vines");
    expect(lockedAccessibleName("Vines", false, "Locked")).toBe("Vines, Locked");
  });
});

describe("refusals", () => {
  test("NOT_FOUND on an unequip is the asked-for state", () => {
    expect(refusalOf(unequipChange("profile.frame"), CosmeticError.NOT_FOUND)).toBeNull();
  });

  test("NOT_FOUND on an equip is still a refusal, and so is anything else on an unequip", () => {
    expect(refusalOf(equipChange("profile.frame", new WornItem("x")), CosmeticError.NOT_FOUND)).toBe(CosmeticError.NOT_FOUND);
    expect(refusalOf(unequipChange("profile.frame"), CosmeticError.KIND_DISABLED)).toBe(CosmeticError.KIND_DISABLED);
    expect(refusalOf(unequipChange("profile.frame"), null)).toBeNull();
  });
});
