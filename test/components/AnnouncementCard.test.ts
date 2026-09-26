/**
 * An announcement post as a card: who heads it (the author, or the space with an optional byline),
 * the cover taken from the first image, and "Read more" on long posts.
 *
 * Everything around the card's own decisions (avatars, the profile popover, image loading, the
 * rich-text renderer) is stubbed; what is under test is which of them the card asks for.
 */

import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({
    t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${Object.values(p).join(",")}` : k),
  }),
}));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({}) }));
vi.mock("@/lib/linkPreview/settings", async () => {
  const { ref } = await import("vue");
  return { showLinkPreviews: ref(true), sendLinkPreviews: ref(true) };
});

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => async () => {
    const { defineComponent, h } = await import("vue");
    return { default: defineComponent({ name, inheritAttrs: false, setup: () => () => h("i", { class: `stub-${name}` }) }) };
  },
}));

vi.mock("@/components/ArgonAvatar.vue", stub("ArgonAvatar"));
vi.mock("@/components/popovers/UserProfilePopover.vue", stub("UserProfilePopover"));
vi.mock("@/components/chats/AttachmentImage.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: ["fileId"], setup: (p) => () => h("img", { "data-image": p.fileId }) }) };
});
vi.mock("@/components/chats/AttachmentImageGrid.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      props: ["images"],
      emits: ["open-lightbox"],
      setup: (props, { emit }) => () =>
        h("div", { class: "stub-grid" }, (props.images as any[]).map((img, i) =>
          h("button", { "data-grid": img.fileId, onClick: () => emit("open-lightbox", i) }))),
    }),
  };
});
vi.mock("@/components/chats/AttachmentFileCard.vue", stub("AttachmentFileCard"));
vi.mock("@/components/chats/LinkPreviewCard.vue", stub("LinkPreviewCard"));
vi.mock("@/components/chats/ChatSegment.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: ["text", "entity"], setup: (p) => () => h("span", p.text) }) };
});
vi.mock("@argon/ui/popover", async () => {
  const { defineComponent, h } = await import("vue");
  const pass = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => h("span", { class: name }, slots.default?.()) });
  return { Popover: pass("Popover"), PopoverTrigger: pass("PopoverTrigger"), PopoverContent: defineComponent({ setup: () => () => null }) };
});

import { EntityType, MessageEntityAttachment } from "@argon/glue";
import AnnouncementCard from "@/components/chats/AnnouncementCard.vue";

const image = (id: string) =>
  new MessageEntityAttachment(EntityType.Attachment, 0, 0, 1, id, `${id}.png`, 1024n, "image/png", 1600, 900, null, null);

const message = (text: string, entities: unknown[] = []) =>
  ({
    messageId: 1n,
    replyId: null,
    channelId: "c1",
    spaceId: "s1",
    text,
    entities,
    timeSent: { toDate: () => new Date(2026, 8, 26, 14, 5) },
    sender: "alice",
    reactions: [],
    controls: null,
    editedAt: null,
  }) as any;

const author = { userId: "alice", displayName: "Alice", avatarFileId: "alice.png" };
const space = { name: "Guild", avatarFileId: "guild.png" };

function render(text: string, settings: Partial<{ reactions: boolean; postAsSpace: boolean; showAuthor: boolean }> = {}, entities: unknown[] = []) {
  return mount(AnnouncementCard, {
    props: {
      message: message(text, entities),
      context: { settings: { reactions: true, postAsSpace: false, showAuthor: true, ...settings }, space },
      author,
      authorColor: "#f00",
    },
  });
}

describe("AnnouncementCard header", () => {
  test("shows the author when the channel does not post as the space", () => {
    const w = render("hello");
    expect(w.get("[data-testid=announcement-title]").text()).toBe("Alice");
    expect(w.find("[data-testid=announcement-byline]").exists()).toBe(false);
  });

  test("shows the space and a byline when posting as the space with the author shown", () => {
    const w = render("hello", { postAsSpace: true, showAuthor: true });
    expect(w.get("[data-testid=announcement-title]").text()).toBe("Guild");
    expect(w.get("[data-testid=announcement-byline]").text()).toBe("announcement_by_author:Alice");
  });

  test("names nobody but the space when the author is hidden", () => {
    const w = render("hello", { postAsSpace: true, showAuthor: false });
    expect(w.get("[data-testid=announcement-title]").text()).toBe("Guild");
    expect(w.find("[data-testid=announcement-byline]").exists()).toBe(false);
    expect(w.get("[data-testid=announcement-header]").text()).not.toContain("Alice");
  });

  test("puts the date up front", () => {
    const w = render("hello");
    expect(w.get("time").text()).toContain("2026");
  });
});

describe("AnnouncementCard read more", () => {
  test("a short post is shown whole", () => {
    const w = render("Raid at 20:00");
    expect(w.find("[data-testid=announcement-read-more]").exists()).toBe(false);
    expect(w.get("[data-testid=announcement-body]").classes()).not.toContain("announcement-body--collapsed");
  });

  test("a long post starts collapsed and opens and closes", async () => {
    const w = render("a".repeat(900));
    const body = () => w.get("[data-testid=announcement-body]");
    const toggle = () => w.get("[data-testid=announcement-read-more]");

    expect(body().classes()).toContain("announcement-body--collapsed");
    expect(toggle().text()).toBe("announcement_read_more");

    await toggle().trigger("click");
    expect(body().classes()).not.toContain("announcement-body--collapsed");
    expect(toggle().text()).toBe("announcement_show_less");

    await toggle().trigger("click");
    expect(body().classes()).toContain("announcement-body--collapsed");
  });

  test("many short lines count as long", () => {
    const w = render(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
    expect(w.find("[data-testid=announcement-read-more]").exists()).toBe(true);
  });
});

describe("AnnouncementCard cover", () => {
  test("the first image is the cover and the others stay in the grid", () => {
    const w = render("patch notes", {}, [image("a"), image("b"), image("c")]);
    expect(w.get("[data-testid=announcement-cover] [data-image]").attributes("data-image")).toBe("a");
    expect(w.findAll("[data-grid]").map((b) => b.attributes("data-grid"))).toEqual(["b", "c"]);
  });

  test("no image, no cover", () => {
    const w = render("text only");
    expect(w.find("[data-testid=announcement-cover]").exists()).toBe(false);
  });

  test("the lightbox opens on the cover and on the grid, over all images in order", async () => {
    const w = render("gallery", {}, [image("a"), image("b"), image("c")]);

    await w.get("[data-testid=announcement-cover]").trigger("click");
    await w.get("[data-grid=c]").trigger("click");

    const calls = w.emitted("open-lightbox")!;
    expect((calls[0][0] as any[]).map((i) => i.fileId)).toEqual(["a", "b", "c"]);
    expect(calls[0][1]).toBe(0);
    expect(calls[1][1]).toBe(2);
  });
});
