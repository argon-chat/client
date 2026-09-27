/**
 * Custom emoji in a real browser: Lottie emoji are drawn on the overlay canvas exactly over their
 * placeholders (nowhere else), share one player per file and size across overlays, follow the text
 * colour when asked to, and go from the canvas when their placeholder goes; static ones get an image.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import CustomEmojiOverlay from "@/components/expressions/CustomEmojiOverlay.vue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import { ExpressionFormat, type ExpressionMedia } from "@/lib/expressions/types";
import { customEmojiPlayerCount } from "@/lib/expressions/customEmojiRegistry";
import fixtureUrl from "../fixtures/tiny-lottie.json?url";

vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: (id: string) => `/files/${id}`,
  cdnFetchUrl: (id: string) => `/files/${id}`,
  cdnCrossOrigin: () => undefined,
}));

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const resolveUrl = (fileId: string) => (fileId.startsWith("png") ? PNG : fixtureUrl);

const lottie = (fileId: string, textColor = false): ExpressionMedia => ({
  fileId,
  format: ExpressionFormat.Lottie,
  width: 100,
  height: 100,
  textColor,
});

const mounted: VueWrapper[] = [];

function text(parts: (string | ExpressionMedia)[], options: { size?: number; color?: string } = {}) {
  const show = ref(true);
  const Host = defineComponent({
    setup: () => () =>
      h(
        CustomEmojiOverlay,
        { resolveUrl, style: { width: "400px", font: "20px sans-serif", color: options.color ?? "black" } },
        () =>
          parts.map((p) =>
            typeof p === "string" ? p : show.value ? h(CustomEmojiInline, { media: p, size: options.size ?? 40 }) : null,
          ),
      ),
  });
  const wrapper = mount(Host, { attachTo: document.body });
  mounted.push(wrapper);
  return { wrapper, show };
}

async function until(check: () => boolean, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

/** The overlay pixel under the centre of `el`, and one well away from any emoji. */
function sample(root: Element, el: Element) {
  const canvas = root.querySelector<HTMLCanvasElement>(".ce-overlay")!;
  const ctx = canvas.getContext("2d")!;
  const base = canvas.getBoundingClientRect();
  const scale = canvas.width / base.width;
  const r = el.getBoundingClientRect();
  const at = (x: number, y: number) =>
    Array.from(ctx.getImageData(Math.round((x - base.left) * scale), Math.round((y - base.top) * scale), 1, 1).data);
  return {
    canvas,
    centre: at(r.left + r.width / 2, r.top + r.height / 2),
    elsewhere: at(base.right - 2, base.top + 2),
  };
}

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("CustomEmojiOverlay", () => {
  test("draws the frame at the placeholder's rect", async () => {
    const { wrapper } = text(["Hello ", lottie("emoji-a"), " world"]);
    const placeholder = wrapper.element.querySelector(".ce")!;
    await until(() => placeholder.hasAttribute("data-ce-ready"));
    await frame();

    const { canvas, centre, elsewhere } = sample(wrapper.element, placeholder);
    expect(canvas.width).toBeGreaterThan(0);
    expect(centre).toEqual([255, 0, 0, 255]);
    expect(elsewhere[3]).toBe(0);
  });

  test("one player per file and size, whatever the number of copies and overlays", async () => {
    const a = text([lottie("emoji-b"), " and ", lottie("emoji-b")]);
    const b = text(["again ", lottie("emoji-b")]);
    const c = text(["bigger ", lottie("emoji-b")], { size: 60 });
    const all = [a, b, c].flatMap(({ wrapper }) => [...wrapper.element.querySelectorAll(".ce")]);
    await until(() => all.every((el) => el.hasAttribute("data-ce-ready")));
    expect(customEmojiPlayerCount()).toBe(2); // 40 px and 60 px

    await frame();
    for (const { wrapper } of [a, b, c]) {
      for (const el of wrapper.element.querySelectorAll(".ce")) {
        expect(sample(wrapper.element, el).centre).toEqual([255, 0, 0, 255]);
      }
    }

    a.wrapper.unmount();
    b.wrapper.unmount();
    mounted.splice(0, 2);
    expect(customEmojiPlayerCount()).toBe(1);
  });

  test("text-coloured emoji take the colour of the text", async () => {
    const { wrapper } = text([lottie("emoji-c", true)], { color: "rgb(0, 128, 0)" });
    const placeholder = wrapper.element.querySelector(".ce")!;
    await until(() => placeholder.hasAttribute("data-ce-ready"));
    await frame();
    expect(sample(wrapper.element, placeholder).centre).toEqual([0, 128, 0, 255]);
  });

  test("a removed placeholder is taken off the canvas", async () => {
    const { wrapper, show } = text(["x ", lottie("emoji-d")]);
    const placeholder = wrapper.element.querySelector(".ce")!;
    await until(() => placeholder.hasAttribute("data-ce-ready"));
    await frame();
    const before = sample(wrapper.element, placeholder);
    expect(before.centre).toEqual([255, 0, 0, 255]);
    const rect = placeholder.getBoundingClientRect();

    show.value = false;
    await nextTick();
    await frame();
    await frame();

    const canvas = before.canvas;
    const base = canvas.getBoundingClientRect();
    const scale = canvas.width / base.width;
    const px = canvas
      .getContext("2d")!
      .getImageData(
        Math.round((rect.left + rect.width / 2 - base.left) * scale),
        Math.round((rect.top + rect.height / 2 - base.top) * scale),
        1,
        1,
      ).data;
    expect(px[3]).toBe(0);
    expect(customEmojiPlayerCount()).toBe(0);
  });

  test("static emoji get an image in their placeholder, not a draw", async () => {
    const { wrapper } = text(["hi ", { fileId: "png-1", format: ExpressionFormat.Static, width: 1, height: 1 }]);
    await nextTick();
    const placeholder = wrapper.element.querySelector(".ce")!;
    const img = placeholder.querySelector("img.ce-img");
    expect(img?.getAttribute("src")).toBe(PNG);
    await until(() => placeholder.hasAttribute("data-ce-ready"));
    expect(customEmojiPlayerCount()).toBe(0);
  });
});
