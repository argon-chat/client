/**
 * The expression picker in a real browser, over a seeded expressions store (one sticker pack and one
 * emoji pack, their files the Lottie fixture) and a seeded space list: a fixed 498×440 panel with a
 * tab bar, a rail beside a sectioned virtual grid (the space's emoji under the space's name, then the
 * unicode groups), a footer naming what is pointed at, the rail and the grid following each other,
 * the keyboard across header, rail and grid, skin tones drawn from the atlases, and Esc.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { page, userEvent } from "vitest/browser";
import { createPinia, setActivePinia } from "pinia";
import { emojiRegistry, initializeEmojix } from "@argon-chat/emojix";
import { ExpressionFormat, ExpressionKind, type ArgonSpaceBase, type ExpressionItem, type ExpressionPack } from "@argon/glue";

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
// The space's picture is not what is under test.
vi.mock("@/components/ArgonAvatar.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "ArgonAvatar",
      props: { spaceId: String, fileId: String, fallback: String },
      setup: (props) => () => h("span", { class: "avatar-stub", "data-avatar": props.spaceId }, props.fallback),
    }),
  };
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
import { db } from "@/store/db/dexie";
import { getLottiePool } from "@/lib/expressions/lottie/LottiePool";

const SPACE = "s1";
const SPACE_NAME = "Cats Space";
const UNICODE = ["smileys", "people", "animals", "food", "travel", "activities", "objects", "symbols", "flags"];

const item = (itemId: string, packId: string, kind: ExpressionKind, sortOrder: number, spaceId = SPACE): ExpressionItem => ({
  itemId,
  packId,
  spaceId,
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
  creatorId: null,
});

const pack = (packId: string, kind: ExpressionKind, title: string, items: ExpressionItem[], sortOrder: number, spaceId = SPACE): ExpressionPack => ({
  packId,
  spaceId,
  kind,
  title,
  slug: packId,
  coverItemId: null,
  sortOrder,
  version: 1n,
  items,
  creatorId: null,
});

const spaceRow = (spaceId: string, name: string): ArgonSpaceBase => ({
  spaceId,
  name,
  description: "",
  avatarFieldId: null,
  topBannerFileId: null,
  boostCount: 0,
  boostLevel: 0,
  isVerified: false,
  isOfficial: false,
  hideBoostStrip: false,
  inviteImageFileId: null,
  isCommunity: null,
  mainAnnouncementChannelId: null,
});

const stickers = pack("sp", ExpressionKind.Sticker, "Cats", [0, 1, 2].map((i) => item(`st-${i}`, "sp", ExpressionKind.Sticker, i)), 0);
const emoji = pack("ep", ExpressionKind.Emoji, "Party", [0, 1].map((i) => item(`em-${i}`, "ep", ExpressionKind.Emoji, i)), 1);

const mounted: VueWrapper[] = [];

function seed(packs: ExpressionPack[] = [stickers, emoji], spaceId = SPACE) {
  useExpressionsStore().bySpace.set(spaceId, { version: "v1", packs, loadedAt: Date.now() });
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
const $$ = (root: Element, selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
const groupIds = (root: Element) => $$(root, ".xp-group").map((s) => s.dataset.groupId);
const groupTitle = (root: Element, id: string) => $(root, `[data-group-id="${id}"] .xp-group__title`)?.textContent?.trim();
const railIds = (root: Element) => $$(root, ".xp-rail__item").map((b) => b.dataset.rail).filter((id) => id !== "manage");
const activeRail = (root: Element) => $$(root, '.xp-rail__item[aria-current="true"]').map((b) => b.dataset.rail);
const tabs = (root: Element) => $$(root, ".xp-tabs__tab").map((b) => b.dataset.tab);
const grid = (root: Element) => $(root, ".xp-grid")!;
const group = (root: Element, id: string) => $(root, `[data-group-id="${id}"]`)!;
const footerName = (root: Element) => $(root, "[data-footer-name]")?.textContent;
const footerDetail = (root: Element) => $(root, "[data-footer-detail]")?.textContent ?? null;
const width = (el: Element | null) => el?.getBoundingClientRect().width;
const focused = () => document.activeElement as HTMLElement;

async function ready(wrapper: VueWrapper) {
  await until(() => !!$(wrapper.element, ".xp-cell"));
  await frame();
}

async function scrollGridTo(root: Element, groupId: string) {
  grid(root).scrollTop = group(root, groupId).offsetTop;
  await until(() => activeRail(root).includes(groupId));
  await until(() => !!group(root, groupId).querySelector(".xp-cell"));
}

function hover(el: Element) {
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
}

beforeAll(async () => {
  await initializeEmojix();
  await page.viewport(1280, 900);
});

beforeEach(async () => {
  localStorage.clear();
  setActivePinia(createPinia());
  seed();
  await db.servers.clear();
  await db.servers.put(spaceRow(SPACE, SPACE_NAME));
});

afterAll(async () => {
  await db.servers.clear();
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("ExpressionPicker", () => {
  test("a fixed 498×440 panel; the tab bar shows even with one tab, text tabs in Discord's order", async () => {
    const one = open({ tabs: ["emoji"] });
    await ready(one);
    const box = one.element.getBoundingClientRect();
    expect([box.width, box.height]).toEqual([498, 440]);
    expect(tabs(one.element)).toEqual(["emoji"]);
    expect($(one.element, '[data-tab="emoji"]')?.textContent?.trim()).toBe("expression_picker_tab_emoji");
    one.unmount();

    const all = open();
    await ready(all);
    expect(tabs(all.element)).toEqual(["stickers", "gifs", "emoji"]);
    expect($(all.element, '[data-tab="emoji"]')?.getAttribute("aria-selected")).toBe("true");
  });

  test("on a narrow window it keeps 8 px from each side instead", async () => {
    await page.viewport(420, 800);
    try {
      const wrapper = open();
      await ready(wrapper);
      expect(width(wrapper.element)).toBe(420 - 16);
    } finally {
      await page.viewport(1280, 900);
    }
  });

  test("the emoji tab: the space's emoji under its name, then the unicode groups; the rail lists the same", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;

    expect(groupIds(root)).toEqual(["space:s1", ...UNICODE]);
    expect(railIds(root)).toEqual(["space:s1", ...UNICODE]);
    expect($(root, '[data-rail="space:s1"] [data-avatar="s1"]')).not.toBeNull();
    await until(() => groupTitle(root, "space:s1") === SPACE_NAME);
    expect($(root, '[data-rail="space:s1"]')?.getAttribute("aria-label")).toBe(SPACE_NAME);
    expect(activeRail(root)).toEqual(["space:s1"]);
    // A single pack needs no sub-header of its own.
    expect($$(group(root, "space:s1"), ".xp-section__title")).toHaveLength(0);

    // Discord's cells: 40 px, the art 32 px; nine to a row.
    const custom = $(root, ".xp-cell--custom")!;
    expect(width(custom)).toBe(40);
    expect(width(custom.querySelector(".ce"))).toBe(32);
    const smileys = $$(group(root, "smileys"), ".xp-cell--unicode");
    expect(width(smileys[0])).toBe(40);
    expect(width(smileys[0].querySelector(".xp-sprite"))).toBe(32);
    expect(smileys.slice(0, 10).filter((c) => c.getBoundingClientRect().top === smileys[0].getBoundingClientRect().top)).toHaveLength(9);

    // Every group holds its height; far ones mount nothing yet.
    const flags = group(root, "flags");
    expect(flags.getBoundingClientRect().height).toBeGreaterThan(1000);
    expect(flags.querySelectorAll(".xp-cell")).toHaveLength(0);
    const mountedCells = root.querySelectorAll(".xp-cell").length;
    expect(mountedCells).toBeGreaterThan(0);
    expect(mountedCells).toBeLessThan(250);
  });

  test("a space with several emoji packs: one group, a sub-header per pack", async () => {
    const more = pack("ep2", ExpressionKind.Emoji, "More", [item("em-9", "ep2", ExpressionKind.Emoji, 0)], 2);
    seed([stickers, emoji, more]);
    const wrapper = open();
    await ready(wrapper);
    const space = group(wrapper.element, "space:s1");
    expect($$(space, ".xp-section").map((s) => s.dataset.sectionId)).toEqual(["pack:ep", "pack:ep2"]);
    expect($$(space, ".xp-section__title").map((t) => t.textContent?.trim())).toEqual(["Party", "More"]);
    expect(railIds(wrapper.element).filter((id) => id?.startsWith("space:"))).toEqual(["space:s1"]);
  });

  // Headless Chromium hides scrollbars outright, so the bar is checked by what styles it.
  test("the grid, the rail and the GIF list scroll with the theme's thin bar, not the browser's", async () => {
    const wrapper = open();
    await ready(wrapper);
    const rules = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules];
        } catch {
          return [];
        }
      })
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule);
    const rule = (selector: string) => rules.find((r) => r.selectorText.split(",").some((s) => s.trim() === selector));

    for (const box of [grid(wrapper.element), $(wrapper.element, ".xp-rail")!]) {
      expect(box.classList).toContain("xp-scroll");
      // Chromium drops ::-webkit-scrollbar styling once either of these is set.
      expect(getComputedStyle(box).scrollbarWidth).toBe("auto");
      expect(getComputedStyle(box).scrollbarColor).toBe("auto");
    }
    expect(rule(".xp-scroll::-webkit-scrollbar")?.style.width).toBe("6px");
    expect(rule(".xp-scroll::-webkit-scrollbar-thumb")?.style.backgroundColor).toContain("--foreground");
    expect(rule(".xp .xp-gifs .gif-picker-grid-container::-webkit-scrollbar-thumb")).toBeDefined();
    expect(rule(".xp .xp-gifs .gif-picker-grid-container")?.style.scrollbarColor).toBe("auto");
  });

  test("a click on the rail scrolls to that group; scrolling the grid moves the rail along", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;

    $(root, '[data-rail="animals"]')!.click();
    await nextTick();
    expect(activeRail(root)).toEqual(["animals"]);
    await until(() => Math.abs(grid(root).scrollTop - group(root, "animals").offsetTop) < 2);
    await until(() => !!group(root, "animals").querySelector(".xp-cell"));

    // Once the jump has landed, the grid leads again.
    await new Promise((r) => setTimeout(r, 1100));
    await scrollGridTo(root, "food");
    expect(activeRail(root)).toEqual(["food"]);
    await scrollGridTo(root, "space:s1");
    expect(activeRail(root)).toEqual(["space:s1"]);
  });

  test("a unicode pick emits the emoji and puts it first under the recent header next time", async () => {
    const wrapper = open();
    await ready(wrapper);
    const first = emojiRegistry.getByCategory("smileys")[0];
    $(group(wrapper.element, "smileys"), ".xp-cell")!.click();
    expect(wrapper.emitted("select-emoji")?.[0]).toEqual([String.fromCodePoint(...first.codepoints)]);

    const again = open();
    await ready(again);
    expect(groupIds(again.element).slice(0, 2)).toEqual(["recent", "space:s1"]);
    expect(groupTitle(again.element, "recent")).toBe("expression_picker_recent");
    expect(railIds(again.element)[0]).toBe("recent");
    expect($(again.element, '[data-group-id="recent"] [data-cell="0:0"]')?.getAttribute("aria-label")).toBe(first.name);
  });

  test("a custom pick emits it and records it as recent", async () => {
    const wrapper = open();
    await ready(wrapper);
    $(wrapper.element, ".xp-cell--custom")!.click();
    expect((wrapper.emitted("select-custom-emoji")?.[0]?.[0] as ExpressionItem).itemId).toBe("em-0");
    expect(useExpressionsStore().recentEmoji[0]).toBe("em-0");
  });

  test("the footer names what the pointer (or the focus) is on: :name:, and for a space's own its pack and space", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;
    await until(() => groupTitle(root, "space:s1") === SPACE_NAME);

    hover($$(root, ".xp-cell--custom")[1]);
    await until(() => footerName(root) === ":em_1:");
    expect(footerDetail(root)).toBe(`Party · ${SPACE_NAME}`);
    expect(width($(root, "[data-picker-footer] .ce"))).toBe(32);

    const smiley = emojiRegistry.getByCategory("smileys")[1];
    hover($$(group(root, "smileys"), ".xp-cell")[1]);
    await until(() => footerName(root) === `:${smiley.shortcode}:`);
    expect(footerDetail(root)).toBeNull();
    expect(width($(root, "[data-picker-footer] .xp-foot__sprite"))).toBe(32);

    $$(root, ".xp-cell--custom")[0].focus();
    await until(() => footerName(root) === ":em_0:");
  });

  test("the sticker tab: a group per pack headed with its pack and space, 96 px cells four to a row", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;
    $(root, '[data-tab="stickers"]')!.click();
    await until(() => !!$(root, ".xp-cell--sticker"));

    expect(groupIds(root)).toEqual(["pack:sp"]);
    await until(() => groupTitle(root, "pack:sp") === `Cats · ${SPACE_NAME}`);
    expect(railIds(root)).toEqual(["space:s1", "pack:sp"]);
    expect(activeRail(root)).toEqual(["space:s1", "pack:sp"]);
    expect($(root, '[data-rail="pack:sp"] .sticker-view')).not.toBeNull();

    const cells = $$(root, ".xp-cell--sticker");
    expect(cells).toHaveLength(3);
    expect(width(cells[0])).toBe(96);
    expect(width(cells[0].querySelector(".sticker-view"))).toBe(88);
    expect(new Set(cells.map((c) => c.getBoundingClientRect().top)).size).toBe(1);

    hover(cells[2]);
    await until(() => footerName(root) === "st_2");
    expect(footerDetail(root)).toBe(`Cats · ${SPACE_NAME}`);

    cells[1].click();
    expect((wrapper.emitted("select-sticker")?.[0]?.[0] as ExpressionItem).itemId).toBe("st-1");
    expect(useExpressionsStore().recentStickers[0]).toBe("st-1");
  });

  test("hovering a sticker previews it large; only the preview plays meanwhile", async () => {
    const wrapper = open({ initialTab: "stickers" });
    await until(() => !!$(wrapper.element, ".xp-cell--sticker"));
    const pool = getLottiePool();
    hover($(wrapper.element, ".xp-cell--sticker")!);
    await until(() => !!document.querySelector("[data-sticker-preview]"), 2_000);
    const preview = document.querySelector("[data-sticker-preview] .sticker-view")!;
    expect(preview.getBoundingClientRect().width).toBe(Math.min(360, Math.floor(Math.min(innerWidth, innerHeight) * 0.7)));
    expect(pool.intersector.onlyPlayableGroup).toBe("preview");

    grid(wrapper.element).dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    await until(() => !document.querySelector("[data-sticker-preview]"));
    expect(pool.intersector.onlyPlayableGroup).toBeNull();
  });

  test("keyboard: down from the search enters the grid, arrows move across groups, Enter picks, typing returns", async () => {
    const wrapper = open();
    await ready(wrapper);
    const input = $<HTMLInputElement>(wrapper.element, ".xp-search__input")!;
    expect(document.activeElement).toBe(input);

    await userEvent.keyboard("{ArrowDown}");
    await until(() => focused()?.dataset?.cell === "0:0");
    await userEvent.keyboard("{ArrowRight}");
    await until(() => focused()?.dataset?.cell === "0:1");
    expect(focused().tabIndex).toBe(0);
    await userEvent.keyboard("{ArrowRight}");
    await until(() => focused()?.dataset?.cell === "1:0");

    await userEvent.keyboard("{Enter}");
    const first = emojiRegistry.getByCategory("smileys")[0];
    expect(wrapper.emitted("select-emoji")?.[0]).toEqual([String.fromCodePoint(...first.codepoints)]);

    await userEvent.keyboard("g");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("g");
  });

  test("keyboard: Tab goes header → rail → grid; arrows move along the rail and Enter jumps", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(focused().dataset.tab).toBe("emoji");
    await userEvent.tab();
    expect(focused()).toBe($(root, ".xp-search__input"));
    await userEvent.tab();
    expect(focused()).toBe($(root, "[data-tone-button]"));

    await userEvent.tab();
    expect(focused().dataset.rail).toBe("space:s1");
    await userEvent.keyboard("{ArrowDown}");
    expect(focused().dataset.rail).toBe("smileys");
    await userEvent.keyboard("{ArrowDown}");
    expect(focused().dataset.rail).toBe("people");
    await userEvent.keyboard("{Enter}");
    await until(() => Math.abs(grid(root).scrollTop - group(root, "people").offsetTop) < 2);
    await until(() => !!group(root, "people").querySelector(".xp-cell"));
    await frame();

    // Into the grid, on a cell that is on screen.
    await userEvent.tab();
    expect(focused().dataset.cell).toMatch(/^\d+:\d+$/);
    expect(focused().closest("[data-group-id]")?.getAttribute("data-group-id")).toBe("people");
  });

  test("Esc clears a search first, then asks to close", async () => {
    const wrapper = open();
    await ready(wrapper);
    const input = $<HTMLInputElement>(wrapper.element, ".xp-search__input")!;
    await userEvent.keyboard("kitty");
    expect(input.value).toBe("kitty");

    await userEvent.keyboard("{Escape}");
    expect(input.value).toBe("");
    expect(wrapper.emitted("close")).toBeUndefined();

    await userEvent.keyboard("{Escape}");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("search: the space's own under its name, then unicode; the rail takes you back; stickers by keyword", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;
    await until(() => groupTitle(root, "space:s1") === SPACE_NAME);
    const input = $<HTMLInputElement>(root, ".xp-search__input")!;
    input.value = "em_";
    input.dispatchEvent(new Event("input"));
    await until(() => groupIds(root)[0] === "search:space:s1");
    expect(groupTitle(root, "search:space:s1")).toBe(SPACE_NAME);
    expect(activeRail(root)).toEqual([]);

    input.value = "grinning";
    input.dispatchEvent(new Event("input"));
    await until(() => groupIds(root).includes("search:unicode"));

    // A rail entry leaves the results for that group.
    $(root, '[data-rail="animals"]')!.click();
    await until(() => input.value === "" && groupIds(root)[0] === "space:s1");
    await until(() => Math.abs(grid(root).scrollTop - group(root, "animals").offsetTop) < 2);

    $(root, '[data-tab="stickers"]')!.click();
    await nextTick();
    input.value = "kitty";
    input.dispatchEvent(new Event("input"));
    await until(() => root.querySelectorAll(".xp-cell--sticker").length === 3);

    input.value = "nothing-like-this";
    input.dispatchEvent(new Event("input"));
    await until(() => !!$(root, "[data-empty]"));
  });

  test("skin tones: right click offers them drawn from the atlases; the pick is sent toned, remembered and shown", async () => {
    const wrapper = open();
    await ready(wrapper);
    const root = wrapper.element;
    const people = emojiRegistry.getByCategory("people");
    const index = people.findIndex((e) => e.hasSkinTones);
    await scrollGridTo(root, "people");
    const section = group(root, "people").querySelector<HTMLElement>(".xp-section")!;
    const cellSelector = `[data-cell$=":${index}"]`;
    await until(() => !!$(section, cellSelector));
    const cell = $(section, cellSelector)!;
    const before = $(cell, ".xp-sprite")!.style.backgroundImage;

    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await until(() => document.querySelectorAll(".xp-tones button").length === 6);
    const sprites = [...document.querySelectorAll<HTMLElement>(".xp-tones .xp-tones__sprite")];
    expect(sprites).toHaveLength(6);
    expect(sprites[3].style.backgroundImage).toContain("tone3");
    expect(document.querySelector(".xp-tones__emoji")).toBeNull();
    document.querySelector<HTMLElement>('.xp-tones [data-tone="medium"]')!.click();
    await nextTick();

    const [text] = wrapper.emitted("select-emoji")![0] as [string];
    expect([...text]).toContain("\u{1F3FD}");
    expect(JSON.parse(localStorage.getItem("argon_emoji_skin_tone")!)).toBe("medium");
    expect(document.querySelector(".xp-tones")).toBeNull();

    // The grid and the header's button now draw that tone.
    await until(() => $(cell, ".xp-sprite")!.style.backgroundImage.includes("tone3"));
    expect(before).not.toContain("tone3");
    expect($<HTMLElement>(root, "[data-tone-button] .xp-tone__sprite")!.style.backgroundImage).toContain("tone3");
  });

  test("the header's tone button sets the tone without sending anything", async () => {
    const wrapper = open();
    await ready(wrapper);
    $(wrapper.element, "[data-tone-button]")!.click();
    await until(() => document.querySelectorAll(".xp-tones button").length === 6);
    document.querySelector<HTMLElement>('.xp-tones [data-tone="dark"]')!.click();
    await nextTick();
    expect(wrapper.emitted("select-emoji")).toBeUndefined();
    expect(JSON.parse(localStorage.getItem("argon_emoji_skin_tone")!)).toBe("dark");
  });

  test("the GIF tab is the GIF picker, its pick passed on; no rail there", async () => {
    const wrapper = open();
    await ready(wrapper);
    $(wrapper.element, '[data-tab="gifs"]')!.click();
    await until(() => !!$(wrapper.element, "[data-gif-stub]"));
    expect($(wrapper.element, ".xp-rail")).toBeNull();
    $(wrapper.element, "[data-gif-stub]")!.click();
    expect(wrapper.emitted("select-gif")?.[0]).toEqual([{ gifId: "g1" }]);
  });

  test("reaction mode is the emoji tab alone, with its tab bar, rail and search", async () => {
    const wrapper = open({ mode: "reaction" });
    await ready(wrapper);
    expect(tabs(wrapper.element)).toEqual(["emoji"]);
    expect(railIds(wrapper.element)).toEqual(["space:s1", ...UNICODE]);
    expect($(wrapper.element, ".xp-search__input")).not.toBeNull();
    expect(groupIds(wrapper.element)).toContain("space:s1");
  });

  test("no sticker packs anywhere: says so, and offers the settings to those who can manage them", async () => {
    seed([emoji]);
    const wrapper = open({ initialTab: "stickers", canManage: true });
    await until(() => !!$(wrapper.element, "[data-empty]"));
    expect(wrapper.element.textContent).toContain("expression_picker_no_stickers");
    $(wrapper.element, "[data-empty] button")!.click();
    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });

  test("the rail's + leads a manager to the space's settings", async () => {
    const wrapper = open({ canManage: true });
    await ready(wrapper);
    const railOrder = $$(wrapper.element, ".xp-rail__item").map((b) => b.dataset.rail);
    expect(railOrder.slice(0, 3)).toEqual(["space:s1", "manage", "smileys"]);
    $(wrapper.element, '[data-rail="manage"]')!.click();
    expect(wrapper.emitted("open-settings")).toHaveLength(1);

    const member = open();
    await ready(member);
    expect($(member.element, '[data-rail="manage"]')).toBeNull();
  });

  test("in a direct chat: every space is loaded and offered under its own name, by name", async () => {
    await db.servers.put(spaceRow("s0", "Dogs Space"));
    seed([pack("dp", ExpressionKind.Emoji, "Woof", [item("dog-0", "dp", ExpressionKind.Emoji, 0, "s0")], 0, "s0")], "s0");
    const store = useExpressionsStore();
    const loadAll = vi.spyOn(store, "ensureLoadedAll");

    const wrapper = open({ spaceId: null });
    await ready(wrapper);
    const root = wrapper.element;
    expect(loadAll).toHaveBeenCalledTimes(1);
    await until(() => groupTitle(root, "space:s0") === "Dogs Space");
    expect(groupIds(root).slice(0, 2)).toEqual(["space:s1", "space:s0"]);
    expect(railIds(root).slice(0, 2)).toEqual(["space:s1", "space:s0"]);
    expect($(root, '[data-rail="manage"]')).toBeNull();

    hover($(group(root, "space:s0"), ".xp-cell--custom")!);
    await until(() => footerDetail(root) === "Woof · Dogs Space");
  });
});
