/**
 * The nickname tuning editor: colours dragged into order with the pointer (or Alt + arrows), no
 * seventh colour, weight in hundreds within 100–900, spacing within −10…50, the dial on a circle,
 * and the shapes one radio group.
 */

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  flushPromises,
  mount,
  type DOMWrapper,
  type VueWrapper,
} from "@vue/test-utils";

vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@/composables/useReducedMotion", async () => {
  const { ref } = await import("vue");

  return { reduceMotion: ref(false) };
});

import {
  MAX_STOPS,
  emptyNicknameStyleTuning,
  type NicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import NicknameTuning from "@/cosmetics/tuning/NicknameTuning.vue";

const RED = 0xffff0000 | 0;
const GREEN = 0xff00ff00 | 0;
const BLUE = 0xff0000ff | 0;

/** Where each colour sits on screen in these tests: 30px wells, 7px apart, on one row. */
const WELL = 30;
const GAP = 7;

const attached: VueWrapper[] = [];

function tuningOf(fields: Partial<NicknameStyleTuning>): NicknameStyleTuning {
  return { ...emptyNicknameStyleTuning(), ...fields };
}

/** Mounted on the page and fed its own writes back, the way a parent's v-model would. */
function mountLive(tuning: NicknameStyleTuning, props: Record<string, unknown> = {}) {
  const wrapper: VueWrapper = mount(NicknameTuning, {
    attachTo: document.body,
    props: {
      tuning,
      ...props,
      "onUpdate:tuning": (next: NicknameStyleTuning) => wrapper.setProps({ tuning: next }),
    },
  });

  attached.push(wrapper);

  return wrapper;
}

/** Mounted with nothing fed back, so a raw value planted on an input is not patched away. */
function mountStill(tuning: NicknameStyleTuning) {
  const wrapper: VueWrapper = mount(NicknameTuning, { attachTo: document.body, props: { tuning } });

  attached.push(wrapper);

  return wrapper;
}

function lastEmitted(wrapper: VueWrapper): NicknameStyleTuning {
  const emitted = wrapper.emitted("update:tuning") ?? [];

  return emitted.at(-1)?.[0] as NicknameStyleTuning;
}

function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

/**
 * Lays the row out the way the stylesheet would, since happy-dom computes no geometry, and stands
 * in for pointer capture, which it does not implement.
 */
function layOut(wrapper: VueWrapper): { captured: number[]; released: number[] } {
  const row = wrapper.get(".tuning-stops").element as HTMLElement;
  const captured: number[] = [];
  const released: number[] = [];

  row.getBoundingClientRect = () => {
    const count = row.querySelectorAll(".stop").length;

    return box(0, 0, count * (WELL + GAP), WELL);
  };
  row.setPointerCapture = (pointerId: number) => {
    captured.push(pointerId);
  };
  row.releasePointerCapture = (pointerId: number) => {
    released.push(pointerId);
  };

  const place = () => {
    const wells = row.querySelectorAll<HTMLElement>(".stop");

    for (let index = 0; index < wells.length; index++) {
      wells[index].getBoundingClientRect = () => box(index * (WELL + GAP), 0, WELL, WELL);
    }
  };

  place();
  new MutationObserver(place).observe(row, { childList: true, subtree: true });

  return { captured, released };
}

function centreOf(index: number): number {
  return index * (WELL + GAP) + WELL / 2;
}

function stops(wrapper: VueWrapper): DOMWrapper<HTMLElement>[] {
  return wrapper.findAll<HTMLElement>(".stop");
}

function pointer(type: string, clientX: number, clientY = WELL / 2): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX, clientY });
}

afterEach(() => {
  for (const wrapper of attached.splice(0)) {
    wrapper.unmount();
  }
});

describe("NicknameTuning — reordering", () => {
  test("dragging a colour along the row puts it in the slot it is aimed at, one slot at a time", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, GREEN, BLUE] }));
    const { captured, released } = layOut(wrapper);
    const row = wrapper.get(".tuning-stops").element;

    stops(wrapper)[0].element.dispatchEvent(pointer("pointerdown", centreOf(0)));
    row.dispatchEvent(pointer("pointermove", centreOf(1)));
    await flushPromises();

    expect(captured).toEqual([7]);
    expect(lastEmitted(wrapper).colors).toEqual([GREEN, RED, BLUE]);
    expect(stops(wrapper)[1].classes()).toContain("stop--held");
    expect(wrapper.get(".tuning-stops").classes()).toContain("tuning-stops--moving");

    row.dispatchEvent(pointer("pointermove", centreOf(2)));
    await flushPromises();

    expect(lastEmitted(wrapper).colors).toEqual([GREEN, BLUE, RED]);
    expect(stops(wrapper)[2].classes()).toContain("stop--held");

    row.dispatchEvent(pointer("pointerup", centreOf(2)));
    await flushPromises();

    expect(released).toEqual([7]);
    expect(wrapper.find(".stop--held").exists()).toBe(false);
    expect(wrapper.get(".tuning-stops").classes()).not.toContain("tuning-stops--moving");
  });

  test("a press that barely moves is a click on the colour picker, not a drag", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, GREEN] }));
    const { captured } = layOut(wrapper);
    const row = wrapper.get(".tuning-stops").element;

    stops(wrapper)[0].element.dispatchEvent(pointer("pointerdown", centreOf(0)));
    row.dispatchEvent(pointer("pointermove", centreOf(0) + 4));
    row.dispatchEvent(pointer("pointerup", centreOf(0) + 4));
    await flushPromises();

    expect(captured).toEqual([]);
    expect(wrapper.emitted("update:tuning")).toBeUndefined();

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    stops(wrapper)[0].element.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
  });

  test("the click a drag ends in does not open the picker it was released over", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, GREEN] }));

    layOut(wrapper);

    const row = wrapper.get(".tuning-stops").element;

    stops(wrapper)[0].element.dispatchEvent(pointer("pointerdown", centreOf(0)));
    row.dispatchEvent(pointer("pointermove", centreOf(1)));
    row.dispatchEvent(pointer("pointerup", centreOf(1)));
    await flushPromises();

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    stops(wrapper)[1].get(".stop-well").element.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
  });

  test("a pointer wandered far from the row aims at nothing", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, GREEN] }));

    layOut(wrapper);

    const row = wrapper.get(".tuning-stops").element;

    stops(wrapper)[0].element.dispatchEvent(pointer("pointerdown", centreOf(0)));
    row.dispatchEvent(pointer("pointermove", centreOf(1), 200));
    await flushPromises();

    expect(wrapper.emitted("update:tuning")).toBeUndefined();
    expect(stops(wrapper)[0].classes()).toContain("stop--held");
  });

  test("a press on the little cross removes rather than drags", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, GREEN, BLUE] }));
    const { captured } = layOut(wrapper);
    const cross = stops(wrapper)[0].get(".stop-drop").element;

    cross.dispatchEvent(pointer("pointerdown", centreOf(0)));
    wrapper.get(".tuning-stops").element.dispatchEvent(pointer("pointermove", centreOf(2)));
    await flushPromises();

    expect(captured).toEqual([]);

    await stops(wrapper)[0].get(".stop-drop").trigger("click");

    expect(lastEmitted(wrapper).colors).toEqual([GREEN, BLUE]);
  });

  test("disabled, nothing can be picked up", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, GREEN] }), { disabled: true });
    const { captured } = layOut(wrapper);

    stops(wrapper)[0].element.dispatchEvent(pointer("pointerdown", centreOf(0)));
    wrapper.get(".tuning-stops").element.dispatchEvent(pointer("pointermove", centreOf(1)));
    await flushPromises();

    expect(captured).toEqual([]);
    expect(wrapper.emitted("update:tuning")).toBeUndefined();
  });

  test("Alt and an arrow move a colour, and focus goes with it", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, GREEN, BLUE] }));
    const wells = () => wrapper.findAll<HTMLInputElement>(".stop-well");

    wells()[0].element.focus();

    await wells()[0].trigger("keydown", { key: "ArrowRight", altKey: true });
    await flushPromises();

    expect(document.activeElement).toBe(wells()[1].element);

    await wells()[1].trigger("keydown", { key: "ArrowRight", altKey: true });
    await flushPromises();

    expect(document.activeElement).toBe(wells()[2].element);
    expect(lastEmitted(wrapper).colors).toEqual([GREEN, BLUE, RED]);

    await wells()[2].trigger("keydown", { key: "ArrowRight", altKey: true });
    await flushPromises();

    expect(wrapper.emitted("update:tuning")).toHaveLength(2);
    expect(document.activeElement).toBe(wells()[2].element);
  });
});

describe("NicknameTuning — colours", () => {
  test("colours can be added up to six, then the add button goes", async () => {
    const five = mountLive(tuningOf({ colors: Array(MAX_STOPS - 1).fill(RED) }));

    await five.get(".stop-add").trigger("click");

    expect(lastEmitted(five).colors).toHaveLength(MAX_STOPS);
    expect(five.findAll(".stop-well")).toHaveLength(MAX_STOPS);
    expect(five.find(".stop-add").exists()).toBe(false);
  });

  test("a colour well writes a signed ARGB colour", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED] }));

    await wrapper.get(".stop-well").setValue("#00ff00");

    expect(lastEmitted(wrapper).colors).toEqual([GREEN]);
  });

  test("removing the last colour is no colours of one's own, and the aim stays for an effect", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED], angle: 45 }));

    await wrapper.get(".stop-drop").trigger("click");

    expect(lastEmitted(wrapper)).toMatchObject({ colors: null, angle: 45 });
  });
});

describe("NicknameTuning — the dial and the shape", () => {
  test("the dial turns in steps from the keyboard and wraps round", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, RED], angle: 0 }));
    const dial = wrapper.get(".dial");

    expect(dial.attributes("role")).toBe("slider");
    expect(dial.attributes("aria-valuetext")).toBe("0°");

    await dial.trigger("keydown", { key: "ArrowLeft" });

    expect(lastEmitted(wrapper).angle).toBe(345);

    await dial.trigger("keydown", { key: "PageUp" });

    expect(lastEmitted(wrapper).angle).toBe(75);

    await dial.trigger("keydown", { key: "Home" });

    expect(lastEmitted(wrapper).angle).toBe(0);

    await dial.trigger("keydown", { key: "End" });

    expect(lastEmitted(wrapper).angle).toBe(345);
    expect(dial.attributes("aria-valuemax")).toBe("345");
  });

  test("no direction is offered while there is nothing to aim, and one is under an effect", () => {
    const flat = mountLive(tuningOf({ colors: [RED] }));

    expect(flat.find(".dial").exists()).toBe(false);

    const aimed = mountLive(tuningOf({ colors: [RED] }), { aimable: true });

    expect(aimed.find(".dial").exists()).toBe(true);
  });

  test("a radial gradient has nothing for the dial to aim", () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, BLUE], shape: "radial" }));

    expect(wrapper.find(".dial").exists()).toBe(false);
    expect(wrapper.find(".seg").exists()).toBe(true);
  });

  test("disabled, the dial says so and writes nothing", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, RED], angle: 0 }), { disabled: true });
    const dial = wrapper.get(".dial");

    expect(dial.attributes("aria-disabled")).toBe("true");
    expect(dial.classes()).toContain("dial--off");

    await dial.trigger("keydown", { key: "ArrowRight" });
    await dial.trigger("keydown", { key: "End" });

    expect(wrapper.emitted("update:tuning")).toBeUndefined();
  });

  test("the shapes are one tab stop, and arrows, Home and End choose and take focus", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, BLUE] }));
    const radio = (index: number) => wrapper.findAll<HTMLButtonElement>(".seg-key")[index];

    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true);
    expect(radio(0).attributes("tabindex")).toBe("0");
    expect(radio(1).attributes("tabindex")).toBe("-1");

    radio(0).element.focus();

    await radio(0).trigger("keydown", { key: "ArrowRight" });

    expect(lastEmitted(wrapper).shape).toBe("radial");
    expect(document.activeElement).toBe(radio(1).element);
    expect(radio(1).attributes("aria-checked")).toBe("true");
    expect(radio(1).attributes("tabindex")).toBe("0");

    await radio(1).trigger("keydown", { key: "End" });

    expect(lastEmitted(wrapper).shape).toBe("conic");
    expect(document.activeElement).toBe(radio(2).element);

    await radio(2).trigger("keydown", { key: "ArrowDown" });

    expect(lastEmitted(wrapper).shape).toBe("linear");

    await radio(0).trigger("keydown", { key: "Home" });

    expect(lastEmitted(wrapper).shape).toBe("linear");
    expect(document.activeElement).toBe(radio(0).element);
  });

  test("travelling only switches on along a line", async () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, BLUE] }));

    await wrapper.get(".live").trigger("click");

    expect(lastEmitted(wrapper).animate).toBe(true);
    expect(wrapper.get(".live").classes()).toContain("live--on");
    expect(wrapper.find(".ribbon-sheen").exists()).toBe(true);

    await wrapper.findAll(".seg-key")[2].trigger("click");

    expect(wrapper.get(".live").attributes("disabled")).toBeDefined();
    expect(wrapper.get(".live").classes()).not.toContain("live--on");
  });
});

describe("NicknameTuning — weight and spacing", () => {
  function enterRaw(input: Pick<DOMWrapper<HTMLInputElement>, "element" | "trigger">, value: string): Promise<void> {
    Object.defineProperty(input.element, "value", { configurable: true, get: () => value });

    return input.trigger("input");
  }

  test("weight snaps to hundreds and stays within 100–900", async () => {
    const wrapper = mountStill(emptyNicknameStyleTuning());
    const weight =() => wrapper.get<HTMLInputElement>(".gauge-range--weight");

    expect(weight().attributes("min")).toBe("100");
    expect(weight().attributes("max")).toBe("900");
    expect(weight().attributes("step")).toBe("100");

    await enterRaw(weight(), "450");
    expect(lastEmitted(wrapper).weight).toBe(500);

    await enterRaw(weight(), "2000");
    expect(lastEmitted(wrapper).weight).toBe(900);

    await enterRaw(weight(), "-300");
    expect(lastEmitted(wrapper).weight).toBe(100);
  });

  test("letter spacing stays within −10…50 hundredths of an em", async () => {
    const wrapper = mountStill(emptyNicknameStyleTuning());
    const spacing =() => wrapper.get<HTMLInputElement>(".gauge-range--spacing");

    expect(spacing().attributes("min")).toBe("-10");
    expect(spacing().attributes("max")).toBe("50");

    await enterRaw(spacing(), "-30");
    expect(lastEmitted(wrapper).letterSpacingCentiEm).toBe(-10);

    await enterRaw(spacing(), "80");
    expect(lastEmitted(wrapper).letterSpacingCentiEm).toBe(50);

    await enterRaw(spacing(), "17.4");
    expect(lastEmitted(wrapper).letterSpacingCentiEm).toBe(17);
  });

  test("the ranges read out their value, or that it is the default", () => {
    const unset = mountLive(emptyNicknameStyleTuning());

    expect(unset.get(".gauge-range--weight").attributes("aria-valuetext")).toBe("cosmetic_tuning_default");
    expect(unset.get(".gauge-range--spacing").attributes("aria-valuetext")).toBe("cosmetic_tuning_default");
    expect(unset.find(".gauge-reset").exists()).toBe(false);

    const set = mountLive(tuningOf({ weight: 700, letterSpacingCentiEm: 12 }));

    expect(set.get(".gauge-range--weight").attributes("aria-valuetext")).toBe("700");
    expect(set.get(".gauge-range--spacing").attributes("aria-valuetext")).toBe("0.12 em");
  });

  test("each reset says what it resets", async () => {
    const wrapper = mountLive(tuningOf({ weight: 700, letterSpacingCentiEm: 12 }));
    const resets = wrapper.findAll(".gauge-reset");

    expect(resets[0].attributes("aria-label")).toBe("cosmetic_tuning_reset_weight");
    expect(resets[1].attributes("aria-label")).toBe("cosmetic_tuning_reset_spacing");

    await resets[1].trigger("click");

    expect(lastEmitted(wrapper)).toMatchObject({ weight: 700, letterSpacingCentiEm: null });
  });

  test("busy, every control is disabled", () => {
    const wrapper = mountLive(tuningOf({ colors: [RED, BLUE], weight: 700 }), { disabled: true });

    for (const selector of [".stop-well", ".stop-drop", ".stop-add", ".seg-key", ".live", ".gauge-range", ".gauge-reset"]) {
      for (const control of wrapper.findAll(selector)) {
        expect(control.attributes("disabled"), selector).toBeDefined();
      }
    }
  });
});
