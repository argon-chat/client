/**
 * Reaction pills. In an announcement channel with reactions off nobody adds one, but a reader can
 * still take back their own: those pills stay clickable, the rest do not. A custom emoji reaction
 * is drawn from its item when the resolver knows it, else as a neutral mark with its count.
 */

import { describe, test, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@argon-chat/emojix", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    EmojiSprite: defineComponent({ setup: () => () => h("i") }),
    emojiRegistry: { getByHexcode: () => undefined },
    stringToCodepoints: () => [],
    codepointsToHexcode: () => "",
    isEmojiOnly: () => ({ isOnlyEmoji: false, count: 0, emojis: [] }),
  };
});
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: (id: string) => `data:,${id}`,
  cdnFetchUrl: (id: string) => `data:,${id}`,
  cdnCrossOrigin: () => undefined,
}));
vi.mock("@/store/db/dexie", () => ({
  db: { servers: { get: async (id: string) => (id === "s-cats" ? { spaceId: "s-cats", name: "Cats", avatarFieldId: null } : undefined) } },
}));

import { nextTick } from "vue";
import MessageReactions from "@/components/chats/MessageReactions.vue";
import { EXPRESSION_RESOLVER, noopResolver } from "@/lib/expressions/resolver";

const reactions = [
  { emoji: "👍", customEmojiId: null, count: 2, userIds: ["me", "you"] },
  { emoji: "🔥", customEmojiId: null, count: 1, userIds: ["you"] },
] as any[];

const pills = (props: { canReact: boolean; removeOnly?: boolean }) =>
  mount(MessageReactions, { props: { reactions, currentUserId: "me", ...props } }).findAll("button");

describe("MessageReactions", () => {
  test("every pill works when reacting is allowed", () => {
    expect(pills({ canReact: true }).map((b) => b.attributes("disabled"))).toEqual([undefined, undefined]);
  });

  test("no pill works without the right to react", () => {
    expect(pills({ canReact: false }).every((b) => b.attributes("disabled") !== undefined)).toBe(true);
  });

  test("with reactions off only your own pill can be clicked, to take it back", async () => {
    const w = mount(MessageReactions, { props: { reactions, currentUserId: "me", canReact: false, removeOnly: true } });
    const [mine, theirs] = w.findAll("button");

    expect(mine.attributes("disabled")).toBeUndefined();
    expect(theirs.attributes("disabled")).toBeDefined();

    await mine.trigger("click");
    expect(w.emitted("toggle")).toEqual([["👍"]]);
  });

  test("custom emoji reactions: known ones drawn from their item, unknown ones as a mark; toggled by item", async () => {
    const party = { itemId: "item-party", name: "party", fileId: "file-party", format: 0, width: 64, height: 64, textColor: false } as any;
    const resolver = { ...noopResolver, itemById: (id: string) => (id === "item-party" ? party : null) };
    const custom = [
      { emoji: "👍", customEmojiId: null, count: 1, userIds: ["you"] },
      { emoji: ":party:", customEmojiId: "item-party", count: 3, userIds: ["you"] },
      { emoji: "", customEmojiId: "item-gone", count: 2, userIds: ["me"] },
    ] as any[];
    const w = mount(MessageReactions, {
      props: { reactions: custom, currentUserId: "me", canReact: true },
      global: { provide: { [EXPRESSION_RESOLVER as symbol]: resolver } },
    });
    const [, known, unknown] = w.findAll("button");

    expect(known.find(".ce").attributes("data-ce-file")).toBe("file-party");
    expect(known.text()).toContain("3");
    expect(unknown.find('[data-testid="reaction-unknown"]').exists()).toBe(true);
    expect(unknown.text()).toContain("2");

    await known.trigger("click");
    await unknown.trigger("click");
    expect(w.emitted("toggle-custom")).toEqual([["item-party"], ["item-gone"]]);
    expect(w.emitted("toggle")).toBeUndefined();
  });
});

describe("where a custom reaction comes from", () => {
  const party = { itemId: "item-party", packId: "p-fun", spaceId: "s-cats", kind: 1, name: "party", fileId: "file-party", format: 0, width: 64, height: 64, textColor: false } as any;
  const resolver = {
    ...noopResolver,
    itemById: (id: string) => (id === "item-party" ? party : null),
    packOf: () => ({ packId: "p-fun", spaceId: "s-cats", kind: 1, title: "Fun" }) as any,
  };
  const custom = [
    { emoji: "👍", customEmojiId: null, count: 1, userIds: ["you"] },
    { emoji: ":party:", customEmojiId: "item-party", count: 3, userIds: ["you"] },
    { emoji: ":gone:", customEmojiId: "item-gone", count: 2, userIds: ["me"] },
  ] as any[];

  const popover = () => document.body.querySelector<HTMLElement>('[data-testid="expression-info"]');
  async function settle() {
    for (let i = 0; i < 5; i++) {
      await nextTick();
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  function mountRow() {
    return mount(MessageReactions, {
      attachTo: document.body,
      props: { reactions: custom, currentUserId: "me", canReact: true },
      global: { provide: { [EXPRESSION_RESOLVER as symbol]: resolver } },
    });
  }

  test("right-click opens it (name, pack, space) without toggling; a click still toggles", async () => {
    const w = mountRow();
    const [plain, known] = w.findAll("button");
    expect(known.attributes("title")).toBe(":party:");

    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    known.element.dispatchEvent(menu);
    await settle();
    expect(menu.defaultPrevented).toBe(true);
    expect(popover()?.querySelector('[data-testid="expression-info-label"]')?.textContent).toBe(":party:");
    expect(popover()?.querySelector('[data-testid="expression-info-pack"]')?.textContent).toContain("Fun");
    expect(popover()?.querySelector('[data-testid="expression-info-space-name"]')?.textContent).toBe("Cats");
    expect(w.emitted("toggle-custom")).toBeUndefined();

    // A plain emoji's right-click is left alone.
    const plainMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    plain.element.dispatchEvent(plainMenu);
    expect(plainMenu.defaultPrevented).toBe(false);

    await known.trigger("click");
    expect(w.emitted("toggle-custom")).toEqual([["item-party"]]);
    w.unmount();
  });

  test("an emoji this client does not know: the name from the reaction, from another space", async () => {
    const w = mountRow();
    const unknown = w.findAll("button")[2];
    expect(unknown.attributes("title")).toBe(":gone:");
    unknown.element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await settle();
    expect(popover()?.querySelector('[data-testid="expression-info-label"]')?.textContent).toBe(":gone:");
    expect(popover()?.querySelector('[data-testid="expression-info-other-space"]')).not.toBeNull();
    w.unmount();
  });

  test("a long press on touch opens it and the click that ends it does not toggle", async () => {
    vi.useFakeTimers();
    try {
      const w = mountRow();
      const known = w.findAll("button")[1];
      known.element.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", clientX: 10, clientY: 10, bubbles: true }));
      await vi.advanceTimersByTimeAsync(600);
      known.element.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }));
      await known.trigger("click");
      expect(w.emitted("toggle-custom")).toBeUndefined();
      vi.useRealTimers();
      await settle();
      expect(popover()?.querySelector('[data-testid="expression-info-label"]')?.textContent).toBe(":party:");

      // A tap is still a toggle.
      known.element.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
      known.element.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }));
      await known.trigger("click");
      expect(w.emitted("toggle-custom")).toEqual([["item-party"]]);
      w.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
