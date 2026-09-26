/**
 * Reaction pills. In an announcement channel with reactions off nobody adds one, but a reader can
 * still take back their own: those pills stay clickable, the rest do not.
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
  };
});

import MessageReactions from "@/components/chats/MessageReactions.vue";

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
});
