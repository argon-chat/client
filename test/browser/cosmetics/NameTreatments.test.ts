/**
 * A styled name's colours and treatment, painted by a real browser.
 *
 * The background is let out to the whole box and every animation is held at a chosen moment, so what
 * is sampled is the paint itself rather than whatever glyph happens to sit at a point: a role colour
 * in any notation still makes a two-tone gradient, a travelling gradient has no seam where one tile
 * meets the next, colours that do not travel are laid out once, a shimmer runs over the wearer's own
 * drift rather than instead of it, and a treatment is drawn with no colour named anywhere.
 */

import "../../../packages/assets/styles/index.css";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { page } from "vitest/browser";

vi.mock("@/store/system/fileStorage", () => ({ cdnUrl: (fileId: string) => `https://cdn.test/${fileId}` }));

import {
  emptyNicknameStyleTuning,
  type NicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import TextStyle from "@/cosmetics/primitives/TextStyle.vue";
import type { ResolvedCosmetic } from "@/cosmetics/types";
import { reduceMotion } from "@/composables/useReducedMotion";

import {
  BLUE,
  RED,
} from "./support/catalogue";
import { screenPixels } from "./support/screenPixels";

const mounted: VueWrapper[] = [];

let held: HTMLStyleElement | null = null;

/** Paints the background across the whole box and stops every animation `seconds` into its run. */
function holdAt(seconds: number) {
  held?.remove();
  held = document.createElement("style");
  held.textContent = `.cosmetic-text-style {
    background-clip: border-box !important;
    -webkit-background-clip: border-box !important;
    animation-play-state: paused !important;
    animation-delay: -${seconds}s !important;
  }`;
  document.head.appendChild(held);
}

function styled(tuning: Partial<NicknameStyleTuning>, effect: string | null = null): ResolvedCosmetic {
  return {
    itemId: null,
    slug: null,
    kind: {} as ResolvedCosmetic["kind"],
    layer: 0,
    payload: { ...emptyNicknameStyleTuning(), ...tuning },
    assets: {} as ResolvedCosmetic["assets"],
    options: effect
      ? [{ facetId: "effect", kindKey: "option.text-effect", itemId: `effect-${effect}`, slug: effect, payload: {}, assets: {} as ResolvedCosmetic["assets"] }]
      : [],
  };
}

function name(item: ResolvedCosmetic, fallbackColor?: string): HTMLElement {
  const box = document.createElement("div");

  box.style.cssText = "position: absolute; left: 40px; top: 40px; font-size: 40px; line-height: 1; background: rgb(0, 0, 0);";
  document.body.appendChild(box);

  const wrapper = mount(TextStyle, { attachTo: box, props: { item, fallbackColor }, slots: { default: "MMMMMMMMMM" } });

  mounted.push(wrapper);

  return wrapper.element as HTMLElement;
}

/** The colour of every pixel along the middle of the box, left to right, one CSS pixel apart. */
async function across(element: HTMLElement): Promise<Array<[number, number, number]>> {
  const box = element.getBoundingClientRect();
  const pixels = await screenPixels();
  const row: Array<[number, number, number]> = [];

  for (let x = Math.ceil(box.left) + 1; x < box.right - 1; x++) {
    const [red, green, blue] = pixels.at(x, box.top + box.height / 2);

    row.push([red, green, blue]);
  }

  return row;
}

function distance(first: [number, number, number], second: [number, number, number]): number {
  return Math.max(
    Math.abs(first[0] - second[0]),
    Math.abs(first[1] - second[1]),
    Math.abs(first[2] - second[2]),
  );
}

/** The last of a layered background's comma-separated values, which is the colours under any band. */
function lastLayer(value: string): string {
  const layers = value.split(/,(?![^(]*\))/);

  return layers[layers.length - 1].trim();
}

beforeEach(async () => {
  await page.viewport(1000, 400);
  reduceMotion.value = false;
  holdAt(0);
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) {
    wrapper.unmount();
  }

  held?.remove();
  held = null;
  reduceMotion.value = false;
  document.body.innerHTML = "";
});

describe("one role colour through a two-tone treatment", () => {
  test("still makes two tones when the colour arrives as hsl()", async () => {
    const row = await across(name(styled({}, "gradient"), "hsl(0 100% 30%)"));

    expect(distance(row[0], row[row.length - 1])).toBeGreaterThan(60);
  });
});

describe("a travelling gradient", () => {
  test.each([0.75, 1.5, 3, 4.5])("has no seam where one tile meets the next, %ss in", async seconds => {
    const element = name(styled({ colors: [RED, BLUE], animate: true }));

    holdAt(seconds);

    const row = await across(element);
    let steepest = 0;

    for (let index = 1; index < row.length; index++) {
      steepest = Math.max(steepest, distance(row[index - 1], row[index]));
    }

    expect(steepest).toBeLessThan(40);
  });
});

describe("colours that do not travel", () => {
  test("a linear gradient held still for reduced motion is laid out once", async () => {
    reduceMotion.value = true;

    const row = await across(name(styled({ colors: [RED, BLUE], animate: true })));
    const [red, , blue] = row[Math.round(row.length / 3)];

    // A third of the way along one sweep from red to blue: still mostly red.
    expect(red).toBeGreaterThan(blue);
  });

  test("a sweep from the centre is laid out once, closed", () => {
    const element = name(styled({ colors: [RED, BLUE], animate: true, shape: "conic" }));
    const reds = getComputedStyle(element).backgroundImage.match(/rgb\(255, 0, 0\)/g) ?? [];

    expect(reds).toHaveLength(2);
  });
});

describe("a shimmer", () => {
  test("runs over the wearer's own drift rather than instead of it", () => {
    const element = name(styled({ colors: [RED, BLUE], animate: true }, "shimmer"));

    expect(getComputedStyle(element).animationName.split(/,\s*/)).toEqual(["cosmetic-name-drift", "cosmetic-shimmer"]);
  });

  test("leaves a sweep from the centre where it is while the band moves", () => {
    const element = name(styled({ colors: [RED, BLUE], animate: true, shape: "conic" }, "shimmer"));

    holdAt(0.5);

    const before = getComputedStyle(element).backgroundPosition;

    holdAt(2.5);

    const after = getComputedStyle(element).backgroundPosition;

    expect(after).not.toBe(before);
    expect(lastLayer(after)).toBe(lastLayer(before));
  });
});

describe("a treatment with no colour named anywhere", () => {
  test("is still drawn", () => {
    const element = name(styled({}, "glow"));

    expect(getComputedStyle(element).textShadow).not.toBe("none");
  });
});
