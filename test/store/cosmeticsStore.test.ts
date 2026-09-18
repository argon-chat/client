/**
 * Turning what the server says somebody is wearing into something renderable.
 *
 * Every rule here is a "renders nothing" rule, and that is the point: a cosmetic the client cannot
 * draw must disappear quietly, because the alternative is a profile card that throws. The failures
 * this guards are all invisible on screen — the surface renders without the item and nobody sees an
 * error — which is why they are pinned here and counted through `cosmetic.render.failed`.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const counted: Array<{ name: string; attrs?: Record<string, unknown> }> = [];

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: {
    count(name: string, attrs?: Record<string, unknown>) {
      counted.push({ name, attrs });
    },
    distribution() {},
    gauge() {},
  },
}));
let wornByAnswer: Array<{
  userId: string;
  cosmetics: unknown[];
  displayNameOverride?: string | null;
  avatarFileIdOverride?: string | null;
}> = [];
const askedFor: string[][] = [];

let catalogueAnswer: { items: Array<{ cosmeticId: string; version: number }> } = { items: [] };

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    cosmeticsInteraction: {
      GetWornBy: async (_spaceId: string | null, userIds: string[]) => {
        askedFor.push([...userIds]);
        return wornByAnswer;
      },
      GetCatalogue: async () => catalogueAnswer,
    },
  }),
}));

const invalidatedWith: Array<ReadonlyMap<string, number>> = [];
let staleProfileUsers: string[] = [];

vi.mock("@/store/data/profileCacheStore", () => ({
  useProfileCacheStore: () => ({
    async invalidateStaleCosmetics(versionOf: ReadonlyMap<string, number>) {
      invalidatedWith.push(versionOf);
      return staleProfileUsers;
    },
  }),
}));
vi.mock("@/store/system/sessionLifecycle", () => ({
  onSessionReset: () => {},
}));

const disabledKinds = new Set<string>();

vi.mock("@/store/features/featureFlagsStore", () => ({
  useFeatureFlags: () => ({
    isCosmeticKindEnabled: (kindKey: string) => !disabledKinds.has(kindKey),
  }),
}));

import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { optionOn } from "@/cosmetics/types";
import type { ArgonUserProfile, EquippedCosmetic } from "@argon/glue";

function equipped(overrides: Partial<EquippedCosmetic> & { kindKey: string }): EquippedCosmetic {
  return {
    itemId: "11111111-1111-1111-1111-111111111111",
    slug: "thing",
    layer: 100,
    slotIndex: 0,
    payloadJson: "{}",
    assets: [],
    ...overrides,
  } as unknown as EquippedCosmetic;
}

function wearing(...items: EquippedCosmetic[]): ArgonUserProfile {
  return { userId: "u", cosmetics: items } as unknown as ArgonUserProfile;
}

function option(facetId: string, kindKey: string, slug: string, payloadJson: string) {
  return {
    facetId,
    kindKey,
    slug,
    itemId: "22222222-2222-2222-2222-222222222222",
    payloadJson,
    assets: [],
    version: null,
  };
}

describe("scoped identity", () => {
  beforeEach(() => {
    wornByAnswer = [];
    setActivePinia(createPinia());
  });

  test("a look's name is remembered per scope and read back synchronously", async () => {
    wornByAnswer = [{ userId: "u", cosmetics: [], displayNameOverride: "Пикми", avatarFileIdOverride: "file-1" }];

    const store = useCosmeticsStore();

    await store.prefetchWorn("space-1", ["u"]);

    expect(store.wornIdentity("space-1", "u")).toEqual({ name: "Пикми", avatar: "file-1" });
  });

  test("somebody the batch answered nothing about inherits their account", async () => {
    wornByAnswer = [];

    const store = useCosmeticsStore();

    await store.prefetchWorn("space-1", ["u"]);

    expect(store.wornIdentity("space-1", "u")).toEqual({ name: null, avatar: null });
  });

  test("a scope not asked about yet answers inherit rather than waiting", () => {
    const store = useCosmeticsStore();

    expect(store.wornIdentity("space-9", "u")).toEqual({ name: null, avatar: null });
  });

  test("one scope's name is not another's", async () => {
    wornByAnswer = [{ userId: "u", cosmetics: [], displayNameOverride: "Здесь", avatarFileIdOverride: null }];

    const store = useCosmeticsStore();

    await store.prefetchWorn("space-1", ["u"]);

    expect(store.wornIdentity("space-1", "u").name).toBe("Здесь");
    expect(store.wornIdentity("space-2", "u").name).toBeNull();
  });
});

describe("axis composition", () => {
  beforeEach(() => {
    disabledKinds.clear();
    setActivePinia(createPinia());
  });

  test("the options a wearer composed arrive resolved, keyed by axis", () => {
    const store = useCosmeticsStore();

    const [style] = store.resolve(
      wearing(equipped({
        kindKey: "nickname.style",
        options: [
          option("font", "option.font", "lato", '{"cssFamily":"Lato, sans-serif"}'),
          option("color", "option.swatch", "cyan", '{"hex":"#06b6d4"}'),
        ],
      })),
      "profileCard",
    );

    expect(optionOn(style, "font")?.payload).toEqual({ cssFamily: "Lato, sans-serif" });
    expect(optionOn(style, "color")?.payload).toEqual({ hex: "#06b6d4" });
  });

  test("an option whose kind the operator switched off is dropped, and the rest stand", () => {
    disabledKinds.add("option.swatch");

    const store = useCosmeticsStore();

    const [style] = store.resolve(
      wearing(equipped({
        kindKey: "nickname.style",
        options: [
          option("font", "option.font", "lato", '{"cssFamily":"Lato, sans-serif"}'),
          option("color", "option.swatch", "cyan", '{"hex":"#06b6d4"}'),
        ],
      })),
      "profileCard",
    );

    expect(optionOn(style, "color")).toBeUndefined();
    expect(optionOn(style, "font")).toBeDefined();
  });

  test("an option payload this build cannot read is dropped rather than rendered as nothing", () => {
    const store = useCosmeticsStore();

    const [style] = store.resolve(
      wearing(equipped({
        kindKey: "nickname.style",
        options: [option("color", "option.swatch", "cyan", '{"hex":"not a colour"}')],
      })),
      "profileCard",
    );

    expect(style.options).toHaveLength(0);
  });

  test("a cosmetic wearing nothing on its axes resolves with no options", () => {
    const store = useCosmeticsStore();

    const [style] = store.resolve(wearing(equipped({ kindKey: "nickname.style" })), "profileCard");

    expect(style.options).toEqual([]);
  });

  test("an option naming a kind this build does not ship is skipped", () => {
    const store = useCosmeticsStore();

    const [style] = store.resolve(
      wearing(equipped({
        kindKey: "nickname.style",
        options: [option("texture", "option.texture", "velvet", "{}")],
      })),
      "profileCard",
    );

    expect(style.options).toEqual([]);
  });
});

describe("cosmetics resolution", () => {
  beforeEach(() => {
    counted.length = 0;
    disabledKinds.clear();
    wornByAnswer = [];
    askedFor.length = 0;
    setActivePinia(createPinia());
  });

  test("an equipped cosmetic resolves on a surface its kind names", () => {
    const store = useCosmeticsStore();

    const resolved = store.resolve(
      wearing(equipped({ kindKey: "profile.background", payloadJson: '{"loop":true,"tintOpacity":0.4}' })),
      "profileCard",
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].kind.key).toBe("profile.background");
  });

  test("and not on a surface it does not", () => {
    const store = useCosmeticsStore();

    const resolved = store.resolve(
      wearing(equipped({ kindKey: "profile.background", payloadJson: '{"loop":true,"tintOpacity":0.4}' })),
      "memberListRow",
    );

    expect(resolved).toHaveLength(0);
  });

  /**
   * The deleted-file path, and the reason an older client is forward-compatible for free: a key no
   * file declares is skipped rather than thrown on.
   */
  test("a kind this build does not have is skipped", () => {
    const store = useCosmeticsStore();

    const resolved = store.resolve(wearing(equipped({ kindKey: "profile.aurora" })), "profileCard");

    expect(resolved).toHaveLength(0);
  });

  test("a kind switched off is skipped", () => {
    disabledKinds.add("profile.background");

    const store = useCosmeticsStore();

    const resolved = store.resolve(
      wearing(equipped({ kindKey: "profile.background", payloadJson: '{"loop":true,"tintOpacity":0.4}' })),
      "profileCard",
    );

    expect(resolved).toHaveLength(0);
  });

  test("malformed json is counted and skipped, never thrown", () => {
    const store = useCosmeticsStore();

    const resolved = store.resolve(
      wearing(equipped({ kindKey: "profile.background", payloadJson: "{not json" })),
      "profileCard",
    );

    expect(resolved).toHaveLength(0);
    expect(counted).toContainEqual({
      name: "cosmetic.render.failed",
      attrs: { kind: "profile.background", reason: "malformed_json" },
    });
  });

  /**
   * A payload its own kind rejects — authored against a newer build, or simply wrong.
   */
  test("a payload the kind rejects is counted and skipped", () => {
    const store = useCosmeticsStore();

    const resolved = store.resolve(
      wearing(equipped({ kindKey: "profile.badge", payloadJson: '{"tint":255}' })),
      "profileCard",
    );

    expect(resolved).toHaveLength(0);
    expect(counted).toContainEqual({
      name: "cosmetic.render.failed",
      attrs: { kind: "profile.badge", reason: "payload_rejected" },
    });
  });

  test("what is worn comes back in compositing order", () => {
    const store = useCosmeticsStore();

    const resolved = store.resolve(
      wearing(
        equipped({ kindKey: "profile.badge", layer: 300, payloadJson: '{"tooltipKey":"badge_staff"}' }),
        equipped({ kindKey: "profile.background", layer: 100, payloadJson: '{"loop":true,"tintOpacity":0.4}' }),
      ),
      "profileCard",
    );

    expect(resolved.map(item => item.kind.key)).toEqual(["profile.background", "profile.badge"]);
  });

  test("a profile wearing nothing resolves to nothing", () => {
    const store = useCosmeticsStore();

    expect(store.resolve({ userId: "u", cosmetics: null } as unknown as ArgonUserProfile, "profileCard")).toEqual([]);
    expect(store.resolve(null, "profileCard")).toEqual([]);
  });

  /**
   * The batch is what makes a member list and a message list possible at all: the row reads an
   * answer that is already in memory, and never asks for one itself.
   */
  test("a row reads nothing until the batch has landed, and never fetches", () => {
    const store = useCosmeticsStore();

    expect(store.wornBy("space-1", "user-1", "memberListRow")).toEqual([]);
    expect(askedFor).toHaveLength(0);
  });

  test("a prefetched answer is readable synchronously", async () => {
    wornByAnswer = [
      {
        userId: "user-1",
        cosmetics: [equipped({ kindKey: "nickname.style", payloadJson: '{"fontId":"inter","weight":700}' })],
      },
    ];

    const store = useCosmeticsStore();
    await store.prefetchWorn("space-1", ["user-1", "user-2"]);

    expect(store.wornBy("space-1", "user-1", "memberListRow")).toHaveLength(1);
    expect(store.wornBy("space-1", "user-2", "memberListRow")).toEqual([]);
  });

  /**
   * Everybody asked about is recorded, including the many who wear nothing — otherwise every scroll
   * would ask about the whole roster again.
   */
  test("people who wear nothing are remembered as such", async () => {
    const store = useCosmeticsStore();

    await store.prefetchWorn("space-1", ["user-1"]);
    await store.prefetchWorn("space-1", ["user-1"]);

    expect(askedFor).toHaveLength(1);
  });

  test("a second window only asks about the people it has not seen", async () => {
    const store = useCosmeticsStore();

    await store.prefetchWorn("space-1", ["user-1", "user-2"]);
    await store.prefetchWorn("space-1", ["user-2", "user-3"]);

    expect(askedFor).toEqual([["user-1", "user-2"], ["user-3"]]);
  });

  /** Scopes are separate: a person can wear a different loadout in every space. */
  test("one space's answer is not another's", async () => {
    wornByAnswer = [
      {
        userId: "user-1",
        cosmetics: [equipped({ kindKey: "nickname.style", payloadJson: '{"fontId":"inter"}' })],
      },
    ];

    const store = useCosmeticsStore();
    await store.prefetchWorn("space-1", ["user-1"]);

    expect(store.wornBy("space-1", "user-1", "memberListRow")).toHaveLength(1);
    expect(store.wornBy("space-2", "user-1", "memberListRow")).toEqual([]);
  });

  test("forgetting one person leaves the rest of the batch alone", async () => {
    wornByAnswer = [
      {
        userId: "user-1",
        cosmetics: [equipped({ kindKey: "nickname.style", payloadJson: '{"fontId":"inter"}' })],
      },
    ];

    const store = useCosmeticsStore();
    await store.prefetchWorn("space-1", ["user-1", "user-2"]);

    store.forgetWorn("user-1");

    // Asking again reaches the server for the forgotten person only.
    await store.prefetchWorn("space-1", ["user-1", "user-2"]);

    expect(askedFor).toEqual([["user-1", "user-2"], ["user-1"]]);
  });

  test("assets arrive keyed by slot, as file ids", () => {
    const store = useCosmeticsStore();

    const resolved = store.resolve(
      wearing(
        equipped({
          kindKey: "profile.background",
          payloadJson: '{"loop":true,"tintOpacity":0.4}',
          assets: [{ slot: "Primary", fileId: "file-1" }] as unknown as EquippedCosmetic["assets"],
        }),
      ),
      "profileCard",
    );

    expect(resolved[0].assets).toEqual({ Primary: "file-1" });
  });
});

/**
 * What happens to a copy of a cosmetic after an operator re-authors the row it came from.
 *
 * <b>Nothing tells anybody.</b> Changing a catalogue row changes nothing about the people wearing
 * it, so no profile event is raised, and the payload they were fetched with is already cached —
 * in memory for a member list, on disk for hours for a profile card. The catalogue read is the only
 * moment a client can find out, and the row's authoring number is the only thing that says so.
 */
describe("a re-authored row reaching what is already held", () => {
  beforeEach(() => {
    wornByAnswer = [];
    askedFor.length = 0;
    invalidatedWith.length = 0;
    staleProfileUsers = [];
    catalogueAnswer = { items: [] };
    disabledKinds.clear();
    setActivePinia(createPinia());
  });

  const ITEM = "11111111-1111-1111-1111-111111111111";

  async function wearingVersion(version: number | null) {
    wornByAnswer = [{
      userId: "u",
      cosmetics: [equipped({ kindKey: "profile.background", payloadJson: "{}", version } as never)],
    }];

    const store = useCosmeticsStore();

    await store.prefetchWorn("space-1", ["u"]);

    return store;
  }

  test("a member row holding an older authoring is dropped and asked again", async () => {
    const store = await wearingVersion(1);

    expect(store.wornBy("space-1", "u", "profileCard")).toHaveLength(1);

    catalogueAnswer = { items: [{ cosmeticId: ITEM, version: 2 }] };
    await store.loadCatalogue();

    expect(store.wornBy("space-1", "u", "profileCard")).toHaveLength(0);

    await store.prefetchWorn("space-1", ["u"]);

    expect(askedFor).toEqual([["u"], ["u"]]);
  });

  test("the same authoring is left alone, or the cache would be pointless", async () => {
    const store = await wearingVersion(2);

    catalogueAnswer = { items: [{ cosmeticId: ITEM, version: 2 }] };
    await store.loadCatalogue();

    expect(store.wornBy("space-1", "u", "profileCard")).toHaveLength(1);
  });

  /** An older server sends no version, and dropping everything on that would undo the cache. */
  test("a server that does not say leaves what is held alone", async () => {
    const store = await wearingVersion(null);

    catalogueAnswer = { items: [{ cosmeticId: ITEM, version: 7 }] };
    await store.loadCatalogue();

    expect(store.wornBy("space-1", "u", "profileCard")).toHaveLength(1);
  });

  test("the cached profiles are handed the same numbers to check themselves against", async () => {
    const store = await wearingVersion(1);

    staleProfileUsers = ["someone-else"];
    catalogueAnswer = { items: [{ cosmeticId: ITEM, version: 2 }] };
    await store.loadCatalogue();

    expect(invalidatedWith).toHaveLength(1);
    expect(invalidatedWith[0].get(ITEM)).toBe(2);
  });
});
