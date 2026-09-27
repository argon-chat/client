/**
 * The fragmenter with stickers and custom emoji. A sticker is block media, drawn apart from the
 * text. A custom emoji is an inline fragment of its own; inside a style entity it becomes one of the
 * style fragment's children (drawn in the style's segment), and under any other entity — a mention,
 * a link, code — or across an entity's edge it is dropped and its `:name:` reads as text.
 */

import { describe, expect, test, vi } from "vitest";

vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({}) }));

import {
  EntityType,
  MessageEntityBold,
  MessageEntityCustomEmoji,
  MessageEntityMention,
  MessageEntityMonospace,
  MessageEntitySticker,
  type IMessageEntity,
} from "@argon/glue";
import { fragmentMessageText, type IFrag } from "@/composables/useMessageContent";

const emoji = (name: string, offset: number) =>
  new MessageEntityCustomEmoji(EntityType.CustomEmoji, offset, name.length + 2, 1, `item-${name}`, "space", 0, "file", name, false, null);

const sticker = () =>
  new MessageEntitySticker(EntityType.Sticker, 0, 0, 1, "item", "pack", "space", 1, "file", null, 512, 512, null, null, null);

/** [text, entity type or null, children] — compact enough to read. */
const view = (frags: IFrag[]): unknown[] =>
  frags.map((f) => (f.children ? [f.text, f.entity?.type ?? null, view(f.children)] : [f.text, f.entity?.type ?? null]));

const frag = (text: string, entities: IMessageEntity[]) => view(fragmentMessageText(text, entities));

describe("fragmentMessageText with expressions", () => {
  test("a sticker is not text", () => {
    expect(frag("", [sticker()])).toEqual([]);
    expect(frag("caption", [sticker()])).toEqual([["caption", null]]);
  });

  test("a custom emoji is its own inline fragment", () => {
    expect(frag("hi :wave: there", [emoji("wave", 3)])).toEqual([
      ["hi ", null],
      [":wave:", EntityType.CustomEmoji],
      [" there", null],
    ]);
    expect(frag(":a1::b2:", [emoji("b2", 4), emoji("a1", 0)])).toEqual([
      [":a1:", EntityType.CustomEmoji],
      [":b2:", EntityType.CustomEmoji],
    ]);
  });

  test("inside bold it is a child of the bold fragment", () => {
    const text = "hi :wave: yo";
    expect(frag(text, [new MessageEntityBold(EntityType.Bold, 0, 12, 1), emoji("wave", 3)])).toEqual([
      [text, EntityType.Bold, [["hi ", null], [":wave:", EntityType.CustomEmoji], [" yo", null]]],
    ]);
  });

  test("a style beside it is left alone", () => {
    expect(frag("**:wave: b", [new MessageEntityBold(EntityType.Bold, 9, 1, 1), emoji("wave", 2)])).toEqual([
      ["**", null],
      [":wave:", EntityType.CustomEmoji],
      [" ", null],
      ["b", EntityType.Bold],
    ]);
  });

  test("under a mention or in code, or across an entity's edge, the :name: stays text", () => {
    expect(frag("@a :x:", [new MessageEntityMention(EntityType.Mention, 0, 6, 1, "u1"), emoji("x", 3)])).toEqual([
      ["@a :x:", EntityType.Mention],
    ]);
    expect(frag("c :x:", [new MessageEntityMonospace(EntityType.Monospace, 0, 5, 1), emoji("x", 2)])).toEqual([
      ["c :x:", EntityType.Monospace],
    ]);
    expect(frag("ab :x:", [new MessageEntityBold(EntityType.Bold, 0, 4, 1), emoji("x", 3)])).toEqual([
      ["ab :", EntityType.Bold],
      ["x:", null],
    ]);
  });

  test("an entity out of range is ignored", () => {
    expect(frag(":x:", [emoji("x", 2)])).toEqual([[":x:", null]]);
  });
});
