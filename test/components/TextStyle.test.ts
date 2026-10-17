import {
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/store/system/fileStorage", () => ({ cdnUrl: (fileId: string) => `https://cdn.test/${fileId}` }));
vi.mock("@/composables/useReducedMotion", async () => {
  const { ref } = await import("vue");

  return { reduceMotion: ref(false) };
});

import {
  emptyNicknameStyleTuning,
  type NicknameStyleTuning,
} from "@/cosmetics/kinds/nickname-style";
import TextStyle from "@/cosmetics/primitives/TextStyle.vue";
import type { ResolvedCosmetic } from "@/cosmetics/types";

function wearing(...colors: number[]): ResolvedCosmetic {
  return {
    itemId: null,
    slug: null,
    kind: {} as ResolvedCosmetic["kind"],
    layer: 0,
    payload: { ...emptyNicknameStyleTuning(), colors },
    assets: {} as ResolvedCosmetic["assets"],
    options: [],
  };
}

describe("TextStyle", () => {
  test("keeps the alpha a wearer's colour carries", () => {
    const halfRed = 0x80ff0000 | 0;
    const wrapper = mount(TextStyle, { props: { item: wearing(halfRed) }, slots: { default: "name" } });

    expect(wrapper.get("span").attributes("style")).toMatch(/color: rgba\(255, 0, 0, 0\.50?\)/);
  });

  test("falls back to the surface's colour when the wearer chose none", () => {
    const wrapper = mount(TextStyle, {
      props: { item: wearing(), fallbackColor: "rgb(1, 2, 3)" },
      slots: { default: "name" },
    });

    expect(wrapper.get("span").attributes("style")).toContain("color: rgb(1, 2, 3)");
  });
});

function tuned(tuning: Partial<NicknameStyleTuning>): ResolvedCosmetic {
  return { ...wearing(), payload: { ...emptyNicknameStyleTuning(), ...tuning } };
}

function styleOf(item: ResolvedCosmetic): string {
  return mount(TextStyle, { props: { item }, slots: { default: "name" } }).get("span").attributes("style") ?? "";
}

const RED = 0xffff0000 | 0;
const BLUE = 0xff0000ff | 0;
const RED_CSS = "rgba(255, 0, 0, 1.00)";
const BLUE_CSS = "rgba(0, 0, 255, 1.00)";

function treated(slug: string, tuning: Partial<NicknameStyleTuning>): ResolvedCosmetic {
  return {
    ...tuned(tuning),
    options: [{ facetId: "effect", kindKey: "option.text-effect", itemId: `effect-${slug}`, slug, payload: {}, assets: {} as ResolvedCosmetic["assets"] }],
  };
}

describe("TextStyle gradients", () => {
  test("paints two colours across the letters at the angle the wearer aimed", () => {
    const style = styleOf(tuned({ colors: [RED, BLUE], angle: 45 }));

    expect(style).toContain("linear-gradient(45deg, rgba(255, 0, 0, 1.00), rgba(0, 0, 255, 1.00))");
    expect(style).toContain("color: transparent");
  });

  test("travels a linear gradient by laying the stops out twice in a tile that closes on its first colour", () => {
    const style = styleOf(tuned({ colors: [RED, BLUE], animate: true }));

    expect(style).toContain(`linear-gradient(90deg, ${RED_CSS}, ${BLUE_CSS}, ${RED_CSS}, ${BLUE_CSS}, ${RED_CSS})`);
    expect(style).toContain("background-size: 200% 100%");
    expect(style).toContain("background-position: var(--cosmetic-name-drift) 0");
    expect(style).toContain("cosmetic-name-drift 6s linear infinite");
  });

  test.each(["conic", "radial"] as const)("lays a %s gradient once, closed, and never moves it", shape => {
    const style = styleOf(tuned({ colors: [RED, BLUE], animate: true, shape }));

    expect(style).toContain(`at center, ${RED_CSS}, ${BLUE_CSS}, ${RED_CSS})`);
    expect(style).not.toContain("background-size");
    expect(style).not.toContain("cosmetic-name-drift");
  });

  test("stands still for a viewer who asked for reduced motion", async () => {
    const { reduceMotion } = await import("@/composables/useReducedMotion");

    reduceMotion.value = true;

    try {
      const style = styleOf(tuned({ colors: [RED, BLUE], animate: true }));

      expect(style).toContain(`linear-gradient(90deg, ${RED_CSS}, ${BLUE_CSS})`);
      expect(style).not.toContain("background-size: 200% 100%");
      expect(style).toContain("animation: none");
    } finally {
      reduceMotion.value = false;
    }
  });

  test("sets the weight and the spacing the wearer chose", () => {
    const style = styleOf(tuned({ colors: [RED], weight: 700, letterSpacingCentiEm: 12 }));

    expect(style).toContain("font-weight: 700");
    expect(style).toContain("letter-spacing: 0.12em");
  });
});

describe("TextStyle treatments", () => {
  // Read off the vnode: the test DOM drops any declaration it cannot parse, color-mix() and layered
  // backgrounds among them, so the attribute would not show what a browser is handed.
  function paintOf(item: ResolvedCosmetic, fallbackColor?: string): Record<string, string> {
    const wrapper = mount(TextStyle, { props: { item, fallbackColor }, slots: { default: "name" } });

    return (wrapper.vm.$.subTree.props as { style: Record<string, string> }).style;
  }

  test("lightens a role colour whatever notation it arrives in", () => {
    const paint = paintOf(treated("gradient", { colors: [] }), "hsl(200 60% 40%)");

    expect(paint.backgroundImage).toBe("linear-gradient(90deg, hsl(200 60% 40%), color-mix(in srgb, hsl(200 60% 40%), white 45%))");
  });

  test("is asked even when neither the wearer nor the surface names a colour", () => {
    const paint = paintOf(treated("glow", { colors: [] }));

    expect(paint.color).toBe("hsl(var(--foreground))");
    expect(paint.textShadow).toContain("0 0 4px hsl(var(--foreground))");
  });

  test("a shimmer over a travelling gradient keeps the travel and lays the colours out once", () => {
    const paint = paintOf(treated("shimmer", { colors: [RED, BLUE], animate: true }));

    expect(paint.backgroundImage).toContain(`linear-gradient(90deg, ${RED_CSS}, ${BLUE_CSS}, ${RED_CSS}, ${BLUE_CSS}, ${RED_CSS})`);
    expect(paint.backgroundImage).not.toContain(`${RED_CSS}, ${BLUE_CSS}, ${RED_CSS}, ${BLUE_CSS}, ${RED_CSS}, ${BLUE_CSS}`);
    expect(paint.backgroundSize).toBe("250% 100%, 200% 100%");
    expect(paint.backgroundPosition).toBe("var(--cosmetic-shimmer) 0, var(--cosmetic-name-drift) 0");
    expect(paint.animation).toBe("cosmetic-name-drift 6s linear infinite, cosmetic-shimmer 4s linear infinite");
  });

  test("a shimmer over a sweep leaves the sweep centred on the name", () => {
    const paint = paintOf(treated("shimmer", { colors: [RED, BLUE], shape: "conic", animate: true }));

    expect(paint.backgroundSize).toBe("250% 100%, auto");
    expect(paint.backgroundPosition).toBe("var(--cosmetic-shimmer) 0, 0 0");
    expect(paint.animation).toBe("cosmetic-shimmer 4s linear infinite");
  });

  test("a shimmer under reduced motion stands still and keeps a sweep centred", async () => {
    const { reduceMotion } = await import("@/composables/useReducedMotion");

    reduceMotion.value = true;

    try {
      const paint = paintOf(treated("shimmer", { colors: [RED, BLUE], shape: "radial", animate: true }));

      expect(paint.backgroundPosition).toBe("var(--cosmetic-shimmer) 0, 0 0");
      expect(paint.animation).toBe("none");
    } finally {
      reduceMotion.value = false;
    }
  });
});
