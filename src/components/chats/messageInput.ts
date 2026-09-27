import { h, render } from "vue";
import { emojiRegistry, spriteResolver, type EmojiEntry } from "@argon-chat/emojix";
import type { ExpressionItem, MessageEntityCustomEmoji } from "@argon/glue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import type { ExpressionMedia } from "@/lib/expressions/types";
import { CUSTOM_EMOJI_ATTR, EMOJI_ATTR, type ComposerValue } from "@/lib/chat/composerDom";
import { customEmojiAlt, customEmojiEntity } from "@/lib/chat/customEmoji";

export interface TextRange {
  start: number;
  end: number;
}

/** What MessageInput exposes. Offsets are into the plain text (see composerDom). */
export interface MessageInputApi {
  /** A registry entry, or an emoji as text (a skin-toned one from the picker). */
  insertEmoji(emoji: EmojiEntry | string, replace?: TextRange): void;
  /** False when the message already holds the most custom emoji it may. */
  insertCustomEmoji(item: ExpressionItem, replace?: TextRange): boolean;
  insertTextAtCursor(text: string): void;
  replaceRange(start: number, end: number, replacement: string): void;
  getCursorOffset(): number;
  setCursorOffset(offset: number): void;
  getTextBeforeCursor(): string;
  getText(): string;
  getValue(): ComposerValue;
  setValue(value: ComposerValue): void;
  focus(): void;
  blur(): void;
  clear(): void;
  el: HTMLDivElement | null;
}

/** A copy out of the composer carries its custom emoji under this type, for a paste back into one. */
export const RICH_CLIPBOARD_TYPE = "application/x-argon-composer";

/** The registry entry for an emoji as typed, with or without the VS16 the data happens to carry. */
function entryFor(emoji: string): EmojiEntry | undefined {
  const hexes = [...emoji].map((c) => c.codePointAt(0)!.toString(16));
  const bare = hexes.filter((x) => x !== "fe0f");
  for (const key of [hexes.join("-"), bare.join("-"), `${bare.join("-")}-fe0f`]) {
    const entry = emojiRegistry.getByHexcode(key);
    if (entry) return entry;
  }
  return undefined;
}

/** A unicode emoji drawn from the sprite atlas, or its characters when the atlas can't draw it. */
export function emojiNode(doc: Document, text: string, size: number, entry = entryFor(text)): Node {
  const style = entry ? spriteResolver.getStyle(entry, size) : null;
  if (!entry || !style) return doc.createTextNode(text);
  const span = doc.createElement("span");
  span.className = "emojix-inline-emoji emojix-inline-sprite";
  for (const [key, value] of Object.entries(style)) {
    span.style.setProperty(key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), String(value));
  }
  span.setAttribute(EMOJI_ATTR, text);
  span.setAttribute("contenteditable", "false");
  span.title = entry.name;
  return span;
}

/** A custom emoji's placeholder: CustomEmojiInline's markup, plus what turns it back into text. */
export function customEmojiNode(entity: MessageEntityCustomEmoji, media: ExpressionMedia): HTMLElement {
  const host = document.createElement("div");
  render(h(CustomEmojiInline, { media, alt: customEmojiAlt(entity.name) }), host);
  const el = host.firstElementChild!.cloneNode(true) as HTMLElement;
  render(null, host);
  el.setAttribute("contenteditable", "false");
  el.setAttribute("draggable", "false");
  el.setAttribute(CUSTOM_EMOJI_ATTR, entity.itemId);
  el.dataset.ceSpace = entity.spaceId;
  el.dataset.ceName = entity.name;
  el.title = customEmojiAlt(entity.name);
  return el;
}

/** The composer value in a clipboard payload, if it is one and holds sane entities. */
export function readRichClipboard(json: string | null | undefined): ComposerValue | null {
  if (!json) return null;
  try {
    const data = JSON.parse(json) as { text?: unknown; entities?: unknown };
    if (typeof data.text !== "string" || !Array.isArray(data.entities)) return null;
    const entities = data.entities
      .filter(
        (e): e is MessageEntityCustomEmoji =>
          !!e &&
          typeof e.offset === "number" &&
          typeof e.itemId === "string" &&
          typeof e.fileId === "string" &&
          typeof e.name === "string",
      )
      .map((e) => customEmojiEntity({ ...e, textColor: !!e.textColor, downloadUrl: null }, e.offset));
    return { text: data.text, entities };
  } catch {
    return null;
  }
}
