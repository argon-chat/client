/**
 * The expression picker in a real browser, over a seeded expressions store (one sticker pack and one
 * emoji pack, their files the Lottie fixture): sections render in order with only the rows near the
 * viewport mounted, picks come out as the right events, the category bar follows the scroll, the
 * keyboard drives the grid, and Esc asks to close.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { emojiRegistry, initializeEmojix } from "@argon-chat/emojix";
import { ExpressionFormat, ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    spaceExpressionInteraction: {
      // `known` matched: the seeded copy is current.
      GetExpressions: async (_spaceId: string, known: string | null) => ({ version: known ?? "v1", packs: null }),
    },
  }),
}));
vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("../fixtures/tiny-lottie.json?url");
  return { cdnUrl: () => url, cdnFetchUrl: () => url, cdnCrossOrigin: () => undefined };
});
// The GIF tab's own browser (and its API) is not what is under test: a stand-in that picks on click.
vi.mock("@/components/chats/GifPicker.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "GifPicker",
      props: { searchQuery: { type: String, default: "" } },
      emits: ["select", "selectSaved"],
      setup: (props, { emit }) => () =>
        h("button", { "data-gif-stub": props.searchQuery, onClick: () => emit("select", { gifId: "g1" }) }, "gif"),
    }),
  };
});

import ExpressionPicker from "@/components/expressions/ExpressionPicker.vue";
import { useExpressionsStore } from "@/store/data/expressionsStore";
import { getLottiePool } from "@/lib/expressions/lottie/LottiePool";

const SPACE = "s1";

const item = (itemId: string, packId: string, kind: ExpressionKind, sortOrder: number): ExpressionItem => ({
  itemId,
  packId,
  spaceId: SPACE,
  kind,
  format: ExpressionFormat.Lottie,
  name: itemId.replace(/-/g, "_"),
  fileId: `file-${itemId}`,
  thumbFileId: null,
  width: kind === ExpressionKind.Emoji ? 100 : 512,
  height: kind === ExpressionKind.Emoji ? 100 : 512,
  fileSize: 1000,
  emoji: ["😺"],
  keywords: kind === ExpressionKind.Sticker ? ["kitty"] : [],
  outline: null,
  textColor: false,
  sortOrder,
  downloadUrl: null,
  thumbUrl: null,
});

const pack = (packId: string, kind: ExpressionKind, title: string, items: ExpressionItem[], sortOrder: number): ExpressionPack => ({
  packId,
  spaceId: SPACE,
  kind,
  title,
  slug: packId,
  coverItemId: null,
  sortOrder,
  version: 1n,
  items,
});

const stickers = pack("sp", ExpressionKind.Sticker, "Cats", [0, 1, 2].map((i) => item(`st-${i}`, "sp", ExpressionKind.Sticker, i)), 0);
const emoji = pack("ep", ExpressionKind.Emoji, "Party", [0, 1].map((i) => item(`em-${i}`, "ep", ExpressionKind.Emoji, i)), 1);

const mounted: VueWrapper[] = [];

function seed(packs: ExpressionPack[] = [stickers, emoji]) {
  useExpressionsStore().bySpace.set(SPACE, { version: "v1", packs, loadedAt: Date.now() });
}

function open(props: Record<string, unknown> = {}) {
  const wrapper = mount(ExpressionPicker, { props: { spaceId: SPACE, ...props }, attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}

async function until(check: () => boolean, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

const $ = <T extends Element = HTMLElement>(root: Element, selector: string) => root.querySelector<T>(selector);
const sectionIds = (root: Element) => [...root.querySelectorAll<HTMLElement>(".xp-section")].map((s) => s.dataset.sectionId);
const barIds = (root: Element) => [...root.querySelectorAll<HTMLElement>(".xp-bar__item")].map((b) => b.dataset.section);
const activeBar = (root: Element) => $(root, '.xp-bar__item[aria-current="true"]')?.dataset.section;

async function ready(wrapper: VueWrapper) {
  await until(() => !!$(wrapper.element, ".xp-cell"));
  await frame();
}

async function scrollTo(root: Element, sectionId: string) {
  const grid = $(root, ".xp-grid")!;
  const section = $(grid, `[data-section-id="${sectionId}"]`)!;
  grid.scrollTop = section.offsetTop;
  await until(() => activeBar(root) === sectionId);
  await until(() => !!section.querySelector(".xp-cell"));
}

beforeAll(async () => {
  await initializeEmojix();
});

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  seed();
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("ExpressionPicker", () => {
  test("the emoji tab: unicode groups then the space's pack, only the rows near the viewport mounted", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;

    const groups = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"];
    expect(sectionIds(root)).toEqual([...groups, "pack:ep"]);
    expect(barIds(root)).toEqual([...groups, "pack:ep"]);
    expect(activeBar(root)).toBe("smileys");

    // Every section holds its height; far ones mount nothing yet.
    const flags = $(root, '[data-section-id="flags"]')!;
    expect(flags.getBoundingClientRect().height).toBeGreaterThan(1000);
    expect(flags.querySelectorAll(".xp-cell")).toHaveLength(0);
    const mountedCells = root.querySelectorAll(".xp-cell").length;
    expect(mountedCells).toBeGreaterThan(0);
    expect(mountedCells).toBeLessThan(200);
  });

  test("a unicode pick emits the emoji and puts it first in the recent row next time", async () => {
    const wrapper = open();
    await ready(wrapper);
    $(wrapper.element, '[data-cell="0:0"]')!.click();
    const first = emojiRegistry.getByCategory("smileys")[0];
    expect(wrapper.emitted("select-emoji")?.[0]).toEqual([String.fromCodePoint(...first.codepoints)]);

    const again = open();
    await ready(again);
    expect(sectionIds(again.element)[0]).toBe("recent");
    expect($(again.element, '[data-section-id="recent"] [data-cell="0:0"]')?.getAttribute("aria-label")).toBe(first.name);
  });

  test("the category bar follows the scroll, and a click on it scrolls there", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;

    await scrollTo(root, "animals");
    expect(activeBar(root)).toBe("animals");

    $(root, '.xp-bar__item[data-section="pack:ep"]')!.click();
    await nextTick();
    expect(activeBar(root)).toBe("pack:ep");
    await until(() => {
      const grid = $(root, ".xp-grid")!;
      return grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 2;
    });
    // Scrolled to the very end, the short last section stays current.
    await new Promise((r) => setTimeout(r, 1100));
    expect(activeBar(root)).toBe("pack:ep");

    const custom = $(root, '[data-section-id="pack:ep"] .xp-cell--custom')!;
    expect(custom.querySelector(".ce")?.getBoundingClientRect().width).toBe(36);
    custom.click();
    expect((wrapper.emitted("select-custom-emoji")?.[0]?.[0] as ExpressionItem).itemId).toBe("em-0");
    expect(useExpressionsStore().recentEmoji[0]).toBe("em-0");
  });

  test("the sticker tab: a click emits select-sticker and records the sticker as recent", async () => {
    const wrapper = open();
    await ready(wrapper);
    $(wrapper.element, '[data-tab="stickers"]')!.click();
    await until(() => !!$(wrapper.element, ".xp-cell--sticker"));

    expect(sectionIds(wrapper.element)).toEqual(["pack:sp"]);
    const cells = (wrapper.element as HTMLElement).querySelectorAll<HTMLElement>(".xp-cell--sticker");
    expect(cells).toHaveLength(3);
    expect(cells[0].getBoundingClientRect().width).toBe(72);
    expect(cells[0].querySelector(".sticker-view")?.getBoundingClientRect().width).toBe(64);

    cells[1].click();
    expect((wrapper.emitted("select-sticker")?.[0]?.[0] as ExpressionItem).itemId).toBe("st-1");
    expect(useExpressionsStore().recentStickers[0]).toBe("st-1");
  });

  test("hovering a sticker previews it large; only the preview plays meanwhile", async () => {
    const wrapper = open({ initialTab: "stickers" });
    await until(() => !!$(wrapper.element, ".xp-cell--sticker"));
    const pool = getLottiePool();
    const cell = (wrapper.element as HTMLElement).querySelector<HTMLElement>(".xp-cell--sticker")!;

    cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    await until(() => !!document.querySelector("[data-sticker-preview]"), 2_000);
    const preview = document.querySelector("[data-sticker-preview] .sticker-view")!;
    expect(preview.getBoundingClientRect().width).toBe(Math.min(360, Math.floor(Math.min(innerWidth, innerHeight) * 0.7)));
    expect(pool.intersector.onlyPlayableGroup).toBe("preview");

    $(wrapper.element, ".xp-grid")!.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    await until(() => !document.querySelector("[data-sticker-preview]"));
    expect(pool.intersector.onlyPlayableGroup).toBeNull();
  });

  test("keyboard: down from the search enters the grid, arrows move, Enter picks, typing returns to search", async () => {
    const wrapper = open();
    await ready(wrapper);
    const input = $<HTMLInputElement>(wrapper.element, ".xp-search__input")!;
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    await until(() => (document.activeElement as HTMLElement)?.dataset?.cell === "0:0");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await until(() => (document.activeElement as HTMLElement)?.dataset?.cell === "0:1");
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);

    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const second = emojiRegistry.getByCategory("smileys")[1];
    expect(wrapper.emitted("select-emoji")?.[0]).toEqual([String.fromCodePoint(...second.codepoints)]);

    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
  });

  test("Esc clears a search first, then asks to close", async () => {
    const wrapper = open();
    await ready(wrapper);
    const input = $<HTMLInputElement>(wrapper.element, ".xp-search__input")!;
    input.value = "kitty";
    input.dispatchEvent(new Event("input"));
    await nextTick();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await nextTick();
    expect(input.value).toBe("");
    expect(wrapper.emitted("close")).toBeUndefined();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("search: the space's own first, then unicode; stickers by keyword", async () => {
    const wrapper = open();
    await ready(wrapper);
    const input = $<HTMLInputElement>(wrapper.element, ".xp-search__input")!;
    input.value = "em_";
    input.dispatchEvent(new Event("input"));
    await until(() => sectionIds(wrapper.element)[0] === "search:custom");
    expect($(wrapper.element, ".xp-bar")).toBeNull();

    input.value = "grinning";
    input.dispatchEvent(new Event("input"));
    await until(() => sectionIds(wrapper.element).includes("search:unicode"));

    $(wrapper.element, '[data-tab="stickers"]')!.click();
    await nextTick();
    input.value = "kitty";
    input.dispatchEvent(new Event("input"));
    await until(() => wrapper.element.querySelectorAll(".xp-cell--sticker").length === 3);

    input.value = "nothing-like-this";
    input.dispatchEvent(new Event("input"));
    await until(() => !!$(wrapper.element, "[data-empty]"));
  });

  test("right click on an emoji with tones offers them; the pick is sent toned and remembered", async () => {
    const wrapper = open();
    await ready(wrapper);
    const people = emojiRegistry.getByCategory("people");
    const index = people.findIndex((e) => e.hasSkinTones);
    await scrollTo(wrapper.element, "people");
    const cell = await (async () => {
      await until(() => !!$(wrapper.element, `[data-cell="1:${index}"]`));
      return $(wrapper.element, `[data-cell="1:${index}"]`)!;
    })();

    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await until(() => document.querySelectorAll(".xp-tones button").length === 6);
    document.querySelector<HTMLElement>('.xp-tones [data-tone="medium"]')!.click();
    await nextTick();

    const [text] = wrapper.emitted("select-emoji")![0] as [string];
    expect([...text]).toContain("\u{1F3FD}");
    expect(JSON.parse(localStorage.getItem("argon_emoji_skin_tone")!)).toBe("medium");
    expect(document.querySelector(".xp-tones")).toBeNull();
  });

  test("the GIF tab is the GIF picker, its pick passed on", async () => {
    const wrapper = open();
    await ready(wrapper);
    $(wrapper.element, '[data-tab="gifs"]')!.click();
    await until(() => !!$(wrapper.element, "[data-gif-stub]"));
    $(wrapper.element, "[data-gif-stub]")!.click();
    expect(wrapper.emitted("select-gif")?.[0]).toEqual([{ gifId: "g1" }]);
  });

  test("reaction mode is the emoji tab alone", async () => {
    const wrapper = open({ mode: "reaction" });
    await ready(wrapper);
    expect($(wrapper.element, ".xp-tabs")).toBeNull();
    expect(sectionIds(wrapper.element)).toContain("pack:ep");
  });

  test("a space without stickers says so, and offers its settings to those who can manage them", async () => {
    seed([emoji]);
    const wrapper = open({ initialTab: "stickers", canManage: true });
    await until(() => !!$(wrapper.element, "[data-empty]"));
    expect(wrapper.element.textContent).toContain("expression_picker_no_stickers");
    $(wrapper.element, "[data-empty] button")!.click();
    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });
});
