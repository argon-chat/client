/**
 * A display name drawn through what its owner wears.
 *
 * With nothing worn — no profile, nothing on, or the catalogue switched the kind off — it is the
 * plain span the surface drew before, in the surface's own colour. With a nickname look on, the
 * name goes through TextStyle, which takes the wearer's colours over the surface's.
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
  WornNickname,
  type ArgonUserProfile,
  type CosmeticCatalogue,
} from "@argon/glue";
import { mount } from "@vue/test-utils";

import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
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
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: (fileId: string) => `https://cdn.test/${fileId}`,
  cdnCrossOrigin: () => "anonymous",
}));
vi.mock("@/composables/useReducedMotion", async () => {
  const { ref } = await import("vue");

  return { reduceMotion: ref(false) };
});

const RED = 0xffff0000 | 0;
const BLUE = 0xff0000ff | 0;

function catalogue(enabledKinds: string[]): CosmeticCatalogue {
  return { enabledKinds, items: [] };
}

function wearing(...colors: number[]): Pick<ArgonUserProfile, "cosmetics"> {
  return { cosmetics: [new WornNickname(null, null, colors, null, null, null, null, null)] };
}

async function loaded(enabledKinds: string[] = ["nickname.style"]) {
  mocks.getCatalogue.mockResolvedValue(catalogue(enabledKinds));

  await useCosmeticsStore().ensureLoaded();
}

function render(profile: Pick<ArgonUserProfile, "cosmetics"> | null, fallbackColor: string | null = "rgb(1, 2, 3)") {
  return mount(CosmeticNickname, {
    props: { profile, surface: "nicknameInMessages", fallbackColor: fallbackColor ?? undefined },
    slots: { default: "Alice" },
    attrs: { class: "author-name" },
  });
}

beforeEach(async () => {
  await runSessionReset();

  setActivePinia(createPinia());

  mocks.getCatalogue.mockReset();
});

describe("with nothing worn", () => {
  test("is a bare span in the surface's colour, carrying the host's class", async () => {
    await loaded();

    const wrapper = render(null);
    const span = wrapper.get("span");

    expect(span.text()).toBe("Alice");
    expect(span.classes()).toContain("author-name");
    expect(span.classes()).not.toContain("cosmetic-text-style");
    expect(span.attributes("style")).toContain("color: rgb(1, 2, 3)");
  });

  test("sets no colour when the surface offers none", async () => {
    await loaded();

    const wrapper = render({ cosmetics: [] }, null);

    expect(wrapper.get("span").attributes("style")).toBeUndefined();
  });

  test("stays plain while the catalogue has the kind switched off", async () => {
    await loaded(["avatar.decoration"]);

    const wrapper = render(wearing(RED));

    expect(wrapper.find(".cosmetic-text-style").exists()).toBe(false);
    expect(wrapper.get("span").attributes("style")).toContain("color: rgb(1, 2, 3)");
  });

  test("stays plain before the catalogue has arrived", () => {
    const wrapper = render(wearing(RED));

    expect(wrapper.find(".cosmetic-text-style").exists()).toBe(false);
  });
});

describe("with a nickname look on", () => {
  test("paints the wearer's colour over the surface's", async () => {
    await loaded();

    const wrapper = render(wearing(RED));
    const styled = wrapper.get(".cosmetic-text-style");

    expect(styled.text()).toBe("Alice");
    expect(styled.classes()).toContain("author-name");
    expect(styled.attributes("style")).toContain("color: rgba(255, 0, 0, 1.00)");
    expect(styled.attributes("style")).not.toContain("rgb(1, 2, 3)");
  });

  test("draws a gradient for more than one colour", async () => {
    await loaded();

    const wrapper = render(wearing(RED, BLUE));
    const style = wrapper.get(".cosmetic-text-style").attributes("style") ?? "";

    expect(style).toContain("linear-gradient");
    expect(style).toContain("rgba(255, 0, 0, 1.00)");
    expect(style).toContain("rgba(0, 0, 255, 1.00)");
  });

  test("does not draw on a surface the kind does not name", async () => {
    await loaded();

    const wrapper = mount(CosmeticNickname, {
      props: { profile: wearing(RED), surface: "avatar" },
      slots: { default: "Alice" },
    });

    expect(wrapper.find(".cosmetic-text-style").exists()).toBe(false);
  });
});
