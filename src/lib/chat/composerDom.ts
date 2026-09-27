import { EntityType, MessageEntityCustomEmoji } from "@argon/glue";
import { customEmojiAlt, validCustomEmoji } from "@/lib/chat/customEmoji";

/**
 * The composer's contenteditable and the text it stands for (Telegram's getRichElementValue, cut
 * down). The text is what the parser sees: characters as typed, `\n` for a line break, a unicode
 * emoji drawn from the sprite atlas as its own characters, a custom emoji as `:name:` plus a
 * MessageEntityCustomEmoji over exactly that range. Offsets are UTF-16 code units.
 *
 * Emoji are atoms: non-editable inline elements the text never looks inside (the overlay adds its
 * own children to a custom emoji's placeholder). Everything they need to become text again sits
 * in data attributes, so a node the browser rebuilt (undo, a paste) reads the same.
 */

export const CUSTOM_EMOJI_ATTR = "data-ce-item";
export const EMOJI_ATTR = "data-emoji";

/** A caret-anchor some editors leave behind; never part of the text. */
const BOM = /\uFEFF/g;
const BLOCK_TAGS = new Set(["DIV", "P", "LI"]);

export interface ComposerValue {
  text: string;
  entities: MessageEntityCustomEmoji[];
}

export interface DomPoint {
  node: Node;
  offset: number;
}

type RunKind = "text" | "atom" | "br" | "open" | "close";

interface Run {
  kind: RunKind;
  node: Node;
  start: number;
  text: string;
}

const isElement = (node: Node): node is HTMLElement => node.nodeType === 1;
const isText = (node: Node): node is Text => node.nodeType === 3;

export function isAtom(node: Node | null | undefined): boolean {
  return !!node && isElement(node) && (node.hasAttribute(CUSTOM_EMOJI_ATTR) || node.hasAttribute(EMOJI_ATTR));
}

export function isCustomEmojiAtom(node: Node | null | undefined): node is HTMLElement {
  return !!node && isElement(node) && node.hasAttribute(CUSTOM_EMOJI_ATTR);
}

function atomText(el: HTMLElement): string {
  return el.hasAttribute(CUSTOM_EMOJI_ATTR) ? customEmojiAlt(el.dataset.ceName ?? "") : (el.getAttribute(EMOJI_ATTR) ?? "");
}

function atomEntity(el: HTMLElement, offset: number): MessageEntityCustomEmoji {
  const name = el.dataset.ceName ?? "";
  return new MessageEntityCustomEmoji(
    EntityType.CustomEmoji,
    offset,
    customEmojiAlt(name).length,
    1,
    el.getAttribute(CUSTOM_EMOJI_ATTR) ?? "",
    el.dataset.ceSpace ?? "",
    Number(el.dataset.ceFormat ?? 0),
    el.dataset.ceFile ?? "",
    name,
    el.hasAttribute("data-ce-text-color"),
    null,
  );
}

function collectRuns(root: Node): Run[] {
  const runs: Run[] = [];
  let pos = 0;
  let last = "";
  const push = (kind: RunKind, node: Node, text: string) => {
    runs.push({ kind, node, start: pos, text });
    pos += text.length;
    if (text) last = text[text.length - 1];
  };
  const visit = (node: Node) => {
    if (isText(node)) return push("text", node, node.data.replace(BOM, ""));
    if (!isElement(node)) return;
    if (isAtom(node)) return push("atom", node, atomText(node as HTMLElement));
    if (node.tagName === "BR") return push("br", node, "\n");
    const block = BLOCK_TAGS.has(node.tagName);
    // A block is a line of its own: a break before it unless one is there, and one after it.
    if (block) push("open", node, pos > 0 && last !== "\n" ? "\n" : "");
    node.childNodes.forEach(visit);
    if (block) push("close", node, last !== "\n" ? "\n" : "");
  };
  root.childNodes.forEach(visit);
  return runs;
}

/** The text and custom emoji entities a subtree stands for. Trailing line breaks are dropped. */
export function readComposer(root: Node): ComposerValue {
  const runs = collectRuns(root);
  const text = runs.map((r) => r.text).join("").replace(/\n+$/, "");
  const entities: MessageEntityCustomEmoji[] = [];
  for (const run of runs) {
    if (run.kind === "atom" && isCustomEmojiAtom(run.node) && run.start + run.text.length <= text.length) {
      entities.push(atomEntity(run.node, run.start));
    }
  }
  return { text, entities };
}

function indexInParent(node: Node): number {
  let i = 0;
  for (let n = node.previousSibling; n; n = n.previousSibling) i++;
  return i;
}

const before = (node: Node): DomPoint => ({ node: node.parentNode!, offset: indexInParent(node) });
const after = (node: Node): DomPoint => ({ node: node.parentNode!, offset: indexInParent(node) + 1 });

/** Where a run starts, as a boundary point the caret can be compared with. */
function runBoundary(run: Run): DomPoint {
  if (run.kind === "text") return { node: run.node, offset: 0 };
  if (run.kind === "close") return { node: run.node, offset: run.node.childNodes.length };
  return before(run.node);
}

/** Text offset of a DOM point inside `root` (a caret, a selection end). */
export function offsetAt(root: Node, point: DomPoint): number {
  const runs = collectRuns(root);
  const total = runs.reduce((n, r) => n + r.text.length, 0);
  const { node, offset } = point;

  if (isText(node)) {
    const run = runs.find((r) => r.node === node);
    if (run) return run.start + node.data.slice(0, offset).replace(BOM, "").length;
  }
  const atom = runs.find((r) => r.kind === "atom" && r.node !== node && r.node.contains(node));
  if (atom) return atom.start + atom.text.length;

  const doc = root.ownerDocument ?? document;
  const caret = doc.createRange();
  try {
    caret.setStart(node, offset);
  } catch {
    return total;
  }
  for (const run of runs) {
    const b = runBoundary(run);
    // The first run that starts at or after the caret: the caret sits at its start.
    if (caret.comparePoint(b.node, b.offset) >= 0) return run.start;
  }
  return total;
}

/** The DOM point at a text offset. Inside an emoji's text it lands after the emoji. */
export function pointAt(root: Node, target: number): DomPoint {
  const runs = collectRuns(root);
  for (const run of runs) {
    const end = run.start + run.text.length;
    switch (run.kind) {
      case "text":
        if (target <= end) {
          const data = (run.node as Text).data;
          let want = target - run.start;
          let i = 0;
          while (i < data.length && (want > 0 || data[i] === "\uFEFF")) {
            if (data[i] !== "\uFEFF") want--;
            i++;
          }
          return { node: run.node, offset: i };
        }
        break;
      case "atom":
      case "br":
        if (target <= run.start) return before(run.node);
        if (target < end) return after(run.node);
        break;
      case "open":
        if (target <= run.start && run.text) return before(run.node);
        if (target <= run.start) return { node: run.node, offset: 0 };
        break;
      case "close":
        if (target <= run.start) return { node: run.node, offset: run.node.childNodes.length };
        break;
    }
  }
  return { node: root, offset: root.childNodes.length };
}

/**
 * The emoji right before (or after) a collapsed caret, if that is what a Backspace (or Delete)
 * would hit. Empty text nodes and caret anchors in between are skipped.
 */
export function adjacentAtom(root: Node, point: DomPoint, backward: boolean): HTMLElement | null {
  let { node } = point;
  const { offset } = point;
  let candidate: Node | null;

  if (isText(node)) {
    const side = backward ? node.data.slice(0, offset) : node.data.slice(offset);
    if (side.replace(BOM, "").length) return null;
    candidate = backward ? node.previousSibling : node.nextSibling;
  } else {
    candidate = backward ? node.childNodes[offset - 1] ?? null : node.childNodes[offset] ?? null;
  }

  for (let guard = 0; guard < 64; guard++) {
    if (!candidate) {
      // Out of this element: its sibling, unless it is the editor itself.
      if (node === root || !node.parentNode) return null;
      candidate = backward ? node.previousSibling : node.nextSibling;
      node = node.parentNode;
      continue;
    }
    if (isAtom(candidate)) return candidate as HTMLElement;
    if (isText(candidate)) {
      if (candidate.data.replace(BOM, "").length) return null;
      node = candidate;
      candidate = backward ? candidate.previousSibling : candidate.nextSibling;
      continue;
    }
    if (isElement(candidate) && candidate.tagName !== "BR" && !BLOCK_TAGS.has(candidate.tagName) && candidate.firstChild) {
      node = candidate;
      candidate = backward ? candidate.lastChild : candidate.firstChild;
      continue;
    }
    return null;
  }
  return null;
}

// Same emoji grammar as emojix's parser (see parseEmojiString), without its normalising pass: the
// characters in the editor must stay the characters in the text.
const EMOJI_REGEX = new RegExp(
  [
    "[\u{1F1E6}-\u{1F1FF}]{2}",
    "\u{1F3F4}[\u{E0060}-\u{E007F}]+\u{E007F}",
    "[\u{0023}\u{002A}\u{0030}-\u{0039}]\uFE0F?\u20E3",
    "\\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}]?\uFE0F?(?:\u200D\\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}]?\uFE0F?)+",
    "\\p{Emoji_Presentation}[\u{1F3FB}-\u{1F3FF}]?\uFE0F?",
    "\\p{Extended_Pictographic}\uFE0F",
  ].join("|"),
  "gu",
);

export interface TextPiece {
  emoji: boolean;
  text: string;
}

/** `text` cut into runs of plain text and single emoji. */
export function splitEmoji(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(EMOJI_REGEX)) {
    if (match.index! > last) pieces.push({ emoji: false, text: text.slice(last, match.index) });
    pieces.push({ emoji: true, text: match[0] });
    last = match.index! + match[0].length;
  }
  if (last < text.length) pieces.push({ emoji: false, text: text.slice(last) });
  return pieces;
}

export interface ComposerNodes {
  /** A custom emoji's placeholder (an atom). */
  customEmoji(entity: MessageEntityCustomEmoji): HTMLElement;
  /** A unicode emoji: an atom drawn from the atlas, or a plain text node when it can't be. */
  emoji(text: string): Node;
}

/** DOM for plain text: `\n` as `<br>`, unicode emoji through `nodes.emoji`. */
export function textNodes(doc: Document, text: string, nodes: Pick<ComposerNodes, "emoji">): Node[] {
  const out: Node[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) out.push(doc.createElement("br"));
    for (const piece of splitEmoji(line)) {
      out.push(piece.emoji ? nodes.emoji(piece.text) : doc.createTextNode(piece.text));
    }
  });
  return out;
}

/**
 * DOM for a value: text, sprites for unicode emoji, placeholders for custom emoji. A whole editor's
 * worth (`trailingBreak`) gets the extra `<br>` a line break at its very end needs to show.
 */
export function composerFragment(
  doc: Document,
  value: ComposerValue,
  nodes: ComposerNodes,
  trailingBreak = true,
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  for (const entity of validCustomEmoji(value.text, value.entities)) {
    fragment.append(...textNodes(doc, value.text.slice(cursor, entity.offset), nodes));
    fragment.append(nodes.customEmoji(entity));
    cursor = entity.offset + entity.length;
  }
  fragment.append(...textNodes(doc, value.text.slice(cursor), nodes));
  if (trailingBreak && value.text.endsWith("\n")) fragment.append(doc.createElement("br"));
  return fragment;
}
