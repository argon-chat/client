/**
 * The wardrobe list: each line says what is worn on its kind, and the picker it opens closes only once
 * the server took the change. A refusal is said in its own words, a lost call is said as one, and
 * either leaves the picker up with the draft intact; taking off something already off is not a failure.
 */

import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";

const h = vi.hoisted(() => ({
  equip: vi.fn(),
  unequip: vi.fn(),
  toast: vi.fn(),
  worn: new Map<string, unknown>(),
  items: new Map<string, unknown>(),
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/store/system/localeStore", async () => {
  const { ref } = await import("vue");
  const currentLocale = ref("en");

  return {
    useLocale: () => ({ t: (key: string) => key, currentLocale }),
  };
});
vi.mock("@/store/auth/meStore", async () => {
  const { ref } = await import("vue");
  const me = {
    me: { userId: "me", displayName: "Omni", username: "omni", avatarFileId: null },
    meProfile: ref({ userId: "me", cosmetics: [] }),
    isPremium: false,
  };

  return { useMe: () => me };
});
vi.mock("@/store/features/cosmeticsStore", async () => {
  const { reactive, ref } = await import("vue");
  const wearableKinds = ref([
    { key: "profile.frame", labelKey: "kind_profile_frame", bare: false },
    { key: "nickname.style", labelKey: "kind_nickname_style", bare: true },
  ]);
  const store = reactive({
    wearableKinds,
    ensureLoaded: async () => {},
    optionsFor: () => [...h.items.values()],
    wornOfKind: (_profile: unknown, kindKey: string) => h.worn.get(kindKey) ?? null,
    itemById: (itemId: string | null | undefined) => (itemId ? h.items.get(itemId) ?? null : null),
    equip: (...args: unknown[]) => h.equip(...args),
    unequip: (...args: unknown[]) => h.unequip(...args),
  });

  return { useCosmeticsStore: () => store };
});
vi.mock("@/components/settings/cosmetics/CosmeticRowPreview.vue", async () => {
  const { defineComponent, h: render } = await import("vue");

  return { default: defineComponent({ setup: () => () => render("span") }) };
});
vi.mock("@/components/settings/cosmetics/CosmeticPickerDialog.vue", async () => {
  const { defineComponent, h: render } = await import("vue");

  return {
    default: defineComponent({
      name: "CosmeticPickerDialog",
      props: {
        open: { type: Boolean, required: true },
        kind: { type: Object, required: true },
        profile: { type: Object, default: null },
        items: { type: Array, required: true },
        busy: { type: Boolean, required: true },
        canUpsell: { type: Boolean, default: false },
      },
      emits: ["update:open", "apply", "upsell"],
      setup: props => () => (props.open ? render("div", { class: "picker-stub" }) : null),
    }),
  };
});

import {
  CosmeticError,
  WornItem,
  WornNickname,
  type CatalogueCosmetic,
} from "@argon/glue";

import CosmeticsPanel from "@/components/settings/cosmetics/CosmeticsPanel.vue";
import {
  equipChange,
  unequipChange,
  type WardrobeChange,
} from "@/components/settings/cosmetics/wardrobeChange";

const FRAME = "aaaaaaaa-0000-0000-0000-000000000001";

const KIND_INDEX: Record<string, number> = { "profile.frame": 0, "nickname.style": 1 };

function frameRow(): CatalogueCosmetic {
  return {
    cosmeticId: FRAME,
    kindKey: "profile.frame",
    slug: "vines",
    nameKey: "cosmetic_vines",
    text: [{ locale: "en", name: "Vines", description: null }],
  } as unknown as CatalogueCosmetic;
}

async function mountPanel(props: { canUpsell?: boolean } = {}): Promise<VueWrapper> {
  const wrapper = mount(CosmeticsPanel, { props });

  await flushPromises();

  return wrapper;
}

function rowOf(wrapper: VueWrapper, kindKey: string) {
  return wrapper.findAll(".worn-row")[KIND_INDEX[kindKey]];
}

function wornLabelOf(wrapper: VueWrapper, kindKey: string): string {
  return rowOf(wrapper, kindKey).get(".worn-value").text();
}

function picker(wrapper: VueWrapper) {
  return wrapper.getComponent({ name: "CosmeticPickerDialog" });
}

function pickerIsOpen(wrapper: VueWrapper): boolean {
  return wrapper.find(".picker-stub").exists();
}

async function openPicker(wrapper: VueWrapper, kindKey: string): Promise<void> {
  await rowOf(wrapper, kindKey).trigger("click");
}

async function send(wrapper: VueWrapper, change: WardrobeChange): Promise<void> {
  picker(wrapper).vm.$emit("apply", change);
  await flushPromises();
}

function frameChange(itemId = FRAME): WardrobeChange {
  return equipChange("profile.frame", new WornItem(itemId));
}

beforeEach(() => {
  h.equip.mockReset();
  h.unequip.mockReset();
  h.toast.mockReset();
  h.worn.clear();
  h.items.clear();
  h.items.set(FRAME, frameRow());
});

describe("worn label", () => {
  test("names the item worn on the kind", async () => {
    h.worn.set("profile.frame", new WornItem(FRAME));

    const wrapper = await mountPanel();

    expect(wornLabelOf(wrapper, "profile.frame")).toBe("Vines");
  });

  test("says none when nothing is worn", async () => {
    const wrapper = await mountPanel();

    expect(wornLabelOf(wrapper, "profile.frame")).toBe("none");
  });

  test("says none when the worn item is not in the catalogue", async () => {
    h.worn.set("profile.frame", new WornItem("bbbbbbbb-0000-0000-0000-000000000009"));

    const wrapper = await mountPanel();

    expect(wornLabelOf(wrapper, "profile.frame")).toBe("none");
  });

  test("a bare kind worn says it is configured", async () => {
    h.worn.set("nickname.style", new WornNickname(null, null, null, null, null, null, null, null));

    const wrapper = await mountPanel();

    expect(wornLabelOf(wrapper, "nickname.style")).toBe("cosmetic_configured");
  });
});

describe("the picker", () => {
  test("opens on the kind of its row, with that kind's rows to choose between", async () => {
    const wrapper = await mountPanel();

    await openPicker(wrapper, "profile.frame");

    expect(pickerIsOpen(wrapper)).toBe(true);
    expect((picker(wrapper).props("kind") as { key: string }).key).toBe("profile.frame");
    expect(picker(wrapper).props("items")).toEqual([frameRow()]);
  });

  test("closes when it asks to", async () => {
    const wrapper = await mountPanel();

    await openPicker(wrapper, "profile.frame");
    picker(wrapper).vm.$emit("update:open", false);
    await flushPromises();

    expect(pickerIsOpen(wrapper)).toBe(false);
  });

  test("an upsell closes it and is passed up", async () => {
    const wrapper = await mountPanel({ canUpsell: true });

    await openPicker(wrapper, "profile.frame");

    expect(picker(wrapper).props("canUpsell")).toBe(true);

    picker(wrapper).vm.$emit("upsell");
    await flushPromises();

    expect(pickerIsOpen(wrapper)).toBe(false);
    expect(wrapper.emitted("upsell")).toHaveLength(1);
  });
});

describe("applying from the picker", () => {
  test("an equip goes to the store with the worn entry, and closes once it takes", async () => {
    h.equip.mockResolvedValue(null);

    const wrapper = await mountPanel();
    const change = frameChange();

    await openPicker(wrapper, "profile.frame");
    await send(wrapper, change);

    expect(h.equip).toHaveBeenCalledWith(change.action === "equip" ? change.worn : null);
    expect(h.toast).not.toHaveBeenCalled();
    expect(pickerIsOpen(wrapper)).toBe(false);
  });

  test("an unequip goes to the store by kind, and taking off something already off is quietly fine", async () => {
    h.unequip.mockResolvedValue(CosmeticError.NOT_FOUND);

    const wrapper = await mountPanel();

    await openPicker(wrapper, "profile.frame");
    await send(wrapper, unequipChange("profile.frame"));

    expect(h.unequip).toHaveBeenCalledWith("profile.frame");
    expect(h.toast).not.toHaveBeenCalled();
    expect(pickerIsOpen(wrapper)).toBe(false);
  });

  test("a refusal is reported in its own words and leaves the picker up", async () => {
    h.equip.mockResolvedValue(CosmeticError.NOT_OWNED);

    const wrapper = await mountPanel();

    await openPicker(wrapper, "profile.frame");
    await send(wrapper, frameChange());

    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "error",
      description: "cosmetic_error_not_owned",
      variant: "destructive",
    }));
    expect(pickerIsOpen(wrapper)).toBe(true);
  });

  test("a call that never arrives is reported as one and leaves the picker up", async () => {
    h.equip.mockRejectedValue(new Error("offline"));

    const wrapper = await mountPanel();

    await openPicker(wrapper, "profile.frame");
    await send(wrapper, frameChange());

    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "cosmetic_error_network" }));
    expect(pickerIsOpen(wrapper)).toBe(true);
    expect(picker(wrapper).props("busy")).toBe(false);
  });

  test("while one change is on its way the rows and the picker are busy, and a second is ignored", async () => {
    let settle!: (value: null) => void;

    h.equip.mockReturnValue(new Promise(resolve => {
      settle = resolve;
    }));

    const wrapper = await mountPanel();

    await openPicker(wrapper, "profile.frame");
    await send(wrapper, frameChange("a"));

    expect(picker(wrapper).props("busy")).toBe(true);
    expect(rowOf(wrapper, "nickname.style").attributes("disabled")).toBeDefined();

    await send(wrapper, frameChange("b"));

    settle(null);
    await flushPromises();

    expect(h.equip).toHaveBeenCalledTimes(1);
    expect(pickerIsOpen(wrapper)).toBe(false);
  });
});
