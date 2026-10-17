/**
 * The wardrobe picker: a draft until Apply, which emits exactly what goes over the wire — a WornItem
 * for a catalogue kind — and nothing at all while the draft holds a row this account may not wear.
 * Taking a kind off is a draft too, sent as an unequip.
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
  flushPromises,
  mount,
} from "@vue/test-utils";

const h = vi.hoisted(() => ({
  getCatalogue: vi.fn(),
  getMyCosmetics: vi.fn(),
  me: {
    me: { userId: "me", displayName: "Omni", username: "omni", avatarFileId: null },
    meProfile: null as unknown,
    isPremium: false,
  },
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
      GetCatalogue: h.getCatalogue,
      GetMyCosmetics: h.getMyCosmetics,
      Equip: vi.fn(),
      Unequip: vi.fn(),
    },
  }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => h.me }));
vi.mock("@/store/data/profileCacheStore", () => ({
  useProfileCacheStore: () => ({ updateCosmetics: async () => {} }),
}));
vi.mock("@/store/system/localeStore", async () => {
  const { ref } = await import("vue");
  const currentLocale = ref("en");

  return {
    useLocale: () => ({
      t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
      currentLocale,
    }),
    documentLanguage: (locale: string) => locale,
  };
});
vi.mock("@/composables/useReducedMotion", async () => {
  const { ref } = await import("vue");

  return { reduceMotion: ref(false) };
});
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: (fileId: string) => `cdn:${fileId}`,
  cdnCrossOrigin: () => undefined,
}));
vi.mock("@argon/ui/dialog", async () => {
  const { defineComponent, h: renderNode } = await import("vue");
  const pass = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => renderNode("div", { class: name }, slots.default?.()) });

  return {
    Dialog: defineComponent({
      props: { open: Boolean },
      setup: (props, { slots }) => () => (props.open ? renderNode("div", { "data-dialog": "" }, slots.default?.()) : null),
    }),
    DialogContent: pass("DialogContent"),
    DialogHeader: pass("DialogHeader"),
    DialogTitle: pass("DialogTitle"),
  };
});
vi.mock("@argon/ui/button", async () => {
  const { defineComponent, h: renderNode } = await import("vue");

  return {
    Button: defineComponent({
      inheritAttrs: false,
      setup: (_, { attrs, slots }) => () => renderNode("button", { type: "button", ...attrs }, slots.default?.()),
    }),
  };
});
vi.mock("@/cosmetics/CosmeticLookPreview.vue", async () => {
  const { defineComponent, h: renderNode } = await import("vue");

  return {
    default: defineComponent({
      name: "CosmeticLookPreview",
      props: { profile: { type: Object, default: null }, surfaces: { type: Array, default: () => [] } },
      setup: () => () => renderNode("div", { class: "look-preview" }),
    }),
  };
});
vi.mock("@/components/settings/cosmetics/CosmeticCell.vue", async () => {
  const { defineComponent, h: renderNode } = await import("vue");

  return { default: defineComponent({ setup: () => () => renderNode("span") }) };
});

import {
  FrameRing,
  PayloadAvatarDecoration,
  PayloadProfileFrame,
  WornItem,
  type ArgonUserProfile,
  type CatalogueCosmetic,
  type CosmeticCatalogue,
  type ICosmeticPayload,
  type IWornCosmetic,
} from "@argon/glue";

import type { WardrobeChange } from "@/components/settings/cosmetics/wardrobeChange";
import CosmeticPickerDialog from "@/components/settings/cosmetics/CosmeticPickerDialog.vue";
import { resolveKind } from "@/cosmetics/registry";
import { runSessionReset } from "@/store/system/sessionLifecycle";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";

const FREE_FRAME = "aaaaaaaa-0000-0000-0000-000000000001";
const LOCKED_FRAME = "aaaaaaaa-0000-0000-0000-000000000002";
const WORN_FRAME = "aaaaaaaa-0000-0000-0000-000000000003";
const DECORATION = "aaaaaaaa-0000-0000-0000-000000000004";

const ring = new FrameRing(true, 100, null, null, 2, [0xff00ff00 | 0], 90, 0);

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
    text: [{ locale: "en", name: slug, description: null }],
    ...overrides,
  };
}

const catalogue: CosmeticCatalogue = {
  enabledKinds: ["avatar.decoration", "profile.frame"],
  items: [
    row(FREE_FRAME, "profile.frame", "vines", new PayloadProfileFrame([ring]), { free: true }),
    row(LOCKED_FRAME, "profile.frame", "gilded", new PayloadProfileFrame([ring]), { ultima: true }),
    row(WORN_FRAME, "profile.frame", "thorns", new PayloadProfileFrame([ring]), { free: true }),
    row(DECORATION, "avatar.decoration", "halo", new PayloadAvatarDecoration(10, false), { free: true }),
  ],
};

function wearing(...cosmetics: IWornCosmetic[]): ArgonUserProfile {
  return { userId: "me", cosmetics } as unknown as ArgonUserProfile;
}

async function mountPicker(
  kindKey: string,
  profile: ArgonUserProfile,
  extra: { busy?: boolean; canUpsell?: boolean } = {},
) {
  h.getCatalogue.mockResolvedValue(catalogue);
  await useCosmeticsStore().ensureLoaded();

  const wrapper = mount(CosmeticPickerDialog, {
    props: {
      open: true,
      kind: resolveKind(kindKey)!,
      profile,
      items: useCosmeticsStore().optionsFor(kindKey),
      busy: false,
      ...extra,
    },
    attachTo: document.body,
  });

  await flushPromises();

  return wrapper;
}

type Picker = Awaited<ReturnType<typeof mountPicker>>;

function tileNamed(wrapper: Picker, name: string) {
  const tile = wrapper.findAll(".picker-cell").find(candidate => candidate.text().includes(name));

  if (tile === undefined) {
    throw new Error(`no tile named ${name}`);
  }

  return tile;
}

/** Pointer events reach a disabled button in a browser, but test-utils will not trigger them on one. */
async function pointAt(tile: ReturnType<typeof tileNamed>, type: "mouseenter" | "mouseleave"): Promise<void> {
  tile.element.dispatchEvent(new MouseEvent(type));
  await flushPromises();
}

function buttonSaying(wrapper: Picker, key: string) {
  return wrapper.findAll(".picker-actions button").find(button => button.text() === key);
}

function applyButton(wrapper: Picker) {
  return buttonSaying(wrapper, "apply")!;
}

function applied(wrapper: Picker): WardrobeChange[] {
  return (wrapper.emitted("apply") ?? []).map(args => args[0] as WardrobeChange);
}

beforeEach(async () => {
  await runSessionReset();
  setActivePinia(createPinia());
  h.getCatalogue.mockReset();
  h.getMyCosmetics.mockReset();
  h.getMyCosmetics.mockResolvedValue({ owned: [] });
  document.body.innerHTML = "";
});

describe("catalogue kinds", () => {
  test("only rows of the kind are offered, and the worn one opens selected", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(WORN_FRAME.toUpperCase())));

    expect(wrapper.findAll(".picker-cell")).toHaveLength(3);
    expect(tileNamed(wrapper, "thorns").attributes("aria-checked")).toBe("true");
    expect(tileNamed(wrapper, "thorns").classes()).toContain("picker-cell--active");
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  test("apply sends the chosen row as a WornItem, and leaves closing to whoever sends it", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(WORN_FRAME)));

    await tileNamed(wrapper, "vines").trigger("click");
    await applyButton(wrapper).trigger("click");

    const [change] = applied(wrapper);

    expect(change.action).toBe("equip");
    expect(change.kindKey).toBe("profile.frame");
    expect(change.action === "equip" && change.worn).toBeInstanceOf(WornItem);
    expect(change.action === "equip" && (change.worn as WornItem).itemId).toBe(FREE_FRAME);
    expect(wrapper.emitted("update:open")).toBeUndefined();

    wrapper.unmount();
  });

  test("a locked row cannot be chosen, says so in its name, and its padlock is explained under the list", async () => {
    const wrapper = await mountPicker("profile.frame", wearing());
    const gilded = tileNamed(wrapper, "gilded");

    expect(gilded.attributes("disabled")).toBeDefined();
    expect(gilded.classes()).toContain("picker-cell--locked");
    expect(gilded.attributes("aria-label")).toBe("gilded, cosmetic_locked");
    expect(wrapper.get(".picker-caption").text()).toBe("");

    await pointAt(gilded, "mouseenter");

    expect(wrapper.get(".picker-caption").text()).toContain("cosmetic_locked_ultima");
    expect(wrapper.find(".picker-upsell").exists()).toBe(false);

    await pointAt(gilded, "mouseleave");

    expect(wrapper.get(".picker-caption").text()).toBe("");

    wrapper.unmount();
  });

  test("an Ultima padlock offers Ultima when the account can get it", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(), { canUpsell: true });

    await pointAt(tileNamed(wrapper, "gilded"), "mouseenter");
    await wrapper.get(".picker-upsell").trigger("click");

    expect(wrapper.emitted("upsell")).toHaveLength(1);

    wrapper.unmount();
  });

  test("a worn row this account may no longer wear keeps explaining itself, whatever is pointed at", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(LOCKED_FRAME)));

    expect(wrapper.get(".picker-caption").text()).toContain("cosmetic_locked_ultima");

    await tileNamed(wrapper, "vines").trigger("mouseenter");

    expect(wrapper.get(".picker-caption").text()).toContain("cosmetic_locked_ultima");

    wrapper.unmount();
  });

  test("an offer that ends says until when", async () => {
    const ending = { toDate: () => new Date("2026-12-31T00:00:00Z") } as unknown as CatalogueCosmetic["availableUntil"];

    catalogue.items[0] = row(FREE_FRAME, "profile.frame", "vines", new PayloadProfileFrame([ring]), { free: true, availableUntil: ending });

    try {
      const wrapper = await mountPicker("profile.frame", wearing());

      await tileNamed(wrapper, "vines").trigger("mouseenter");

      expect(wrapper.get(".picker-caption").text()).toContain("cosmetic_available_until");

      wrapper.unmount();
    } finally {
      catalogue.items[0] = row(FREE_FRAME, "profile.frame", "vines", new PayloadProfileFrame([ring]), { free: true });
    }
  });

  test("taking a worn kind off is a draft until Apply, which sends the unequip", async () => {
    const wrapper = await mountPicker("avatar.decoration", wearing(new WornItem(DECORATION)));

    await buttonSaying(wrapper, "cosmetic_clear")!.trigger("click");

    expect(applied(wrapper)).toEqual([]);
    expect(buttonSaying(wrapper, "cosmetic_clear")).toBeUndefined();
    expect(tileNamed(wrapper, "halo").attributes("aria-checked")).toBe("false");

    await applyButton(wrapper).trigger("click");

    expect(applied(wrapper)).toEqual([{ action: "unequip", kindKey: "avatar.decoration" }]);

    wrapper.unmount();
  });

  test("while a change is on its way nothing can be applied, chosen, taken off or dismissed", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(WORN_FRAME)), { busy: true });

    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();
    expect(buttonSaying(wrapper, "cosmetic_clear")!.attributes("disabled")).toBeDefined();
    expect(buttonSaying(wrapper, "cancel")!.attributes("disabled")).toBeDefined();

    for (const tile of wrapper.findAll(".picker-cell")) {
      expect(tile.attributes("disabled")).toBeDefined();
    }

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(wrapper.emitted("update:open")).toBeUndefined();

    wrapper.unmount();
  });

  test("Escape and Cancel close it when nothing is on its way", async () => {
    const wrapper = await mountPicker("profile.frame", wearing());

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await buttonSaying(wrapper, "cancel")!.trigger("click");

    expect(wrapper.emitted("update:open")).toEqual([[false], [false]]);

    wrapper.unmount();
  });

  test("a draft is thrown away on close and the worn row is selected again on reopen", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(WORN_FRAME)));

    await tileNamed(wrapper, "vines").trigger("click");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    expect(tileNamed(wrapper, "thorns").attributes("aria-checked")).toBe("true");
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();

    wrapper.unmount();
  });

  test("asks again what may be worn every time it opens", async () => {
    const wrapper = await mountPicker("profile.frame", wearing());

    expect(h.getMyCosmetics).toHaveBeenCalledTimes(2);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(h.getMyCosmetics).toHaveBeenCalledTimes(3);

    wrapper.unmount();
  });

  test("an untouched draft follows the look when it changes elsewhere; a touched one stays", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(WORN_FRAME)));

    await wrapper.setProps({ profile: wearing(new WornItem(FREE_FRAME)) });

    expect(tileNamed(wrapper, "vines").attributes("aria-checked")).toBe("true");
    expect(applyButton(wrapper).attributes("disabled")).toBeDefined();

    await tileNamed(wrapper, "thorns").trigger("click");
    await wrapper.setProps({ profile: wearing() });

    expect(tileNamed(wrapper, "thorns").attributes("aria-checked")).toBe("true");

    wrapper.unmount();
  });

  test("nothing worn offers nothing to take off", async () => {
    const wrapper = await mountPicker("avatar.decoration", wearing());

    expect(buttonSaying(wrapper, "cosmetic_clear")).toBeUndefined();

    wrapper.unmount();
  });

  test("the previews draw the draft over the rest of the look", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(WORN_FRAME), new WornItem(DECORATION)));

    await tileNamed(wrapper, "vines").trigger("click");

    const previews = wrapper.findAllComponents({ name: "CosmeticLookPreview" });

    expect(previews).toHaveLength(2);

    for (const preview of previews) {
      const drawn = (preview.props("profile") as ArgonUserProfile).cosmetics ?? [];

      expect(drawn.map(entry => (entry as WornItem).itemId)).toEqual([DECORATION, FREE_FRAME]);
    }

    wrapper.unmount();
  });
});

describe("keyboard", () => {
  test("the chosen tile is the only tab stop; with none chosen the first that can be chosen stands in", async () => {
    const chosen = await mountPicker("profile.frame", wearing(new WornItem(WORN_FRAME)));

    expect(chosen.findAll(".picker-cell").map(tile => tile.attributes("tabindex"))).toEqual(["-1", "0", "-1"]);

    chosen.unmount();

    const none = await mountPicker("profile.frame", wearing());

    expect(none.findAll(".picker-cell").map(tile => tile.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);

    none.unmount();
  });

  test("arrows, Home and End choose along what can be chosen, wrapping and skipping a locked tile", async () => {
    const wrapper = await mountPicker("profile.frame", wearing(new WornItem(FREE_FRAME)));

    await tileNamed(wrapper, "vines").trigger("keydown", { key: "ArrowRight" });

    expect(tileNamed(wrapper, "thorns").attributes("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(tileNamed(wrapper, "thorns").element);

    await tileNamed(wrapper, "thorns").trigger("keydown", { key: "ArrowRight" });

    expect(tileNamed(wrapper, "vines").attributes("aria-checked")).toBe("true");

    await tileNamed(wrapper, "vines").trigger("keydown", { key: "End" });

    expect(tileNamed(wrapper, "thorns").attributes("aria-checked")).toBe("true");
    expect(tileNamed(wrapper, "gilded").attributes("aria-checked")).toBe("false");

    await tileNamed(wrapper, "thorns").trigger("keydown", { key: "Home", altKey: true });

    expect(tileNamed(wrapper, "thorns").attributes("aria-checked")).toBe("true");

    wrapper.unmount();
  });
});
