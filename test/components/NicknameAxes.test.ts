/**
 * The nickname's axes as the original picker drew them — one row of chips per axis, a reset beside
 * the heading, a locked option padlocked and not pressable — with each axis a single radio group:
 * one tab stop, arrows / Home / End that move and choose, and a locked option that says so.
 */

import {
  afterEach,
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
  PayloadFont,
  PayloadTextEffect,
  type CatalogueCosmetic,
  type CosmeticCatalogue,
  type ICosmeticPayload,
} from "@argon/glue";
import {
  mount,
  type DOMWrapper,
  type VueWrapper,
} from "@vue/test-utils";

import NicknameAxes from "@/components/settings/cosmetics/NicknameAxes.vue";
import type { NicknameAxes as NicknameAxesValue } from "@/cosmetics/wire";
import { resolveKind } from "@/cosmetics/registry";
import { runSessionReset } from "@/store/system/sessionLifecycle";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

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
vi.mock("@/store/system/localeStore", async () => {
  const { ref } = await import("vue");
  const currentLocale = ref("en");

  return {
    useLocale: () => ({ t: (key: string) => key, currentLocale }),
    documentLanguage: (locale: string) => locale,
  };
});
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: (fileId: string) => `cdn:${fileId}`,
  cdnCrossOrigin: () => undefined,
}));
vi.mock("@/cosmetics/chips/optionChips", () => ({ chipForOptionKind: () => null }));

const LATO = "aaaaaaaa-0000-0000-0000-000000000004";
const MONO = "aaaaaaaa-0000-0000-0000-000000000005";
const GLOW = "aaaaaaaa-0000-0000-0000-000000000006";
const SERIF = "aaaaaaaa-0000-0000-0000-000000000007";

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
    free: true,
    ultima: false,
    text: [{ locale: "en", name: slug, description: null }],
    ...overrides,
  };
}

const catalogue: CosmeticCatalogue = {
  enabledKinds: ["nickname.style", "option.font", "option.text-effect"],
  items: [
    row(LATO, "option.font", "lato", new PayloadFont("Lato")),
    row(MONO, "option.font", "mono", new PayloadFont("Mono"), { free: false }),
    row(SERIF, "option.font", "serif", new PayloadFont("Serif")),
    row(GLOW, "option.text-effect", "glow", new PayloadTextEffect()),
  ],
};

function wearable(item: CatalogueCosmetic): boolean {
  return item.free;
}

function tabStops(radios: DOMWrapper<HTMLElement>[]): number[] {
  const stops: number[] = [];

  for (let index = 0; index < radios.length; index++) {
    if (radios[index].attributes("tabindex") === "0") {
      stops.push(index);
    }
  }

  return stops;
}

beforeEach(async () => {
  await runSessionReset();

  setActivePinia(createPinia());

  mocks.getCatalogue.mockReset();
  mocks.getCatalogue.mockResolvedValue(catalogue);

  await useCosmeticsStore().ensureLoaded();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("nickname axes", () => {
  function mountAxes(axes: NicknameAxesValue, props: Record<string, unknown> = {}) {
    return mount(NicknameAxes, {
      props: {
        kind: resolveKind("nickname.style")!,
        axes,
        tuning: { colors: [], angle: null, shape: null, animate: null, weight: null, letterSpacingCentiEm: null },
        wearable,
        sample: "Omni",
        ...props,
      },
      attachTo: document.body,
    });
  }

  function fontRadios(wrapper: VueWrapper): DOMWrapper<HTMLElement>[] {
    return wrapper.findAll<HTMLElement>('[role="radiogroup"]')[0].findAll<HTMLElement>('[role="radio"]');
  }

  function effectRadios(wrapper: VueWrapper): DOMWrapper<HTMLElement>[] {
    return wrapper.findAll<HTMLElement>('[role="radiogroup"]')[1].findAll<HTMLElement>('[role="radio"]');
  }

  function axesEmitted(wrapper: VueWrapper): unknown[] {
    const emitted = wrapper.emitted("update:axes") ?? [];
    const values: unknown[] = [];

    for (const args of emitted) {
      values.push(args[0]);
    }

    return values;
  }

  test("each axis has one tab stop: its chosen option, or the first that can be chosen", () => {
    const wrapper = mountAxes({ font: SERIF, effect: null });

    expect(tabStops(fontRadios(wrapper))).toEqual([1]);
    expect(tabStops(effectRadios(wrapper))).toEqual([0]);
  });

  test("arrows, Home and End choose along one axis, skip what is locked and leave the other alone", async () => {
    const wrapper = mountAxes({ font: null, effect: GLOW });

    await fontRadios(wrapper)[0].trigger("keydown", { key: "ArrowRight" });

    expect(document.activeElement).toBe(fontRadios(wrapper)[1].element);

    await fontRadios(wrapper)[1].trigger("keydown", { key: "End" });
    await fontRadios(wrapper)[1].trigger("keydown", { key: "Home" });
    await fontRadios(wrapper)[0].trigger("keydown", { key: "ArrowLeft" });

    expect(axesEmitted(wrapper)).toEqual([
      { font: SERIF, effect: GLOW },
      { font: SERIF, effect: GLOW },
      { font: LATO, effect: GLOW },
      { font: SERIF, effect: GLOW },
    ]);
    expect(document.activeElement).toBe(fontRadios(wrapper)[1].element);
  });

  test("clicking the chosen option takes it off, and so does the axis's reset", async () => {
    const wrapper = mountAxes({ font: LATO, effect: GLOW });

    await fontRadios(wrapper)[0].trigger("click");
    await wrapper.findAll(".picker-axis-clear")[1].trigger("click");

    expect(axesEmitted(wrapper)).toEqual([
      { font: null, effect: GLOW },
      { font: LATO, effect: null },
    ]);
  });

  test("a locked option cannot be chosen and says so in its name", () => {
    const wrapper = mountAxes({ font: MONO, effect: null });
    const mono = fontRadios(wrapper)[2];

    expect(fontRadios(wrapper)[0].attributes("aria-label")).toBe("lato");
    expect(mono.attributes("aria-label")).toBe("mono, cosmetic_locked");
    expect(mono.attributes("aria-checked")).toBe("true");
    expect(mono.attributes("disabled")).toBeDefined();
    expect(mono.find(".picker-lock").exists()).toBe(true);
  });

  test("busy, nothing on the axes can be pressed", () => {
    const wrapper = mountAxes({ font: LATO, effect: null }, { disabled: true });

    for (const radio of [...fontRadios(wrapper), ...effectRadios(wrapper)]) {
      expect(radio.attributes("disabled")).toBeDefined();
    }

    expect(wrapper.get(".picker-axis-clear").attributes("disabled")).toBeDefined();
  });
});
