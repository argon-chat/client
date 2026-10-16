/**
 * Turning what the server says somebody wears into something drawable, and changing it.
 *
 * Most rules here are "draws nothing" rules: a cosmetic this build cannot draw has to disappear
 * quietly rather than take a profile card down, and is counted through `cosmetic.render.failed`.
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
import { reactive } from "vue";

const h = vi.hoisted(() => ({
  counted: [] as Array<{ name: string; attrs?: Record<string, unknown> }>,
  getCatalogue: vi.fn(),
  getMyCosmetics: vi.fn(),
  equip: vi.fn(),
  unequip: vi.fn(),
  updateCosmetics: vi.fn(async () => {}),
  me: { me: { userId: "me" }, meProfile: null as unknown, isPremium: false } as Record<string, unknown>,
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: {
    count(name: string, attrs?: Record<string, unknown>) {
      h.counted.push({ name, attrs });
    },
  },
  errorKind: () => "network",
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    cosmeticsInteraction: {
      GetCatalogue: h.getCatalogue,
      GetMyCosmetics: h.getMyCosmetics,
      Equip: h.equip,
      Unequip: h.unequip,
    },
  }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => h.me }));
vi.mock("@/store/data/profileCacheStore", () => ({
  useProfileCacheStore: () => ({ updateCosmetics: h.updateCosmetics }),
}));

import {
  AssetSlot,
  CosmeticError,
  FailedEquip,
  NicknameGradientShape,
  PayloadAvatarDecoration,
  PayloadFont,
  PayloadProfileFrame,
  PayloadTextEffect,
  SuccessEquip,
  WornItem,
  WornNickname,
  FrameRing,
  type ArgonUserProfile,
  type CatalogueCosmetic,
  type CosmeticCatalogue,
  type ICosmeticPayload,
  type IWornCosmetic,
} from "@argon/glue";

import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { optionOn } from "@/cosmetics/optionOn";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const ALL_KINDS = ["avatar.decoration", "profile.frame", "nickname.style", "option.font", "option.text-effect"];

const DECORATION_ID = "AAAAAAAA-0000-0000-0000-000000000001";
const FRAME_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const FONT_ID = "aaaaaaaa-0000-0000-0000-000000000003";
const GLOW_ID = "aaaaaaaa-0000-0000-0000-000000000004";
const PRISM_ID = "aaaaaaaa-0000-0000-0000-000000000005";
const FUTURE_ID = "aaaaaaaa-0000-0000-0000-000000000006";
const BROKEN_FRAME_ID = "aaaaaaaa-0000-0000-0000-000000000007";

function row(
  cosmeticId: string,
  kindKey: string,
  slug: string,
  payload: ICosmeticPayload,
  overrides: Partial<CatalogueCosmetic> = {},
): CatalogueCosmetic {
  return {
    cosmeticId,
    kindKey,
    slug,
    nameKey: `cosmetic_${slug}`,
    descriptionKey: null,
    rarity: null,
    version: 1,
    payload,
    assets: [],
    availableUntil: null,
    free: false,
    ultima: false,
    text: [],
    ...overrides,
  };
}

const ring = new FrameRing(true, 100, null, null, 2, [0xff00ff00 | 0], 90, 0);

function catalogueWith(enabledKinds: string[] = ALL_KINDS): CosmeticCatalogue {
  return {
    enabledKinds,
    items: [
      row(DECORATION_ID, "avatar.decoration", "halo", new PayloadAvatarDecoration(10, false), {
        assets: [
          { slot: AssetSlot.Primary, fileId: "halo-file" },
          { slot: AssetSlot.Secondary, fileId: "halo-extra" },
        ],
      }),
      row(FRAME_ID, "profile.frame", "vines", new PayloadProfileFrame([ring]), { free: true }),
      row(BROKEN_FRAME_ID, "profile.frame", "empty", new PayloadProfileFrame([])),
      row(FONT_ID, "option.font", "lato", new PayloadFont("Lato"), {
        assets: [{ slot: AssetSlot.Primary, fileId: "lato-file" }],
      }),
      row(GLOW_ID, "option.text-effect", "glow", new PayloadTextEffect()),
      row(PRISM_ID, "option.text-effect", "prismatic", new PayloadTextEffect()),
      row(FUTURE_ID, "profile.hologram", "holo", new PayloadTextEffect()),
    ],
  };
}

function nickname(overrides: Partial<WornNickname> = {}): WornNickname {
  return Object.assign(new WornNickname(null, null, [0xffff0000 | 0], null, null, null, null, null), overrides);
}

function wearing(...cosmetics: IWornCosmetic[]): ArgonUserProfile {
  return { userId: "u", cosmetics } as unknown as ArgonUserProfile;
}

function renderFailures(): Array<Record<string, unknown> | undefined> {
  return h.counted.filter(entry => entry.name === "cosmetic.render.failed").map(entry => entry.attrs);
}

async function loadedStore(catalogue: CosmeticCatalogue = catalogueWith()) {
  h.getCatalogue.mockResolvedValue(catalogue);

  const store = useCosmeticsStore();

  await store.ensureLoaded();

  return store;
}

beforeEach(async () => {
  await runSessionReset();

  setActivePinia(createPinia());

  h.counted.length = 0;
  h.me = { me: { userId: "me" }, meProfile: null, isPremium: false };
  h.getCatalogue.mockReset();
  h.getMyCosmetics.mockReset();
  h.getMyCosmetics.mockResolvedValue({ owned: [] });
  h.equip.mockReset();
  h.unequip.mockReset();
  h.updateCosmetics.mockClear();
});

describe("loading", () => {
  test("catalogue and owned are read once however many ask at the same time", async () => {
    h.getCatalogue.mockResolvedValue(catalogueWith());

    const store = useCosmeticsStore();

    await Promise.all([store.ensureLoaded(), store.ensureLoaded(), store.loadCatalogue()]);
    await store.ensureLoaded();

    expect(h.getCatalogue).toHaveBeenCalledTimes(1);
    expect(h.getMyCosmetics).toHaveBeenCalledTimes(1);
    expect(store.catalogue?.items).toHaveLength(7);
  });

  test("a failed load is retried by the next call", async () => {
    h.getCatalogue.mockRejectedValueOnce(new Error("offline"));

    const store = useCosmeticsStore();

    await store.ensureLoaded();
    expect(store.catalogue).toBeNull();

    h.getCatalogue.mockResolvedValue(catalogueWith());
    await store.ensureLoaded();

    expect(store.catalogue).not.toBeNull();
    expect(h.getCatalogue).toHaveBeenCalledTimes(2);
    expect(h.getMyCosmetics).toHaveBeenCalledTimes(1);
  });

  test("a failed half is retried on its own with backoff, and the retries stop", async () => {
    vi.useFakeTimers();

    try {
      h.getCatalogue.mockRejectedValue(new Error("offline"));

      const store = useCosmeticsStore();

      await store.ensureLoaded();
      expect(h.getCatalogue).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_999);
      expect(h.getCatalogue).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(h.getCatalogue).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(h.getCatalogue).toHaveBeenCalledTimes(3);

      h.getCatalogue.mockResolvedValue(catalogueWith());
      await vi.advanceTimersByTimeAsync(30_000);

      expect(h.getCatalogue).toHaveBeenCalledTimes(4);
      expect(store.catalogue).not.toBeNull();
      expect(h.getMyCosmetics).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.getCatalogue).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  test("three failed retries give up until something asks again", async () => {
    vi.useFakeTimers();

    try {
      h.getMyCosmetics.mockRejectedValue(new Error("offline"));
      h.getCatalogue.mockResolvedValue(catalogueWith());

      const store = useCosmeticsStore();

      await store.ensureLoaded();
      await vi.advanceTimersByTimeAsync(200_000);

      expect(h.getMyCosmetics).toHaveBeenCalledTimes(4);
      expect(h.getCatalogue).toHaveBeenCalledTimes(1);

      h.getMyCosmetics.mockResolvedValue({ owned: [] });
      await store.ensureLoaded();

      expect(h.getMyCosmetics).toHaveBeenCalledTimes(5);
      expect(h.getCatalogue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a session reset cancels a pending retry", async () => {
    vi.useFakeTimers();

    try {
      h.getCatalogue.mockRejectedValue(new Error("offline"));

      const store = useCosmeticsStore();

      await store.ensureLoaded();
      await runSessionReset();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(h.getCatalogue).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a session reset forgets everything, and an answer for the old session is dropped", async () => {
    let answer!: (catalogue: CosmeticCatalogue) => void;

    h.getCatalogue.mockReturnValue(new Promise<CosmeticCatalogue>(resolve => {
      answer = resolve;
    }));

    const store = useCosmeticsStore();
    const pending = store.loadCatalogue();

    await runSessionReset();
    answer(catalogueWith());

    expect(await pending).toBeNull();
    expect(store.catalogue).toBeNull();
  });

  test("ids are compared without regard to case", async () => {
    const store = await loadedStore();

    expect(store.itemById(DECORATION_ID.toLowerCase())?.slug).toBe("halo");
    expect(store.itemById(FRAME_ID.toUpperCase())?.slug).toBe("vines");
    expect(store.itemById(null)).toBeNull();
  });
});

describe("ownership", () => {
  test("a free row may be worn by anybody, an owned one by its owner, an expired grant by nobody", async () => {
    h.getMyCosmetics.mockResolvedValue({
      owned: [
        { cosmeticId: DECORATION_ID.toLowerCase(), expiresAt: null, viaSubscription: false },
        { cosmeticId: FONT_ID, expiresAt: { toDate: () => new Date(Date.now() - 1000) }, viaSubscription: true },
      ],
    });

    const store = await loadedStore();

    expect(store.mayWear(store.itemById(DECORATION_ID)!)).toBe(true);
    expect(store.mayWear(store.itemById(FRAME_ID)!)).toBe(true);
    expect(store.mayWear(store.itemById(FONT_ID)!)).toBe(false);
    expect(store.mayWear(store.itemById(GLOW_ID)!)).toBe(false);
  });
});

describe("owned refresh", () => {
  test("a forced refresh asks again and replaces what is held, even with a request on its way", async () => {
    const store = await loadedStore();
    let answer!: (owned: unknown) => void;

    h.getMyCosmetics.mockReturnValueOnce(new Promise(resolve => {
      answer = resolve;
    }));

    const stale = store.loadOwned();

    h.getMyCosmetics.mockResolvedValueOnce({
      owned: [{ cosmeticId: DECORATION_ID, expiresAt: null, viaSubscription: false }],
    });

    await store.loadOwned({ force: true });
    answer({ owned: [] });

    expect(await stale).toBeNull();
    expect(store.mayWear(store.itemById(DECORATION_ID)!)).toBe(true);
  });

  test("a grant is re-checked against its expiry when asked, not only when loaded", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
      h.getMyCosmetics.mockResolvedValue({
        owned: [{ cosmeticId: DECORATION_ID, expiresAt: { toDate: () => new Date("2026-10-08T12:00:05Z") }, viaSubscription: true }],
      });

      const store = await loadedStore();

      expect(store.mayWear(store.itemById(DECORATION_ID)!)).toBe(true);

      vi.setSystemTime(new Date("2026-10-08T12:00:06Z"));

      expect(store.mayWear(store.itemById(DECORATION_ID)!)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a grant listed twice keeps the longer claim", async () => {
    h.getMyCosmetics.mockResolvedValue({
      owned: [
        { cosmeticId: DECORATION_ID, expiresAt: { toDate: () => new Date(Date.now() + 1000) }, viaSubscription: true },
        { cosmeticId: DECORATION_ID.toLowerCase(), expiresAt: null, viaSubscription: false },
      ],
    });

    const store = await loadedStore();

    expect(store.owned.get(DECORATION_ID.toLowerCase())).toBeNull();
  });

  test("a subscription starting refreshes what is owned", async () => {
    h.me = reactive({ me: { userId: "me" }, meProfile: null, isPremium: false });

    const store = await loadedStore();

    expect(h.getMyCosmetics).toHaveBeenCalledTimes(1);

    h.me.isPremium = true;
    await vi.waitFor(() => expect(h.getMyCosmetics).toHaveBeenCalledTimes(2));

    expect(store.owned.size).toBe(0);
  });

  test("a refresh that fails on a subscription change is asked for again, not trusted as loaded", async () => {
    h.me = reactive({ me: { userId: "me" }, meProfile: null, isPremium: false });

    const store = await loadedStore();

    h.getMyCosmetics.mockRejectedValueOnce(new Error("offline"));
    h.getMyCosmetics.mockResolvedValue({ owned: [{ cosmeticId: FRAME_ID, expiresAt: null, viaSubscription: true }] });

    h.me.isPremium = true;
    await vi.waitFor(() => expect(h.getMyCosmetics).toHaveBeenCalledTimes(3));

    expect(store.owned.has(FRAME_ID.toLowerCase())).toBe(true);
  });
});

describe("what a picker offers", () => {
  test("only rows of an enabled kind, readable, and with a client module for an effect", async () => {
    const store = await loadedStore();

    expect(store.optionsFor("option.text-effect").map(item => item.slug)).toEqual(["glow"]);
    expect(store.optionsFor("profile.frame").map(item => item.slug)).toEqual(["vines"]);
  });

  test("nothing for a kind the server switched off", async () => {
    const store = await loadedStore(catalogueWith(["avatar.decoration"]));

    expect(store.optionsFor("profile.frame")).toEqual([]);
    expect(store.isKindEnabled("profile.frame")).toBe(false);
    expect(store.wearableKinds.map(kind => kind.key)).toEqual(["avatar.decoration"]);
  });

  test("what may be worn comes first", async () => {
    h.getMyCosmetics.mockResolvedValue({ owned: [] });

    const catalogue = catalogueWith();

    catalogue.items.push(row("bbbbbbbb-0000-0000-0000-000000000001", "profile.frame", "free-ring", new PayloadProfileFrame([ring]), { free: true }));
    catalogue.items.unshift(row("bbbbbbbb-0000-0000-0000-000000000002", "profile.frame", "locked-ring", new PayloadProfileFrame([ring])));

    const store = await loadedStore(catalogue);

    expect(store.optionsFor("profile.frame").map(item => item.slug)).toEqual(["vines", "free-ring", "locked-ring"]);
  });
});

describe("resolution", () => {
  test("nothing resolves before the catalogue arrives", () => {
    const store = useCosmeticsStore();

    expect(store.resolve(wearing(new WornItem(DECORATION_ID)), "avatar")).toEqual([]);
  });

  test("null cosmetics and no profile resolve to nothing", async () => {
    const store = await loadedStore();

    expect(store.resolve({ cosmetics: null }, "avatar")).toEqual([]);
    expect(store.resolve(null, "avatar")).toEqual([]);
  });

  test("a worn item resolves on a surface its kind names, with its files by slot", async () => {
    const store = await loadedStore();

    const [decoration] = store.resolve(wearing(new WornItem(DECORATION_ID.toLowerCase())), "avatar");

    expect(decoration.kind.key).toBe("avatar.decoration");
    expect(decoration.itemId).toBe(DECORATION_ID);
    expect(decoration.payload).toEqual({ insetPct: 10, beneath: false });
    expect(decoration.assets).toEqual({ primary: "halo-file", secondary: "halo-extra" });
  });

  test("and not on a surface it does not", async () => {
    const store = await loadedStore();

    expect(store.resolve(wearing(new WornItem(DECORATION_ID)), "profileCard")).toEqual([]);
    expect(renderFailures()).toEqual([]);
  });

  test("everything worn comes back in compositing order", async () => {
    const store = await loadedStore();

    const resolved = store.resolve(wearing(new WornItem(FRAME_ID), nickname()), "profileCard");

    expect(resolved.map(item => item.kind.key)).toEqual(["nickname.style", "profile.frame"]);
  });

  test("a row whose kind this build does not ship is skipped and counted", async () => {
    const store = await loadedStore();

    expect(store.resolve(wearing(new WornItem(FUTURE_ID)), "profileCard")).toEqual([]);
    expect(renderFailures()).toEqual([{ kind: "profile.hologram", reason: "unknown_kind" }]);
  });

  test("a kind the server switched off is skipped without counting a failure", async () => {
    const store = await loadedStore(catalogueWith(["avatar.decoration"]));

    expect(store.resolve(wearing(new WornItem(FRAME_ID), nickname()), "profileCard")).toEqual([]);
    expect(renderFailures()).toEqual([]);
  });

  test("an item missing from the catalogue is skipped and counted", async () => {
    const store = await loadedStore();

    expect(store.resolve(wearing(new WornItem("cccccccc-0000-0000-0000-000000000000")), "avatar")).toEqual([]);
    expect(renderFailures()).toEqual([{ kind: "unknown", reason: "missing_row" }]);
  });

  test("a payload this build cannot read is skipped and counted once, however often it renders", async () => {
    const store = await loadedStore();
    const profile = wearing(new WornItem(BROKEN_FRAME_ID));

    for (let render = 0; render < 5; render++) {
      expect(store.resolve(profile, "profileCard")).toEqual([]);
    }

    expect(renderFailures()).toEqual([{ kind: "profile.frame", reason: "payload_rejected" }]);
  });

  test("an entry that is neither union case is skipped", async () => {
    const store = await loadedStore();
    const stranger = { UnionKey: "WornBadge", UnionIndex: 2 } as unknown as IWornCosmetic;

    expect(store.resolve(wearing(stranger), "profileCard")).toEqual([]);
    expect(renderFailures()).toEqual([{ kind: "unknown", reason: "unknown_entry" }]);
  });

  test("a profile flattened by IndexedDB resolves the same as a live one", async () => {
    const store = await loadedStore();
    const flattened = structuredClone(wearing(new WornItem(FRAME_ID), nickname({ font: FONT_ID })));

    expect(store.resolve(flattened, "profileCard").map(item => item.kind.key)).toEqual(["nickname.style", "profile.frame"]);
  });
});

describe("a worn nickname", () => {
  test("is a look composed from its axes and its wearer's tuning", async () => {
    const store = await loadedStore();

    const [style] = store.resolve(
      wearing(nickname({
        font: FONT_ID.toUpperCase(),
        effect: GLOW_ID,
        colors: [0xff112233 | 0, 0xff445566 | 0],
        angle: 45,
        shape: NicknameGradientShape.Radial,
        weight: 800,
        letterSpacing: 5,
      })),
      "nicknameInMessages",
    );

    expect(style.kind.key).toBe("nickname.style");
    expect(style.itemId).toBeNull();
    expect(style.payload).toEqual({
      colors: [0xff112233 | 0, 0xff445566 | 0],
      angle: 45,
      shape: "radial",
      animate: null,
      weight: 800,
      letterSpacingCentiEm: 5,
    });
    expect(optionOn(style, "font")).toMatchObject({
      kindKey: "option.font",
      slug: "lato",
      payload: { cssFamily: "Lato" },
      assets: { primary: "lato-file" },
    });
    expect(optionOn(style, "effect")?.slug).toBe("glow");
  });

  test("an effect with no client module is dropped and the rest of the look stands", async () => {
    const store = await loadedStore();

    const [style] = store.resolve(wearing(nickname({ font: FONT_ID, effect: PRISM_ID })), "memberListRow");

    expect(optionOn(style, "effect")).toBeUndefined();
    expect(optionOn(style, "font")?.slug).toBe("lato");
    expect(renderFailures()).toEqual([{ kind: "option.text-effect", reason: "unimplemented_slug" }]);
  });

  test("an axis pointing at another kind's row is dropped", async () => {
    const store = await loadedStore();

    const [style] = store.resolve(wearing(nickname({ font: GLOW_ID })), "profileCard");

    expect(style.options).toEqual([]);
    expect(renderFailures()).toEqual([{ kind: "option.font", reason: "option_rejected" }]);
  });

  test("an option kind the server switched off is dropped quietly", async () => {
    const store = await loadedStore(catalogueWith(["nickname.style", "option.text-effect"]));

    const [style] = store.resolve(wearing(nickname({ font: FONT_ID, effect: GLOW_ID })), "profileCard");

    expect(style.options.map(option => option.facetId)).toEqual(["effect"]);
    expect(renderFailures()).toEqual([]);
  });

  test("a look with nothing left to draw is not drawn", async () => {
    const store = await loadedStore(catalogueWith(["nickname.style"]));

    expect(store.resolve(wearing(nickname({ colors: null, font: FONT_ID })), "profileCard")).toEqual([]);
  });

  test("more colours than a client may draw is skipped and counted", async () => {
    const store = await loadedStore();

    expect(store.resolve(wearing(nickname({ colors: [1, 2, 3, 4, 5, 6, 7] })), "profileCard")).toEqual([]);
    expect(renderFailures()).toEqual([{ kind: "nickname.style", reason: "payload_rejected" }]);
  });

  test("is not drawn on a face", async () => {
    const store = await loadedStore();

    expect(store.resolve(wearing(nickname()), "avatar")).toEqual([]);
  });
});

describe("the entry worn for a kind", () => {
  test("is found by its catalogue row's kind, or as the nickname", async () => {
    const store = await loadedStore();
    const look = nickname();
    const frame = new WornItem(FRAME_ID);
    const profile = wearing(frame, look);

    expect(store.wornOfKind(profile, "profile.frame")).toBe(frame);
    expect(store.wornOfKind(profile, "nickname.style")).toBe(look);
    expect(store.wornOfKind(profile, "avatar.decoration")).toBeNull();
  });
});

describe("equip", () => {
  test("sends the real union class and writes the answer to the cache, never installing the projection as the own profile", async () => {
    const store = await loadedStore();
    const profile = { userId: "me", cosmetics: [new WornItem(FRAME_ID)] } as unknown as ArgonUserProfile;

    h.equip.mockResolvedValue(new SuccessEquip(profile));

    const error = await store.equip(new WornItem(FRAME_ID));

    expect(error).toBeNull();
    expect(h.equip.mock.calls[0][0]).toBeInstanceOf(WornItem);
    expect(h.me.meProfile).toBeNull();
    expect(h.updateCosmetics).toHaveBeenCalledWith("me", profile.cosmetics);
    expect(h.counted).toContainEqual({
      name: "cosmetic.equip",
      attrs: { action: "equip", kind: "profile.frame", result: "ok" },
    });
  });

  test("a loaded own profile keeps everything but the look: the echo is the broadcast projection", async () => {
    const store = await loadedStore();
    const connections = [{ provider: "github" }];

    h.me.meProfile = { userId: "me", bio: "hello", connections, archetypes: [{ id: "role" }], cosmetics: [] };
    h.equip.mockResolvedValue(new SuccessEquip({
      userId: "me",
      bio: "hello",
      connections: null,
      archetypes: [],
      cosmetics: [new WornItem(FRAME_ID)],
    } as unknown as ArgonUserProfile));

    await store.equip(new WornItem(FRAME_ID));

    const kept = h.me.meProfile as unknown as ArgonUserProfile;

    expect(kept.connections).toBe(connections);
    expect(kept.archetypes).toHaveLength(1);
    expect(kept.cosmetics).toHaveLength(1);
  });

  test("a nickname look goes out as a WornNickname", async () => {
    const store = await loadedStore();

    h.equip.mockResolvedValue(new SuccessEquip({ userId: "me", cosmetics: [] } as unknown as ArgonUserProfile));

    await store.equip(nickname({ font: FONT_ID }));

    expect(h.equip.mock.calls[0][0]).toBeInstanceOf(WornNickname);
    expect(h.counted.at(-1)?.attrs).toMatchObject({ kind: "nickname.style", result: "ok" });
  });

  test("a refusal is returned and changes nothing", async () => {
    const store = await loadedStore();

    h.equip.mockResolvedValue(new FailedEquip(CosmeticError.NOT_OWNED));

    const error = await store.equip(new WornItem(DECORATION_ID));

    expect(error).toBe(CosmeticError.NOT_OWNED);
    expect(h.me.meProfile).toBeNull();
    expect(h.updateCosmetics).not.toHaveBeenCalled();
    expect(h.counted).toContainEqual({
      name: "cosmetic.equip",
      attrs: { action: "equip", kind: "avatar.decoration", result: "failed", error: "not_owned" },
    });
  });

  test("a transport failure is counted and rethrown", async () => {
    const store = await loadedStore();

    h.equip.mockRejectedValue(new Error("socket closed"));

    await expect(store.equip(new WornItem(DECORATION_ID))).rejects.toThrow("socket closed");
    expect(h.counted).toContainEqual({
      name: "cosmetic.equip",
      attrs: { action: "equip", kind: "avatar.decoration", result: "failed", error: "network" },
    });
  });

  test("unequip answered NOT_FOUND drops the stale entry this tab still holds", async () => {
    const store = await loadedStore();

    h.me.meProfile = { userId: "me", cosmetics: [new WornItem(FRAME_ID), new WornItem(DECORATION_ID)] };
    h.unequip.mockResolvedValue(new FailedEquip(CosmeticError.NOT_FOUND));

    expect(await store.unequip("profile.frame")).toBe(CosmeticError.NOT_FOUND);

    const kept = (h.me.meProfile as unknown as ArgonUserProfile).cosmetics ?? [];

    expect(kept).toHaveLength(1);
    expect(store.wornOfKind({ cosmetics: kept }, "profile.frame")).toBeNull();
    expect(h.updateCosmetics).toHaveBeenCalledWith("me", kept);
  });

  test("unequip asks by kind and writes the answer", async () => {
    const store = await loadedStore();
    const profile = { userId: "me", cosmetics: [] } as unknown as ArgonUserProfile;

    h.unequip.mockResolvedValue(new SuccessEquip(profile));

    expect(await store.unequip("profile.frame")).toBeNull();
    expect(h.unequip).toHaveBeenCalledWith("profile.frame");
    expect(h.me.meProfile).toBeNull();
    expect(h.updateCosmetics).toHaveBeenCalledWith("me", []);
    expect(h.counted.at(-1)).toEqual({
      name: "cosmetic.equip",
      attrs: { action: "unequip", kind: "profile.frame", result: "ok" },
    });
  });

  test("an answer that lands after a session reset is not written into the next account", async () => {
    const store = await loadedStore();
    let answer!: (result: SuccessEquip) => void;

    h.equip.mockReturnValue(new Promise<SuccessEquip>(resolve => {
      answer = resolve;
    }));

    const pending = store.equip(new WornItem(FRAME_ID));

    await runSessionReset();
    answer(new SuccessEquip({ userId: "me", cosmetics: [] } as unknown as ArgonUserProfile));

    expect(await pending).toBeNull();
    expect(h.me.meProfile).toBeNull();
    expect(h.updateCosmetics).not.toHaveBeenCalled();
  });
});
