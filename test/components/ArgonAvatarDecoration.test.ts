/**
 * An avatar draws the decoration its owner wears — only when the caller hands over the profile, and
 * never on a `plain` avatar, which is the account switcher's.
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
import { mount } from "@vue/test-utils";

const h = vi.hoisted(() => ({
  getCatalogue: vi.fn(),
}));

vi.mock("@argon/core", async importOriginal => ({
  ...(await importOriginal<object>()),
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count() {} },
  errorKind: () => "network",
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    cosmeticsInteraction: {
      GetCatalogue: h.getCatalogue,
      GetMyCosmetics: async () => ({ owned: [] }),
    },
  }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" }, meProfile: null }) }));
vi.mock("@/store/data/profileCacheStore", () => ({ useProfileCacheStore: () => ({}) }));
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: (fileId: string) => `https://cdn.test/${fileId}`,
  cdnCrossOrigin: () => "anonymous",
}));
vi.mock("@/store/chat/userColors", () => ({ useUserColors: () => ({ getColorByUserId: () => "#123456" }) }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ getUserReactive: () => null }) }));
vi.mock("@/composables/useReducedMotion", async () => {
  const { ref } = await import("vue");

  return { reduceMotion: ref(false) };
});

import {
  AssetSlot,
  PayloadAvatarDecoration,
  WornItem,
  type ArgonUserProfile,
  type CatalogueCosmetic,
  type CosmeticCatalogue,
} from "@argon/glue";

import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const HALO_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const halo: CatalogueCosmetic = {
  cosmeticId: HALO_ID,
  kindKey: "avatar.decoration",
  slug: "halo",
  nameKey: "cosmetic_halo",
  descriptionKey: null,
  rarity: null,
  version: 1,
  payload: new PayloadAvatarDecoration(10, false),
  assets: [{ slot: AssetSlot.Primary, fileId: "halo-file" }],
  availableUntil: null,
  free: true,
  ultima: false,
  text: [],
};

const wearingHalo: Pick<ArgonUserProfile, "cosmetics"> = { cosmetics: [new WornItem(HALO_ID)] };

async function loaded(enabledKinds: string[] = ["avatar.decoration"]) {
  const answer: CosmeticCatalogue = { enabledKinds, items: [halo] };

  h.getCatalogue.mockResolvedValue(answer);

  await useCosmeticsStore().ensureLoaded();
}

function render(props: Record<string, unknown>) {
  return mount(ArgonAvatar, {
    props: { fileId: "face-file", fallback: "Alice", userId: "u1", overridedSize: 40, ...props },
  });
}

function decoration(wrapper: ReturnType<typeof render>) {
  return wrapper.find("img.cosmetic-image-layer");
}

beforeEach(async () => {
  await runSessionReset();

  setActivePinia(createPinia());

  h.getCatalogue.mockReset();
});

describe("an avatar's decoration", () => {
  test("is drawn around the face from the profile it is handed", async () => {
    await loaded();

    const wrapper = render({ profile: wearingHalo });
    const ring = decoration(wrapper);

    expect(ring.exists()).toBe(true);
    expect(ring.attributes("src")).toBe("https://cdn.test/halo-file");
    expect(ring.attributes("style")).toContain("width: calc(100% + 20%)");
    expect(wrapper.find("img:not(.cosmetic-image-layer)").attributes("src")).toBe("https://cdn.test/face-file");
  });

  test("lets the decoration out of the face's clip, positioned against the face", async () => {
    await loaded();

    const wrapper = render({ profile: wearingHalo });
    const root = wrapper.get("img.cosmetic-image-layer").element.parentElement!;

    expect(root.className).toContain("relative");
    expect(root.className).toContain("overflow-visible");
  });

  test("is absent without a profile, which is every avatar whose caller passes none", async () => {
    await loaded();

    const wrapper = render({});

    expect(decoration(wrapper).exists()).toBe(false);
    expect(wrapper.find("img").classes()).not.toContain("z-[1]");
  });

  test("is absent on a plain avatar", async () => {
    await loaded();

    expect(decoration(render({ profile: wearingHalo, plain: true })).exists()).toBe(false);
  });

  test("is absent while the kind is switched off", async () => {
    await loaded(["profile.frame"]);

    expect(decoration(render({ profile: wearingHalo })).exists()).toBe(false);
  });

  test("is absent for an item the catalogue does not hold", async () => {
    await loaded();

    const stranger = { cosmetics: [new WornItem("bbbbbbbb-0000-0000-0000-000000000009")] };

    expect(decoration(render({ profile: stranger })).exists()).toBe(false);
  });
});
