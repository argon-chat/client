/**
 * The room a worn frame asks of the card it is drawn on, as custom properties a host adds to its own
 * padding — and nothing at all for a card that wears nothing.
 */

import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  createPinia,
  setActivePinia,
} from "pinia";
import {
  effectScope,
  shallowRef,
} from "vue";
import {
  FrameRing,
  PayloadProfileFrame,
  WornItem,
  type ArgonUserProfile,
  type CatalogueCosmetic,
} from "@argon/glue";

import {
  useCosmeticFit,
  useCosmeticOverhang,
} from "@/composables/useCosmeticFit";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const mocks = vi.hoisted(() => ({
  getCatalogue: vi.fn(),
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count() {} },
  errorKind: () => "network",
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    cosmeticsInteraction: {
      GetCatalogue: mocks.getCatalogue,
      GetMyCosmetics: async () => ({ owned: [] }),
    },
  }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" }, meProfile: null }) }));
vi.mock("@/store/data/profileCacheStore", () => ({ useProfileCacheStore: () => ({}) }));

type WornProfile = Pick<ArgonUserProfile, "cosmetics"> | null;

const NONE_COVERED = { top: false, right: false, bottom: false, left: false };

const FRAME_ID = "aaaaaaaa-0000-0000-0000-000000000002";

const ring = new FrameRing(true, 100, { top: 12, right: 4, bottom: 0, left: 4 }, null, 2, [0xff00ff00 | 0], 90, 0);

const vines: CatalogueCosmetic = {
  cosmeticId: FRAME_ID,
  kindKey: "profile.frame",
  slug: "vines",
  nameKey: "cosmetic_vines",
  descriptionKey: null,
  rarity: null,
  version: 1,
  payload: new PayloadProfileFrame([ring]),
  assets: [],
  availableUntil: null,
  free: true,
  ultima: false,
  text: [],
};

const framed: WornProfile = { cosmetics: [new WornItem(FRAME_ID)] };

async function loaded() {
  mocks.getCatalogue.mockResolvedValue({ enabledKinds: ["profile.frame"], items: [vines] });

  await useCosmeticsStore().ensureLoaded();
}

function within<T>(run: () => T): T {
  return effectScope().run(run)!;
}

beforeEach(async () => {
  await runSessionReset();

  setActivePinia(createPinia());

  mocks.getCatalogue.mockReset();
});

describe("a card's fit", () => {
  test("asks for nothing and takes over no edge when nothing is worn", async () => {
    await loaded();

    const fit = within(() => useCosmeticFit(null, "profileCard"));

    expect(fit.value.covered).toEqual(NONE_COVERED);
    expect(fit.value.style["--cosmetic-inset-top"]).toBe("0px");
    expect(fit.value.style["--cosmetic-outset-left"]).toBe("0px");
    expect(Object.keys(fit.value.style).some(name => name.startsWith("--cosmetic-edge-"))).toBe(false);
  });

  test("pushes the content in by the frame's inset and hands every edge to a ring", async () => {
    await loaded();

    const fit = within(() => useCosmeticFit(framed, "profileCard"));

    expect(fit.value.covered).toEqual({ top: true, right: true, bottom: true, left: true });
    expect(fit.value.style["--cosmetic-inset-top"]).toBe("12px");
    expect(fit.value.style["--cosmetic-inset-right"]).toBe("4px");
    expect(fit.value.style["--cosmetic-inset-bottom"]).toBe("0px");
    expect(fit.value.style["--cosmetic-edge-top"]).toBe("0px");
    expect(fit.value.style["--cosmetic-edge-left"]).toBe("0px");
  });

  test("follows the profile it reads, so an equip shows at once", async () => {
    await loaded();

    const profile = shallowRef<WornProfile>(null);
    const fit = within(() => useCosmeticFit(profile, "profileCard"));

    expect(fit.value.covered).toEqual(NONE_COVERED);

    profile.value = framed;

    expect(fit.value.covered).toEqual({ top: true, right: true, bottom: true, left: true });
    expect(fit.value.style["--cosmetic-inset-top"]).toBe("12px");
  });

  test("is not drawn on a surface the frame does not name", async () => {
    await loaded();

    const fit = within(() => useCosmeticFit(framed, "memberListRow"));

    expect(fit.value.covered).toEqual(NONE_COVERED);
    expect(fit.value.style["--cosmetic-inset-top"]).toBe("0px");
  });
});

describe("a card's overhang", () => {
  test("is zero for a card wearing nothing", async () => {
    await loaded();

    const overhang = within(() => useCosmeticOverhang(null));

    expect(overhang.value).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("names every side for a worn frame", async () => {
    await loaded();

    const overhang = within(() => useCosmeticOverhang(framed));

    expect(Object.keys(overhang.value).sort()).toEqual(["bottom", "left", "right", "top"]);
  });
});
