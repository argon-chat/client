import "./emojiText.css";
import { h, type FunctionalComponent, type VNodeArrayChildren } from "vue";
import { spriteResolver, type EmojiEntry, type RelativeSpriteStyle } from "@argon-chat/emojix";
import { splitEmojiText } from "@/lib/chat/emojiText";

/**
 * Plain message text with its unicode emoji drawn from the sprite atlas. Each emoji is a span that
 * still holds the emoji's characters (transparent, clipped to the box), so selecting, copying and
 * screen readers get the text as sent; runs of text between them stay single text nodes.
 *
 * Sized in em (1.25em, see emojiText.css), so it follows the font; a big-emoji message sets
 * `--emoji-size` to its size.
 */

const styles = new Map<string, RelativeSpriteStyle | null>();

function styleOf(entry: EmojiEntry): RelativeSpriteStyle | null {
  let style = styles.get(entry.id);
  if (style === undefined) {
    style = spriteResolver.getRelativeStyle(entry);
    styles.set(entry.id, style);
  }
  return style;
}

const EmojiText: FunctionalComponent<{ text: string }> = (props) => {
  const pieces = splitEmojiText(props.text);
  if (pieces.length < 2 && !pieces[0]?.emoji) return props.text;
  const out: VNodeArrayChildren = [];
  for (const piece of pieces) {
    const style = piece.emoji ? styleOf(piece.emoji) : null;
    if (style) out.push(h("span", { class: "msg-emoji", style }, piece.text));
    else if (typeof out[out.length - 1] === "string") out[out.length - 1] += piece.text;
    else out.push(piece.text);
  }
  return out;
};

EmojiText.props = ["text"];
EmojiText.displayName = "EmojiText";

export default EmojiText;
