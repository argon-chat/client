import {
  describe,
  expect,
  it,
} from "vitest";
import {
  AssetSlot,
  FrameAnchor,
  FrameProp,
  FrameRepeat,
  FrameRing,
  FrameSurround,
  NicknameGradientShape,
  PayloadAvatarDecoration,
  PayloadFont,
  PayloadProfileFrame,
  PayloadTextEffect,
  WornItem,
  WornNickname,
  type FrameSides,
  type IFramePart,
} from "@argon/glue";

import {
  anchorName,
  assetsOf,
  avatarDecorationOf,
  fontOptionOf,
  framePartOf,
  nicknameAxesOf,
  profileFrameOf,
  repeatName,
  shapeName,
  shapeValue,
  sidesOf,
  slotName,
  textEffectOptionOf,
  toWornItem,
  toWornNickname,
  tuningOf,
} from "@/cosmetics/wire";
import { emptyNicknameStyleTuning } from "@/cosmetics/kinds/nickname-style";
import { reviveWornCosmetics } from "@/cosmetics/reviveWorn";

function sides(top: number, right: number, bottom: number, left: number): FrameSides {
  return { top, right, bottom, left };
}

function surround(overrides: Partial<FrameSurround> = {}): FrameSurround {
  const part = new FrameSurround(
    true,
    80,
    null,
    null,
    AssetSlot.Secondary,
    sides(10, 20, 30, 40),
    sides(4, 0, 4, 0),
    null,
    FrameRepeat.Round,
    true,
  );

  return Object.assign(part, overrides);
}

function prop(overrides: Partial<FrameProp> = {}): FrameProp {
  const part = new FrameProp(
    false,
    100,
    sides(1, 2, 3, 4),
    { kind: "sway", amount: 6, periodMs: 3000, phaseMs: 250 },
    AssetSlot.Tertiary,
    FrameAnchor.BottomRight,
    48,
    32,
    -5,
    7,
    { frames: 8, columns: 4, fps: 12, still: 3 },
  );

  return Object.assign(part, overrides);
}

function ring(overrides: Partial<FrameRing> = {}): FrameRing {
  const part = new FrameRing(true, 100, null, null, 3, [0xff112233 | 0, 0xff445566 | 0], 45, 50);

  return Object.assign(part, overrides);
}

function nickname(overrides: Partial<WornNickname> = {}): WornNickname {
  const worn = new WornNickname(null, null, null, null, null, null, null, null);

  return Object.assign(worn, overrides);
}

describe("enum names", () => {
  it("names every asset slot the way the upstream frame payload spells it", () => {
    expect(slotName(AssetSlot.Primary)).toBe("primary");
    expect(slotName(AssetSlot.Secondary)).toBe("secondary");
    expect(slotName(AssetSlot.Tertiary)).toBe("tertiary");
    expect(slotName(AssetSlot.Quaternary)).toBe("quaternary");
    expect(slotName(9 as AssetSlot)).toBeNull();
  });

  it("names every anchor", () => {
    expect(anchorName(FrameAnchor.TopLeft)).toBe("topLeft");
    expect(anchorName(FrameAnchor.Top)).toBe("top");
    expect(anchorName(FrameAnchor.TopRight)).toBe("topRight");
    expect(anchorName(FrameAnchor.Left)).toBe("left");
    expect(anchorName(FrameAnchor.Center)).toBe("center");
    expect(anchorName(FrameAnchor.Right)).toBe("right");
    expect(anchorName(FrameAnchor.BottomLeft)).toBe("bottomLeft");
    expect(anchorName(FrameAnchor.Bottom)).toBe("bottom");
    expect(anchorName(FrameAnchor.BottomRight)).toBe("bottomRight");
    expect(anchorName(42 as FrameAnchor)).toBeNull();
  });

  it("names every repeat", () => {
    expect(repeatName(FrameRepeat.Stretch)).toBe("stretch");
    expect(repeatName(FrameRepeat.Repeat)).toBe("repeat");
    expect(repeatName(FrameRepeat.Round)).toBe("round");
    expect(repeatName(FrameRepeat.Space)).toBe("space");
    expect(repeatName(7 as FrameRepeat)).toBeNull();
  });

  it("maps gradient shapes both ways", () => {
    expect(shapeName(NicknameGradientShape.Linear)).toBe("linear");
    expect(shapeName(NicknameGradientShape.Radial)).toBe("radial");
    expect(shapeName(NicknameGradientShape.Conic)).toBe("conic");
    expect(shapeName(null)).toBeNull();
    expect(shapeName(3 as NicknameGradientShape)).toBeNull();

    expect(shapeValue("linear")).toBe(NicknameGradientShape.Linear);
    expect(shapeValue("radial")).toBe(NicknameGradientShape.Radial);
    expect(shapeValue("conic")).toBe(NicknameGradientShape.Conic);
    expect(shapeValue(null)).toBeNull();
  });
});

describe("sides", () => {
  it("turns the named object into the top-right-bottom-left tuple", () => {
    expect(sidesOf(sides(1, 2, 3, 4))).toEqual([1, 2, 3, 4]);
  });

  it("has nothing for a missing side list", () => {
    expect(sidesOf(null)).toBeNull();
    expect(sidesOf(undefined)).toBeNull();
  });
});

describe("assets", () => {
  it("keys files by the lowercase slot a frame part names", () => {
    expect(assetsOf([
      { slot: AssetSlot.Primary, fileId: "file-a" },
      { slot: AssetSlot.Quaternary, fileId: "file-d" },
    ])).toEqual({ primary: "file-a", quaternary: "file-d" });
  });

  it("drops a slot this build does not know and an empty file id", () => {
    expect(assetsOf([
      { slot: 12 as AssetSlot, fileId: "file-x" },
      { slot: AssetSlot.Secondary, fileId: "" },
    ])).toEqual({});
  });

  it("has nothing for no assets", () => {
    expect(assetsOf(null)).toEqual({});
    expect(assetsOf([])).toEqual({});
  });
});

describe("avatar decoration", () => {
  it("reads its payload through the upstream bounds", () => {
    expect(avatarDecorationOf(new PayloadAvatarDecoration(12, true))).toEqual({ insetPct: 12, beneath: true });
    expect(avatarDecorationOf(new PayloadAvatarDecoration(41, false))).toBeNull();
  });

  it("is nothing for another kind's payload", () => {
    expect(avatarDecorationOf(new PayloadFont("Lato"))).toBeNull();
    expect(avatarDecorationOf(null)).toBeNull();
  });
});

describe("font option", () => {
  it("reads the family through the upstream shape check", () => {
    expect(fontOptionOf(new PayloadFont("Press Start 2P"))).toEqual({ cssFamily: "Press Start 2P" });
    expect(fontOptionOf(new PayloadFont("Lato; color: red"))).toBeNull();
  });

  it("is nothing for another kind's payload", () => {
    expect(fontOptionOf(new PayloadTextEffect())).toBeNull();
  });
});

describe("text effect option", () => {
  it("is an empty payload", () => {
    expect(textEffectOptionOf(new PayloadTextEffect())).toEqual({});
  });

  it("is nothing for another kind's payload", () => {
    expect(textEffectOptionOf(new PayloadFont("Lato"))).toBeNull();
  });
});

describe("frame parts", () => {
  it("maps a surround, zeroing a missing inset and outset", () => {
    expect(framePartOf(surround())).toEqual({
      type: "surround",
      over: true,
      opacityPct: 80,
      inset: [0, 0, 0, 0],
      motion: null,
      slot: "secondary",
      slice: [10, 20, 30, 40],
      width: [4, 0, 4, 0],
      outset: [0, 0, 0, 0],
      repeat: "round",
      fill: true,
    });
  });

  it("maps a prop with its motion and sprite", () => {
    expect(framePartOf(prop())).toEqual({
      type: "prop",
      over: false,
      opacityPct: 100,
      inset: [1, 2, 3, 4],
      motion: { kind: "sway", amount: 6, periodMs: 3000, phaseMs: 250 },
      slot: "tertiary",
      anchor: "bottomRight",
      w: 48,
      h: 32,
      dx: -5,
      dy: 7,
      sprite: { frames: 8, columns: 4, fps: 12, still: 3 },
    });
  });

  it("maps a ring", () => {
    expect(framePartOf(ring())).toMatchObject({
      type: "ring",
      thickness: 3,
      colors: [0xff112233 | 0, 0xff445566 | 0],
      angle: 45,
      glowPct: 50,
    });
  });

  it("has nothing for a part type this build does not know", () => {
    const unknown = { UnionKey: "FrameSpiral", UnionIndex: 3 } as unknown as IFramePart;

    expect(framePartOf(unknown)).toBeNull();
  });
});

describe("profile frame", () => {
  it("parses every part into the upstream model", () => {
    const parsed = profileFrameOf(new PayloadProfileFrame([surround(), prop(), ring()]));

    expect(parsed?.parts.map(part => part.type)).toEqual(["surround", "prop", "ring"]);
    expect(parsed?.parts[0]).toMatchObject({ slot: "secondary", outset: [0, 0, 0, 0], repeat: "round" });
    expect(parsed?.parts[1]).toMatchObject({ anchor: "bottomRight", sprite: { frames: 8, columns: 4, fps: 12, still: 3 } });
  });

  it("drops a part with an unknown slot or anchor and keeps the rest", () => {
    const parsed = profileFrameOf(new PayloadProfileFrame([
      surround({ slot: 9 as AssetSlot }),
      prop({ anchor: 99 as FrameAnchor }),
      ring(),
    ]));

    expect(parsed?.parts.map(part => part.type)).toEqual(["ring"]);
  });

  it("falls back to stretch for an unknown repeat", () => {
    const parsed = profileFrameOf(new PayloadProfileFrame([surround({ repeat: 8 as FrameRepeat })]));

    expect(parsed?.parts[0]).toMatchObject({ repeat: "stretch" });
  });

  it("clamps out-of-range numbers through the upstream bounds", () => {
    const parsed = profileFrameOf(new PayloadProfileFrame([
      surround({ width: sides(500, 0, 0, 0), outset: sides(1000, 0, 0, 0) }),
    ]));

    expect(parsed?.parts[0]).toMatchObject({ width: [64, 0, 0, 0], outset: [96, 0, 0, 0] });
  });

  it("is nothing when no part survives", () => {
    expect(profileFrameOf(new PayloadProfileFrame([surround({ width: sides(0, 0, 0, 0) })]))).toBeNull();
    expect(profileFrameOf(new PayloadProfileFrame([]))).toBeNull();
  });

  it("is nothing for another kind's payload", () => {
    expect(profileFrameOf(new PayloadAvatarDecoration(0, false))).toBeNull();
  });
});

describe("worn nickname", () => {
  it("reads the wearer's tuning, renaming the shape and the spacing", () => {
    const worn = nickname({
      colors: [0xffff0000 | 0, 0xff00ff00 | 0],
      angle: 120,
      shape: NicknameGradientShape.Conic,
      animate: true,
      weight: 700,
      letterSpacing: 12,
    });

    expect(tuningOf(worn)).toEqual({
      colors: [0xffff0000 | 0, 0xff00ff00 | 0],
      angle: 120,
      shape: "conic",
      animate: true,
      weight: 700,
      letterSpacingCentiEm: 12,
    });
  });

  it("drops out-of-range values rather than pinning them", () => {
    const tuning = tuningOf(nickname({
      angle: 400,
      shape: 5 as NicknameGradientShape,
      weight: 950,
      letterSpacing: -20,
    }));

    expect(tuning).toEqual(emptyNicknameStyleTuning());
  });

  it("refuses a seventh colour", () => {
    expect(tuningOf(nickname({ colors: [1, 2, 3, 4, 5, 6, 7] }))).toBeNull();
  });

  it("reads its axes", () => {
    expect(nicknameAxesOf(nickname({ font: "font-id", effect: null }))).toEqual({ font: "font-id", effect: null });
  });

  it("writes back a real WornNickname", () => {
    const worn = toWornNickname(
      { font: "font-id", effect: "effect-id" },
      {
        colors: [7, 8],
        angle: 30,
        shape: "radial",
        animate: false,
        weight: 500,
        letterSpacingCentiEm: -4,
      },
    );

    expect(worn).toBeInstanceOf(WornNickname);
    expect(worn.isWornNickname()).toBe(true);
    expect(worn.font).toBe("font-id");
    expect(worn.effect).toBe("effect-id");
    expect(worn.colors).toEqual([7, 8]);
    expect(worn.angle).toBe(30);
    expect(worn.shape).toBe(NicknameGradientShape.Radial);
    expect(worn.animate).toBe(false);
    expect(worn.weight).toBe(500);
    expect(worn.letterSpacing).toBe(-4);
  });

  it("round-trips through the wire shape", () => {
    const tuning = {
      colors: [1, 2, 3],
      angle: 0,
      shape: "linear" as const,
      animate: true,
      weight: 100,
      letterSpacingCentiEm: 50,
    };

    expect(tuningOf(toWornNickname({ font: null, effect: null }, tuning))).toEqual(tuning);
  });

  it("writes an all-null look for an empty tuning, which the server reads as taking it off", () => {
    const worn = toWornNickname({ font: null, effect: null }, emptyNicknameStyleTuning());

    expect([worn.font, worn.effect, worn.colors, worn.angle, worn.shape, worn.animate, worn.weight, worn.letterSpacing])
      .toEqual([null, null, null, null, null, null, null, null]);
  });
});

describe("worn item", () => {
  it("is a real WornItem", () => {
    const worn = toWornItem("item-id");

    expect(worn).toBeInstanceOf(WornItem);
    expect(worn.itemId).toBe("item-id");
  });
});

describe("revival from IndexedDB", () => {
  it("gives a structured clone its class back", () => {
    const flattened = structuredClone([
      new WornItem("item-id"),
      nickname({ font: "font-id", colors: [5], shape: NicknameGradientShape.Radial }),
    ]);

    const revived = reviveWornCosmetics(flattened);

    expect(revived).toHaveLength(2);
    expect(revived?.[0].isWornItem()).toBe(true);
    expect((revived?.[0] as WornItem).itemId).toBe("item-id");
    expect(revived?.[1].isWornNickname()).toBe(true);
    expect((revived?.[1] as WornNickname).shape).toBe(NicknameGradientShape.Radial);
  });

  it("keeps null as not told and drops what it does not recognise", () => {
    expect(reviveWornCosmetics(null)).toBeNull();
    expect(reviveWornCosmetics(undefined)).toBeNull();
    expect(reviveWornCosmetics([{ kindKey: "profile.frame", payloadJson: "{}" }, { UnionKey: "WornItem" }])).toEqual([]);
  });
});
