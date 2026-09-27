/**
 * StatusEmoji's three outcomes: the profile's custom emoji through StickerView (looping, in the
 * "status" group), a unicode icon as text at the given size, or nothing at all. A custom emoji plays
 * with the animation setting: in a list row (the default, "hover") only while the row is hovered,
 * on a profile card ("always") whenever animations are on.
 */

import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ExpressionFormat, type StatusEmoji as StatusEmojiData } from "@argon/glue";

const h = vi.hoisted(() => ({ animations: { value: true } }));

vi.mock("@/components/expressions/StickerView.vue", async () => {
  const { defineComponent, h: render } = await import("vue");
  return {
    default: defineComponent({
      name: "StickerView",
      props: {
        media: { type: Object, required: true },
        size: Number,
        autoplay: { type: Boolean, default: undefined },
        loop: Boolean,
        group: String,
      },
      setup: (props) => () => render("div", { class: "stub-sticker", "data-file": (props.media as { fileId: string }).fileId }),
    }),
  };
});
vi.mock("@/lib/expressions/settings", async () => {
  const { ref } = await import("vue");
  const animationsEnabled = ref(true);
  h.animations = animationsEnabled;
  return { animationsEnabled };
});

import StatusEmoji from "@/components/expressions/StatusEmoji.vue";

const emoji: StatusEmojiData = {
  itemId: "0192f0c1-7a3e-7c55-9b7e-2f1d3c4b5a69",
  spaceId: "space-cats",
  fileId: "file-blob",
  format: ExpressionFormat.Video,
  name: "blob_wave",
};

const custom = { customStatusIconId: `ce:${emoji.itemId}`, customStatusEmoji: emoji };

describe("StatusEmoji", () => {
  test("a custom emoji is drawn by StickerView, from the profile's own copy of it", () => {
    const wrapper = mount(StatusEmoji, { props: { profile: custom, size: 18, animateOn: "always" } });
    const sticker = wrapper.findComponent({ name: "StickerView" });
    expect(sticker.exists()).toBe(true);
    expect(sticker.props()).toMatchObject({
      media: { fileId: "file-blob", format: ExpressionFormat.Video, width: 100, height: 100 },
      size: 18,
      autoplay: true,
      loop: true,
      group: "status",
    });
    expect(sticker.attributes("aria-label")).toBe(":blob_wave:");
  });

  test("in a list row (the default) it holds its first frame until the row is hovered, and again after", async () => {
    const wrapper = mount(StatusEmoji, { props: { profile: custom } });
    const autoplay = () => wrapper.findComponent({ name: "StickerView" }).props("autoplay");
    expect(autoplay()).toBe(false);

    await wrapper.setProps({ hovered: true });
    expect(autoplay()).toBe(true);

    await wrapper.setProps({ hovered: false });
    expect(autoplay()).toBe(false);
  });

  test("with animations off it holds still, hovered or not", () => {
    h.animations.value = false;
    for (const props of [{ animateOn: "always" as const }, { animateOn: "hover" as const, hovered: true }]) {
      const wrapper = mount(StatusEmoji, { props: { profile: custom, ...props } });
      expect(wrapper.findComponent({ name: "StickerView" }).props("autoplay")).toBe(false);
    }
    h.animations.value = true;
  });

  test("a unicode icon is drawn as the emoji at the given size (16 by default)", () => {
    const wrapper = mount(StatusEmoji, { props: { profile: { customStatusIconId: "🍕", customStatusEmoji: null } } });
    const box = wrapper.get("[data-status-emoji=unicode]");
    expect(box.text()).toBe("🍕");
    expect((box.element as HTMLElement).style.width).toBe("16px");
    expect(wrapper.findComponent({ name: "StickerView" }).exists()).toBe(false);
  });

  test("nothing without an icon, or for a ce: id whose emoji the profile does not carry", () => {
    for (const profile of [null, { customStatusIconId: null, customStatusEmoji: null }, { customStatusIconId: `ce:${emoji.itemId}`, customStatusEmoji: null }]) {
      const wrapper = mount(StatusEmoji, { props: { profile } });
      expect(wrapper.find("[data-status-emoji]").exists()).toBe(false);
      expect(wrapper.findComponent({ name: "StickerView" }).exists()).toBe(false);
    }
  });
});
