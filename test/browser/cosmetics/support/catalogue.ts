/**
 * Catalogue rows and worn looks for the cosmetics browser tests.
 *
 * Plain data only: the module mocks of a test file import this, and they must not pull the app in.
 */
import {
  AssetSlot,
  FrameRepeat,
  FrameSurround,
  PayloadAvatarDecoration,
  PayloadProfileFrame,
  PayloadTextEffect,
  WornItem,
  WornNickname,
  type ArgonUserProfile,
  type CatalogueCosmetic,
  type CosmeticCatalogue,
} from "@argon/glue";

export type Worn = Pick<ArgonUserProfile, "cosmetics">;

/** A red ring on a transparent square: what a decoration file looks like, served without a network. */
export const RING_FILE = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><circle cx='50' cy='50' r='44' fill='none' stroke='red' stroke-width='10'/></svg>",
)}`;

export const HALO_ID = "aaaaaaaa-0000-0000-0000-0000000000a1";
export const UNDER_ID = "aaaaaaaa-0000-0000-0000-0000000000a2";
export const BAND_ID = "aaaaaaaa-0000-0000-0000-0000000000f1";
export const GLOW_ID = "aaaaaaaa-0000-0000-0000-0000000000e1";

function row(cosmeticId: string, kindKey: string, slug: string, payload: CatalogueCosmetic["payload"], fileId: string | null): CatalogueCosmetic {
  return {
    cosmeticId,
    kindKey,
    slug,
    nameKey: `cosmetic_${slug}`,
    descriptionKey: null,
    rarity: null,
    version: 1,
    payload,
    assets: fileId ? [{ slot: AssetSlot.Primary, fileId }] : [],
    availableUntil: null,
    free: true,
    ultima: false,
    text: [],
  };
}

/** A decoration reaching 20% past the face on every side, drawn over it. */
export const halo = row(HALO_ID, "avatar.decoration", "halo", new PayloadAvatarDecoration(20, false), "ring-file");

/** The same, drawn beneath the face. */
export const under = row(UNDER_ID, "avatar.decoration", "under", new PayloadAvatarDecoration(20, true), "ring-file");

/** A band along the card's top edge only, hanging 24px above it. */
export const topBand = row(
  BAND_ID,
  "profile.frame",
  "top-band",
  new PayloadProfileFrame([
    new FrameSurround(
      true,
      100,
      null,
      null,
      AssetSlot.Primary,
      { top: 10, right: 0, bottom: 0, left: 0 },
      { top: 12, right: 0, bottom: 0, left: 0 },
      { top: 24, right: 0, bottom: 0, left: 0 },
      FrameRepeat.Stretch,
      false,
    ),
  ]),
  "band-file",
);

export const glow = row(GLOW_ID, "option.text-effect", "glow", new PayloadTextEffect(), null);

export const ALL_KINDS = ["avatar.decoration", "profile.frame", "nickname.style", "option.text-effect"];

export function catalogue(enabledKinds: string[] = ALL_KINDS): CosmeticCatalogue {
  return { enabledKinds, items: [halo, under, topBand, glow] };
}

export function wearingItems(...ids: string[]): Worn {
  return { cosmetics: ids.map(id => new WornItem(id)) };
}

/** A nickname look: the wearer's own colours, through a treatment when one is named. */
export function nickname(colors: number[], effect: string | null = null): WornNickname {
  return new WornNickname(null, effect, colors, null, null, null, null, null);
}

export const RED = 0xffff0000 | 0;
export const BLUE = 0xff0000ff | 0;
