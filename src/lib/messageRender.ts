import type { JSONContent } from "@tiptap/vue-3";

export function tiptapToArgonMessage(json: JSONContent): {
  entities: IMessageEntity[];
  text: string;
} {
  let text = "";
  const entities: IMessageEntity[] = [];
  let offset = 0;

  function traverse(node: JSONContent) {
    if (node.text) {
      const startOffset = offset;
      text += node.text;

      if (node.marks) {
        for (const mark of node.marks) {
          entities.push({
            Type: convertMarkToEntityType(mark.type),
            Offset: startOffset,
            Length: node.text.length,
            UrlMask: mark.attrs?.href ?? undefined,
          });
        }
      }

      offset += node.text.length;
    }

    if (node.content) {
      node.content.forEach(traverse);
    }
  }

  traverse(json);

  return { entities, text };
}

enum EntityType {
  Hashtag = "Hashtag",
  Mention = "Mention",
  Email = "Email",
  Url = "Url",
  Monospace = "Monospace",
  Quote = "Quote",
  Spoiler = "Spoiler",
  Strikethrough = "Strikethrough",
  Bold = "Bold",
  Italic = "Italic",
  Underline = "Underline",
}
function convertMarkToEntityType(mark: string): EntityType {
  const map: Record<string, EntityType> = {
    bold: EntityType.Bold,
    italic: EntityType.Italic,
    underline: EntityType.Underline,
    strike: EntityType.Strikethrough,
    link: EntityType.Url,
    code: EntityType.Monospace,
    blockquote: EntityType.Quote,
    spoiler: EntityType.Spoiler,
  };
  return map[mark] || EntityType.Url;
}
