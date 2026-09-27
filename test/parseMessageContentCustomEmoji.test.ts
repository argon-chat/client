/**
 * Custom emoji through the parser: the composer hands over `:name:` text with entities already on
 * it; markers are parsed around them and the two are merged. A custom emoji is atomic — nothing
 * cuts into it — and may sit inside one style entity (bold, italic, underline, strikethrough,
 * spoiler, capitalized), which keeps both: the emoji entity nested in the style entity. Code
 * swallows it. The reverse (for edits and drafts) puts the emoji back on the raw text.
 */

import { describe, expect, it } from "vitest";
import { EntityType, MessageEntityCustomEmoji, type IMessageEntity } from "@argon/glue";
import { parseMessageContent, serializeMessageContent } from "@/lib/chat/parseMessageContent";
import { MAX_CUSTOM_EMOJI_PER_MESSAGE } from "@/lib/chat/customEmoji";

const emoji = (name: string, offset: number) =>
  new MessageEntityCustomEmoji(EntityType.CustomEmoji, offset, name.length + 2, 1, `item-${name}`, "space", 1, `file-${name}`, name, false, null);

const shape = (entities: IMessageEntity[]) => entities.map((e) => [e.type, e.offset, e.length] as const);

function parse(raw: string, customEmoji: MessageEntityCustomEmoji[], mentions = new Map<string, string>()) {
  return parseMessageContent(raw, mentions, { customEmoji });
}

describe("parseMessageContent with custom emoji", () => {
  it("keeps a placed emoji where it is", () => {
    const parsed = parse("hi :wave: there", [emoji("wave", 3)]);
    expect(parsed.text).toBe("hi :wave: there");
    expect(shape(parsed.entities)).toEqual([[EntityType.CustomEmoji, 3, 6]]);
    const [e] = parsed.entities as MessageEntityCustomEmoji[];
    expect([e.itemId, e.spaceId, e.fileId, e.name, e.format]).toEqual(["item-wave", "space", "file-wave", "wave", 1]);
  });

  it("moves it with the trimmed text", () => {
    const parsed = parse("  :wave: ", [emoji("wave", 2)]);
    expect(parsed.text).toBe(":wave:");
    expect(shape(parsed.entities)).toEqual([[EntityType.CustomEmoji, 0, 6]]);
  });

  it("inside bold: both kept, the emoji nested in the bold span, markers gone", () => {
    const parsed = parse("**hi :wave:**", [emoji("wave", 5)]);
    expect(parsed.text).toBe("hi :wave:");
    expect(shape(parsed.entities)).toEqual([
      [EntityType.Bold, 0, 9],
      [EntityType.CustomEmoji, 3, 6],
    ]);
  });

  it("inside a spoiler too", () => {
    const parsed = parse("||:wave: secret||", [emoji("wave", 2)]);
    expect(parsed.text).toBe(":wave: secret");
    expect(shape(parsed.entities)).toEqual([
      [EntityType.Spoiler, 0, 13],
      [EntityType.CustomEmoji, 0, 6],
    ]);
  });

  it("a marker inside a name is not a marker", () => {
    const parsed = parse(":a__b: __hi__", [emoji("a__b", 0)]);
    expect(parsed.text).toBe(":a__b: hi");
    expect(shape(parsed.entities)).toEqual([
      [EntityType.CustomEmoji, 0, 6],
      [EntityType.Italic, 7, 2],
    ]);
  });

  it("a style that would end inside an emoji is not one", () => {
    const parsed = parse("**a :b**c:", [emoji("b**c", 4)]);
    expect(parsed.text).toBe("**a :b**c:");
    expect(shape(parsed.entities)).toEqual([[EntityType.CustomEmoji, 4, 6]]);
  });

  it("code swallows the emoji: its :name: stays text", () => {
    const parsed = parse("`x :wave:`", [emoji("wave", 3)]);
    expect(parsed.text).toBe("x :wave:");
    expect(shape(parsed.entities)).toEqual([[EntityType.Monospace, 0, 8]]);
  });

  it("a link ends where an emoji starts", () => {
    const parsed = parse("argon.gl/x:wave:", [emoji("wave", 10)]);
    expect(parsed.text).toBe("argon.gl/x:wave:");
    const types = parsed.entities.map((e) => e.type);
    expect(types).toContain(EntityType.CustomEmoji);
    const url = parsed.entities.find((e) => e.type === EntityType.Url)!;
    expect(url.offset + url.length).toBeLessThanOrEqual(10);
  });

  it("a mention beside an emoji", () => {
    const parsed = parse("@Alice :wave:", [emoji("wave", 7)], new Map([["@Alice", "u1"]]));
    expect(shape(parsed.entities)).toEqual([
      [EntityType.Mention, 0, 6],
      [EntityType.CustomEmoji, 7, 6],
    ]);
  });

  it("an entity that is not over its :name: is ignored", () => {
    const parsed = parse("hi :wave:", [emoji("wave", 2)]);
    expect(parsed.entities).toEqual([]);
  });

  it(`keeps at most ${MAX_CUSTOM_EMOJI_PER_MESSAGE}`, () => {
    const count = MAX_CUSTOM_EMOJI_PER_MESSAGE + 3;
    const raw = ":a1:".repeat(count);
    const parsed = parse(raw, Array.from({ length: count }, (_, i) => emoji("a1", i * 4)));
    expect(parsed.entities).toHaveLength(MAX_CUSTOM_EMOJI_PER_MESSAGE);
    expect(parsed.text).toBe(raw);
  });

  it("without custom emoji nothing changes", () => {
    expect(shape(parse("say **hi** to #argon", []).entities)).toEqual([
      [EntityType.Bold, 4, 2],
      [EntityType.Hashtag, 10, 6],
    ]);
  });
});

describe("serializeMessageContent with custom emoji (edit and draft)", () => {
  function roundTrip(raw: string, customEmoji: MessageEntityCustomEmoji[], mentions = new Map<string, string>()) {
    const sent = parse(raw, customEmoji, mentions);
    const back = serializeMessageContent(sent.text, sent.entities);
    const again = parse(back.raw, back.customEmoji, back.mentions);
    expect(again.text).toBe(sent.text);
    expect(shape(again.entities)).toEqual(shape(sent.entities));
    return back;
  }

  it("the emoji comes back on the raw text, markers and all", () => {
    const back = roundTrip("**hi :wave:** and :cat:", [emoji("wave", 5), emoji("cat", 18)]);
    expect(back.raw).toBe("**hi :wave:** and :cat:");
    expect(back.customEmoji.map((e) => [e.name, e.offset])).toEqual([["wave", 5], ["cat", 18]]);
  });

  it("with a mention and a link", () => {
    roundTrip("@Alice :wave: see argon.gl", [emoji("wave", 7)], new Map([["@Alice", "u1"]]));
  });

  it("at the start and the end, side by side", () => {
    const back = roundTrip(":a1::b2: mid :c3:", [emoji("a1", 0), emoji("b2", 4), emoji("c3", 13)]);
    expect(back.customEmoji.map((e) => e.offset)).toEqual([0, 4, 13]);
  });

  it("an entity that does not sit on its :name: stays text", () => {
    const back = serializeMessageContent("hi :wave:", [emoji("wave", 2)]);
    expect(back.customEmoji).toEqual([]);
  });
});
