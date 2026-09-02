import { describe, expect, it } from "vitest";
import { EntityType } from "@argon/glue";
import { parseMessageContent } from "@/lib/chat/parseMessageContent";

/** Compact view of an entity list: [type, offset, length]. */
const shape = (text: string) =>
  parseMessageContent(text).entities.map((e) => [e.type, e.offset, e.length] as const);

describe("parseMessageContent", () => {
  it("turns markers into entities over the cleaned text", () => {
    const parsed = parseMessageContent("say **hi** to #argon");
    expect(parsed.text).toBe("say hi to #argon");
    expect(shape("say **hi** to #argon")).toEqual([
      [EntityType.Bold, 4, 2],
      [EntityType.Hashtag, 10, 6],
    ]);
  });

  it("keeps a link whole when a fraction or hashtag sits inside it", () => {
    const parsed = parseMessageContent("see https://argon.gl/a/1/2#top");
    expect(parsed.text).toBe("see https://argon.gl/a/1/2#top");
    expect(parsed.entities.map((e) => e.type)).toEqual([EntityType.Url]);
  });

  describe("a link inside a styled span keeps both: the style is split around the link", () => {
    it("bold", () => {
      const parsed = parseMessageContent("**see https://argon.gl now**");
      expect(parsed.text).toBe("see https://argon.gl now");
      expect(shape("**see https://argon.gl now**")).toEqual([
        [EntityType.Bold, 0, 4],
        [EntityType.Url, 4, 16],
        [EntityType.Bold, 20, 4],
      ]);
    });

    it("italic, with the link filling the whole span", () => {
      const parsed = parseMessageContent("__https://argon.gl__");
      expect(parsed.text).toBe("https://argon.gl");
      expect(shape("__https://argon.gl__")).toEqual([[EntityType.Url, 0, 16]]);
    });

    it("underline", () => {
      const raw = "<red-500:go to argon.gl/x>";
      const parsed = parseMessageContent(raw);
      expect(parsed.text).toBe("go to argon.gl/x");
      expect(shape(raw)).toEqual([
        [EntityType.Underline, 0, 6],
        [EntityType.Url, 6, 10],
      ]);
    });

    it("strikethrough, with two links", () => {
      const raw = "~~old argon.gl/a or argon.gl/b~~";
      const parsed = parseMessageContent(raw);
      expect(parsed.text).toBe("old argon.gl/a or argon.gl/b");
      expect(shape(raw)).toEqual([
        [EntityType.Strikethrough, 0, 4],
        [EntityType.Url, 4, 10],
        [EntityType.Strikethrough, 14, 4],
        [EntityType.Url, 18, 10],
      ]);
    });

    it("spoiler hides the link instead: nothing inside a spoiler may be live before it is revealed", () => {
      const parsed = parseMessageContent("||secret https://argon.gl||");
      expect(parsed.text).toBe("secret https://argon.gl");
      expect(shape("||secret https://argon.gl||")).toEqual([[EntityType.Spoiler, 0, 23]]);
    });

    it("the link keeps its domain and path", () => {
      const [, url] = parseMessageContent("**see https://argon.gl/docs?x=1**").entities as any[];
      expect(url.type).toBe(EntityType.Url);
      expect(url.domain).toBe("argon.gl");
      expect(url.path).toBe("/docs?x=1");
    });
  });

  it("resolves mentions from the registry", () => {
    const parsed = parseMessageContent("hey @yuuki look", new Map([["@yuuki", "u-1"]]));
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0]).toMatchObject({ type: EntityType.Mention, offset: 4, length: 6, userId: "u-1" });
  });
});
