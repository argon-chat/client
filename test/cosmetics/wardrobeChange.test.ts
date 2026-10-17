/**
 * What one Apply in the wardrobe sends. A catalogue kind wears one row (`WornItem`), a nickname is a
 * bare look (`WornNickname`) composed of its axis rows and the wearer's tuning, and choosing nothing
 * takes the kind off instead of saving an empty look.
 */

import {
  describe,
  expect,
  test,
} from "vitest";
import {
  CosmeticError,
  NicknameGradientShape,
  WornItem,
  WornNickname,
  type CatalogueCosmetic,
  type IWornCosmetic,
} from "@argon/glue";

import {
  emptyNicknameDraft,
  isNicknameDraftEmpty,
  nicknameChange,
  nicknameDraftOf,
  sameNicknameDraft,
} from "@/components/settings/cosmetics/nicknameDraft";
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

const KIND = "nickname.style";
const FONT_ID = "aaaaaaaa-0000-0000-0000-000000000003";
const GLOW_ID = "aaaaaaaa-0000-0000-0000-000000000004";

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

describe("nickname look", () => {
  test("axes and tuning become one WornNickname, field for field", () => {
    const change = nicknameChange({
      axes: { font: FONT_ID, effect: GLOW_ID },
      tuning: {
        colors: [0xffff0000 | 0, 0xff0000ff | 0],
        angle: 45,
        shape: "conic",
        animate: null,
        weight: 700,
        letterSpacingCentiEm: -5,
      },
    }, KIND);

    expect(change.action).toBe("equip");
    expect(change.kindKey).toBe("nickname.style");

    const worn = wornAfter(change) as WornNickname;

    expect(worn).toBeInstanceOf(WornNickname);
    expect(worn.font).toBe(FONT_ID);
    expect(worn.effect).toBe(GLOW_ID);
    expect(worn.colors).toEqual([0xffff0000 | 0, 0xff0000ff | 0]);
    expect(worn.angle).toBe(45);
    expect(worn.shape).toBe(NicknameGradientShape.Conic);
    expect(worn.animate).toBeNull();
    expect(worn.weight).toBe(700);
    expect(worn.letterSpacing).toBe(-5);
  });

  test("a weight alone is a look, not nothing", () => {
    const draft = { ...emptyNicknameDraft(), tuning: { ...emptyNicknameDraft().tuning, weight: 300 } };

    expect(isNicknameDraftEmpty(draft)).toBe(false);
    expect(nicknameChange(draft, KIND).action).toBe("equip");
  });

  test("nothing chosen takes the look off", () => {
    expect(nicknameChange(emptyNicknameDraft(), KIND)).toEqual({ action: "unequip", kindKey: "nickname.style" });
  });

  test("a worn look opens as the draft it was saved from", () => {
    const worn = new WornNickname(FONT_ID.toUpperCase(), null, [0xff00ff00 | 0], 90, NicknameGradientShape.Linear, true, 500, 10);
    const draft = nicknameDraftOf(worn);

    expect(draft.axes).toEqual({ font: FONT_ID.toUpperCase(), effect: null });
    expect(draft.tuning).toEqual({
      colors: [0xff00ff00 | 0],
      angle: 90,
      shape: "linear",
      animate: true,
      weight: 500,
      letterSpacingCentiEm: 10,
    });
    expect(sameNicknameDraft(draft, { ...draft, axes: { font: FONT_ID, effect: null } })).toBe(true);
    expect(sameNicknameDraft(draft, { ...draft, tuning: { ...draft.tuning, weight: 600 } })).toBe(false);
  });

  test("goes out under the kind it was asked for", () => {
    expect(nicknameChange(emptyNicknameDraft(), "nickname.other").kindKey).toBe("nickname.other");
  });

  test("an aim the picker hides is not saved: a single colour with no effect drops it", () => {
    const draft = {
      axes: { font: FONT_ID, effect: null },
      tuning: { ...emptyNicknameDraft().tuning, colors: [0xffff0000 | 0], angle: 45, shape: "conic" as const, animate: true },
    };

    const worn = wornAfter(nicknameChange(draft, KIND)) as WornNickname;

    expect(worn.angle).toBeNull();
    expect(worn.shape).toBeNull();
    expect(worn.animate).toBeNull();
    expect(worn.colors).toEqual([0xffff0000 | 0]);
  });

  test("an aim alone is no look, and takes it off", () => {
    const draft = {
      ...emptyNicknameDraft(),
      tuning: { ...emptyNicknameDraft().tuning, angle: 45, shape: "radial" as const },
    };

    expect(isNicknameDraftEmpty(draft)).toBe(true);
    expect(nicknameChange(draft, KIND)).toEqual({ action: "unequip", kindKey: KIND });
  });

  test("an aim under an effect is kept, even on one colour", () => {
    const draft = {
      axes: { font: null, effect: GLOW_ID },
      tuning: { ...emptyNicknameDraft().tuning, colors: [0xffff0000 | 0], angle: 45 },
    };

    expect((wornAfter(nicknameChange(draft, KIND)) as WornNickname).angle).toBe(45);
  });

  test("an axis row the picker cannot offer is dropped from the draft, the rest is kept", () => {
    const worn = new WornNickname(FONT_ID, GLOW_ID, [0xff00ff00 | 0], null, null, null, 700, null);
    const draft = nicknameDraftOf(worn, axis => axis === "font");

    expect(draft.axes).toEqual({ font: FONT_ID, effect: null });
    expect(draft.tuning.weight).toBe(700);
  });

  test("anything that is not a nickname opens empty", () => {
    expect(nicknameDraftOf(new WornItem("x"))).toEqual(emptyNicknameDraft());
    expect(nicknameDraftOf(null)).toEqual(emptyNicknameDraft());
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
