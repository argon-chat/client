/**
 * The emoji & sticker edit dialogs laid out in a real browser at a desktop and a phone width: the
 * content never gets wider than the dialog (no sideways scroll), the chip rows wrap, and every
 * action button stays on screen. Also the form's own rules: associated emoji are optional, emoji
 * names are checked as they are typed.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, afterEach } from "vitest";
import { page } from "vitest/browser";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { ExpressionFormat, ExpressionKind, type ExpressionItem } from "@argon/glue";

const { RU } = vi.hoisted(() => ({
  // The longest labels the dialog has (Russian), so a narrow width is tested at its worst.
  RU: {
    expression_settings_delete: "Удалить",
    expression_settings_item_set_cover: "Сделать обложкой набора",
    expression_settings_cancel: "Отмена",
    expression_settings_save: "Сохранить",
    expression_settings_item_edit_title: "Изменить элемент",
    expression_settings_item_emoji_placeholder: "Введите или вставьте эмодзи",
    expression_settings_item_keywords_placeholder: "Введите слово и нажмите Enter",
    expression_settings_item_text_color_hint: "Для одноцветных эмодзи: они берут цвет окружающего текста",
  } as Record<string, string>,
}));

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => RU[k] ?? k }) }));
vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("../fixtures/tiny-lottie.json?url");
  return { cdnUrl: () => url, cdnFetchUrl: () => url, cdnCrossOrigin: () => undefined };
});
vi.mock("@/store/data/expressionsStore", () => ({
  toMedia: (item: ExpressionItem) => ({ fileId: item.fileId, format: item.format, width: item.width, height: item.height, outline: null, textColor: false }),
}));

import ExpressionItemDialog from "@/components/settings/spaces/expressions/ExpressionItemDialog.vue";
import ExpressionPackDialog from "@/components/settings/spaces/expressions/ExpressionPackDialog.vue";
import type { ExpressionItemPatch } from "@/store/data/expressionsStore";

const EMOJI = ["😀", "😂", "🥰", "😎", "🤔", "😭", "😡", "👍", "👎", "❤️", "🔥", "🎉", "👀", "🙏", "💯", "✨", "🇺🇦", "👍🏽", "🧑‍💻", "🏳️‍🌈"];

const emojiItem = (): ExpressionItem => ({
  itemId: "i1",
  packId: "p1",
  spaceId: "s1",
  kind: ExpressionKind.Emoji,
  format: ExpressionFormat.Lottie,
  // 32 characters: as long as an emoji name gets.
  name: "a_rather_long_emoji_name_4_tests",
  fileId: "f1",
  thumbFileId: null,
  width: 100,
  height: 100,
  fileSize: 1,
  emoji: EMOJI,
  keywords: ["celebration", "party", "confetti", "happy", "birthday", "yay"],
  outline: null,
  textColor: false,
  sortOrder: 0,
  downloadUrl: null,
  thumbUrl: null,
  creatorId: "me",
});

const mounted: VueWrapper[] = [];

afterEach(async () => {
  for (const w of mounted.splice(0)) w.unmount();
  await page.viewport(414, 896);
});

async function until(check: () => boolean, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

type DialogProps = {
  item?: ExpressionItem;
  canSetCover?: boolean;
  save?: (patch: ExpressionItemPatch) => Promise<string | null>;
};

function openItemDialog(props: DialogProps = {}) {
  const wrapper = mount(ExpressionItemDialog, {
    props: {
      open: true,
      item: emojiItem(),
      takenNames: new Set(["taken_name"]),
      isCover: false,
      canSetCover: true,
      save: async () => null,
      remove: async () => null,
      setCover: async () => null,
      ...props,
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

function expectFits(content: HTMLElement, buttons: HTMLElement[]) {
  expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
  const box = content.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(window.innerWidth);
  for (const button of buttons) {
    const r = button.getBoundingClientRect();
    expect(r.width).toBeGreaterThan(0);
    expect(r.left).toBeGreaterThanOrEqual(box.left);
    expect(r.right).toBeLessThanOrEqual(Math.min(box.right, window.innerWidth));
    expect(r.left).toBeGreaterThanOrEqual(0);
  }
}

describe("item dialog layout", () => {
  for (const width of [700, 380]) {
    test(`at ${width} px: no sideways overflow, chips wrap, all four buttons on screen`, async () => {
      await page.viewport(width, 800);
      openItemDialog();
      await until(() => !!document.querySelector("[data-expression-item-dialog]"));
      await frame();

      const content = document.querySelector<HTMLElement>("[data-expression-item-dialog]")!;
      const buttons = ["[data-delete-item]", "[data-set-cover]", "[data-cancel]", "[data-save]"].map((s) => content.querySelector<HTMLElement>(s)!);
      expect(buttons.every(Boolean)).toBe(true);
      expectFits(content, buttons);

      // Twenty emoji take more than one row, inside the field.
      const chips = content.querySelector<HTMLElement>("[data-emoji-chips]")!;
      expect(chips.scrollWidth).toBeLessThanOrEqual(chips.clientWidth + 1);
      const tops = new Set(Array.from(chips.querySelectorAll(".chip"), (c) => Math.round(c.getBoundingClientRect().top)));
      expect(tops.size).toBeGreaterThan(1);
      const quick = content.querySelector<HTMLElement>("[data-quick-emoji]")!;
      expect(quick.scrollWidth).toBeLessThanOrEqual(quick.clientWidth + 1);
    });
  }
});

describe("item dialog form", () => {
  test("associated emoji are optional: all removed, it still saves", async () => {
    const saved: unknown[] = [];
    openItemDialog({
      save: async (patch) => {
        saved.push(patch);
        return null;
      },
    });
    await until(() => !!document.querySelector("[data-emoji-chips]"));
    const chips = () => document.querySelectorAll<HTMLElement>("[data-emoji-chips] .chip");
    while (chips().length) {
      chips()[0].click();
      await nextTick();
    }
    const save = document.querySelector<HTMLButtonElement>("[data-save]")!;
    expect(save.disabled).toBe(false);
    save.click();
    await until(() => saved.length === 1);
    expect(saved[0]).toEqual({ emoji: [] });
  });

  test("an emoji name is checked as it is typed and shows how to use it", async () => {
    openItemDialog();
    await until(() => !!document.getElementById("expression-item-name"));
    const name = document.getElementById("expression-item-name") as HTMLInputElement;

    name.value = "Party Parrot";
    name.dispatchEvent(new Event("input"));
    await nextTick();
    // Capitals and spaces become what an emoji name must be.
    expect(name.value).toBe("party_parrot");
    expect(document.querySelector("[data-name-error]")).toBeNull();
    expect(document.querySelector("[data-expression-item-dialog]")!.textContent).toContain("expression_settings_item_name_hint_emoji");

    name.value = "x";
    name.dispatchEvent(new Event("input"));
    await nextTick();
    expect(document.querySelector("[data-name-error]")!.textContent).toContain("expression_settings_name_length_emoji");
    expect(document.querySelector<HTMLButtonElement>("[data-save]")!.disabled).toBe(true);

    name.value = "taken_name";
    name.dispatchEvent(new Event("input"));
    await nextTick();
    expect(document.querySelector("[data-name-error]")!.textContent).toContain("expression_settings_name_taken");
  });

  test("pasted emoji become chips", async () => {
    openItemDialog({ item: { ...emojiItem(), emoji: [] } });
    await until(() => !!document.getElementById("expression-item-emoji"));
    const input = document.getElementById("expression-item-emoji") as HTMLInputElement;
    input.value = "yes 🎉🔥 🎉";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(Array.from(document.querySelectorAll("[data-emoji-chips] .chip"), (c) => c.textContent!.trim())).toEqual(["🎉", "🔥"]);
    expect(input.value).toBe("");
  });

  test("with no emoji yet, the name suggests a few; a tap adds one and the suggestions go", async () => {
    openItemDialog({ item: { ...emojiItem(), name: "party_parrot", emoji: [] } });
    await until(() => document.querySelectorAll("[data-name-emoji-chip]").length > 0);
    const offered = Array.from(document.querySelectorAll<HTMLElement>("[data-name-emoji-chip]"));
    expect(offered.length).toBeLessThanOrEqual(3);
    const parrot = offered.find((c) => c.textContent!.trim() === "🦜")!;
    expect(parrot).toBeTruthy();
    parrot.click();
    await nextTick();
    expect(Array.from(document.querySelectorAll("[data-emoji-chips] .chip"), (c) => c.textContent!.trim())).toEqual(["🦜"]);
    expect(document.querySelector("[data-name-emoji]")).toBeNull();
  });

  test("the cover control shows only where the pack is the member's", async () => {
    openItemDialog({ canSetCover: false });
    await until(() => !!document.querySelector("[data-save]"));
    expect(document.querySelector("[data-set-cover]")).toBeNull();
  });
});

describe("pack dialog layout", () => {
  for (const width of [700, 380]) {
    test(`at ${width} px: no sideways overflow, both buttons on screen`, async () => {
      await page.viewport(width, 800);
      const wrapper = mount(ExpressionPackDialog, {
        props: { open: true, mode: "edit", initialTitle: "A pack with a rather long title", initialSlug: "a_pack_with_a_rather_long_title", submit: async () => null },
        attachTo: document.body,
      });
      mounted.push(wrapper);
      await until(() => !!document.querySelector("[data-expression-pack-dialog]"));
      await frame();
      const content = document.querySelector<HTMLElement>("[data-expression-pack-dialog]")!;
      expectFits(content, [content.querySelector<HTMLElement>("[data-cancel]")!, content.querySelector<HTMLElement>("[data-save]")!]);
    });
  }
});
