<script setup lang="ts">
/**
 * The composer's input, Telegram-style: a contenteditable whose value is plain text (what the
 * parser reads) plus the custom emoji placed in it. Unicode emoji are atlas sprites inside the
 * editor and their own characters in the text; a custom emoji is a non-editable placeholder that
 * reads as `:name:` with a MessageEntityCustomEmoji over it. See composerDom for the mapping.
 *
 * Edits go through the browser's editing commands where it has one (typing, line breaks, deleting
 * an emoji, inserting one), so undo keeps working; the DOM is changed directly only as a fallback
 * or while the editor is not focused. A text set from outside (`v-model`) is applied as the
 * smallest edit that turns the old text into the new one, so the emoji outside it stay put.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { codepointsToString, type EmojiEntry } from "@argon-chat/emojix";
import type { ExpressionItem, MessageEntityCustomEmoji } from "@argon/glue";
import CustomEmojiOverlay from "@/components/expressions/CustomEmojiOverlay.vue";
import { useExpressionResolver } from "@/lib/expressions/resolver";
import {
  adjacentAtom,
  composerFragment,
  CUSTOM_EMOJI_ATTR,
  EMOJI_ATTR,
  offsetAt,
  pointAt,
  readComposer,
  textNodes,
  type ComposerNodes,
  type ComposerValue,
} from "@/lib/chat/composerDom";
import {
  carryCustomEmoji,
  customEmojiEntity,
  customEmojiFromItem,
  customEmojiMedia,
  MAX_CUSTOM_EMOJI_PER_MESSAGE,
  validCustomEmoji,
} from "@/lib/chat/customEmoji";
import {
  customEmojiNode,
  emojiNode,
  readRichClipboard,
  RICH_CLIPBOARD_TYPE,
  type MessageInputApi,
  type TextRange,
} from "./messageInput";

const props = withDefaults(
  defineProps<{
    /** v-model: the plain text. */
    modelValue?: string;
    placeholder?: string;
    /** Size of unicode sprites in the editor, px. */
    emojiSize?: number;
    /** Code points; longer input is cut. */
    maxLength?: number;
    disabled?: boolean;
    autofocus?: boolean;
    /** Enter submits instead of breaking the line. */
    singleLine?: boolean;
  }>(),
  { modelValue: "", placeholder: "", emojiSize: 20, disabled: false, autofocus: false, singleLine: false },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  /** The custom emoji in the text, whenever they change. */
  "update:entities": [entities: MessageEntityCustomEmoji[]];
  submit: [value: string];
  focus: [];
  blur: [];
  keydown: [event: KeyboardEvent];
  /** The user changed the text (typing, a paste, an emoji); not sent for changes from outside. */
  input: [];
  paste: [event: ClipboardEvent];
  /** An insert was refused: the message already holds MAX_CUSTOM_EMOJI_PER_MESSAGE. */
  "custom-emoji-limit": [];
}>();

const editor = ref<HTMLDivElement | null>(null);
const resolver = useExpressionResolver();
const empty = ref(true);

let current: ComposerValue = { text: "", entities: [] };
let composing = false;
let pendingText: string | null = null;
let savedRange: Range | null = null;
/** Inside the component's own edits: the input events they fire are not the user's. */
let quiet = 0;
let insertSeq = 0;

const nodes: ComposerNodes = {
  customEmoji: (entity) => customEmojiNode(entity, customEmojiMedia(entity, resolver.itemById(entity.itemId))),
  emoji: (text) => emojiNode(document, text, props.emojiSize),
};

const showPlaceholder = computed(() => empty.value && !!props.placeholder);

// ── value ──

const sameEntities = (a: MessageEntityCustomEmoji[], b: MessageEntityCustomEmoji[]) =>
  a.length === b.length && a.every((e, i) => e.offset === b[i].offset && e.itemId === b[i].itemId);

/** Reads the editor and tells the parent what changed. */
function sync(userInput: boolean) {
  const root = editor.value;
  if (!root) return;
  const next = readComposer(root);
  const textChanged = next.text !== current.text;
  const entitiesChanged = !sameEntities(next.entities, current.entities);
  current = next;
  empty.value = next.text.length === 0;
  if (textChanged) emit("update:modelValue", next.text);
  if (entitiesChanged) emit("update:entities", next.entities);
  if (userInput) emit("input");
}

function renderValue(value: ComposerValue) {
  editor.value?.replaceChildren(composerFragment(document, value, nodes));
}

function isFocused() {
  const root = editor.value;
  return !!root && !!document.activeElement && root.contains(document.activeElement);
}

// ── selection ──

function select(range: Range) {
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
  savedRange = range.cloneRange();
}

function rangeAt(start: number, end = start): Range {
  const root = editor.value!;
  const a = pointAt(root, start);
  const b = end === start ? a : pointAt(root, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

/** The selection when it is in the editor, else where it last was, else the end. */
function editorRange(): Range {
  const root = editor.value!;
  const sel = window.getSelection();
  if (sel?.rangeCount) {
    const range = sel.getRangeAt(0);
    if (root.contains(range.startContainer) && root.contains(range.endContainer)) return range.cloneRange();
  }
  if (savedRange && root.contains(savedRange.startContainer) && root.contains(savedRange.endContainer)) {
    return savedRange.cloneRange();
  }
  return rangeAt(current.text.length);
}

function caretAfter(node: Node) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  select(range);
}

function onSelectionChange() {
  const root = editor.value;
  const sel = window.getSelection();
  if (!root || !sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (root.contains(range.startContainer) && root.contains(range.endContainer)) savedRange = range.cloneRange();
}

/** Focus without losing the caret: focus() alone may put it at the start. */
function focusEditor() {
  const root = editor.value;
  if (!root || props.disabled) return;
  if (isFocused()) return;
  const keep = editorRange();
  root.focus({ preventScroll: true });
  select(keep);
}

// ── editing ──

function exec(command: string, value?: string): boolean {
  quiet++;
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  } finally {
    quiet--;
  }
}

/** Replaces the text in [start, end) and leaves the caret after it. */
function replaceText(start: number, end: number, text: string) {
  const root = editor.value;
  if (!root) return;
  const range = rangeAt(start, end);
  if (isFocused() && !text.includes("\n")) {
    select(range);
    if (text ? exec("insertText", text) : range.collapsed || exec("delete")) return;
  }
  range.deleteContents();
  const inserted = textNodes(document, text, nodes);
  const fragment = document.createDocumentFragment();
  fragment.append(...inserted);
  range.insertNode(fragment);
  if (isFocused()) {
    if (inserted.length) caretAfter(inserted[inserted.length - 1]);
    else select(range);
  }
}

/** Turns the editor's text into `next` by the smallest edit; re-draws it when that goes wrong. */
function applyText(next: string) {
  const root = editor.value;
  if (!root) return;
  const prev = readComposer(root);
  if (prev.text !== next) {
    const max = Math.min(prev.text.length, next.length);
    let head = 0;
    while (head < max && prev.text.charCodeAt(head) === next.charCodeAt(head)) head++;
    let tail = 0;
    while (tail < max - head && prev.text.charCodeAt(prev.text.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail++;
    replaceText(head, prev.text.length - tail, next.slice(head, next.length - tail));
    // Two edits at once (or one the browser did its own way): draw it again, emoji carried over.
    const expected = carryCustomEmoji(prev.text, next, prev.entities);
    const got = readComposer(root);
    if (got.text !== next || !sameEntities(got.entities, expected)) renderValue({ text: next, entities: expected });
  }
  sync(false);
}

/** Puts nodes where the caret is (or over `replace`), through insertHTML when it can, and the caret after them. */
function insertNodes(list: Node[], replace?: TextRange) {
  const root = editor.value;
  if (!root || props.disabled || !list.length) return;
  focusEditor();
  const range = replace ? rangeAt(replace.start, replace.end) : editorRange();
  select(range);

  const marker = `m${++insertSeq}`;
  const last = list[list.length - 1];
  const html = list
    .map((node) => {
      if (node.nodeType !== 1) return escapeHtml(node.textContent ?? "");
      const el = node as HTMLElement;
      if (node !== last) return el.outerHTML;
      const marked = el.cloneNode(true) as HTMLElement;
      marked.setAttribute("data-ins", marker);
      return marked.outerHTML;
    })
    .join("");

  if (exec("insertHTML", html)) {
    // The browser may drop what it thinks is redundant; the atoms must stay non-editable.
    root.querySelectorAll<HTMLElement>(`[${CUSTOM_EMOJI_ATTR}],[${EMOJI_ATTR}]`).forEach((el) => el.setAttribute("contenteditable", "false"));
    const placed = root.querySelector(`[data-ins="${marker}"]`);
    if (placed) {
      placed.removeAttribute("data-ins");
      caretAfter(placed);
    }
  } else {
    range.deleteContents();
    const fragment = document.createDocumentFragment();
    fragment.append(...list);
    range.insertNode(fragment);
    caretAfter(last);
  }
  sync(true);
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function insertLineBreak() {
  if (!exec("insertLineBreak")) {
    const root = editor.value!;
    const range = editorRange();
    range.deleteContents();
    const br = document.createElement("br");
    range.insertNode(br);
    // A break at the very end shows only with another after it.
    if (!br.nextSibling) br.after(document.createElement("br"));
    caretAfter(br);
    root.normalize();
  }
  sync(true);
}

/** Backspace/Delete next to an emoji takes the whole emoji. */
function removeAdjacentAtom(backward: boolean): boolean {
  const root = editor.value;
  const sel = window.getSelection();
  if (!root || !sel?.rangeCount || !sel.isCollapsed) return false;
  const caret = sel.getRangeAt(0);
  if (!root.contains(caret.startContainer)) return false;
  const atom = adjacentAtom(root, { node: caret.startContainer, offset: caret.startOffset }, backward);
  if (!atom) return false;

  const range = document.createRange();
  range.selectNode(atom);
  select(range);
  if (!exec("delete") || atom.isConnected) {
    const at = document.createRange();
    at.setStartBefore(atom);
    at.collapse(true);
    atom.remove();
    select(at);
  }
  sync(true);
  return true;
}

function cutToMaxLength(): boolean {
  const root = editor.value;
  if (!root || !props.maxLength) return false;
  const value = readComposer(root);
  const chars = [...value.text];
  if (chars.length <= props.maxLength) return false;
  const text = chars.slice(0, props.maxLength).join("");
  renderValue({ text, entities: carryCustomEmoji(value.text, text, value.entities) });
  select(rangeAt(text.length));
  sync(true);
  return true;
}

// ── events ──

function onInput(event: Event) {
  if (quiet || composing || (event as InputEvent).isComposing) {
    sync(false);
    return;
  }
  if (cutToMaxLength()) return;
  sync(true);
}

function onCompositionStart() {
  composing = true;
}

function onCompositionEnd() {
  composing = false;
  if (!cutToMaxLength()) sync(true);
  if (pendingText !== null) {
    const next = pendingText;
    pendingText = null;
    if (next !== current.text) applyText(next);
  }
}

function onKeydown(event: KeyboardEvent) {
  // The IME owns the keys while it composes: its Enter picks a candidate, it does not send.
  if (event.isComposing || event.keyCode === 229) return;
  emit("keydown", event);
  if (event.defaultPrevented) return;

  if (event.key === "Enter") {
    event.preventDefault();
    if (props.singleLine || event.ctrlKey || event.metaKey) emit("submit", current.text);
    else insertLineBreak();
    return;
  }
  if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.altKey && !event.metaKey) {
    if (removeAdjacentAtom(event.key === "Backspace")) event.preventDefault();
  }
}

function onPaste(event: ClipboardEvent) {
  emit("paste", event);
  if (event.defaultPrevented) return;
  event.preventDefault();
  const data = event.clipboardData;
  const rich = readRichClipboard(data?.getData(RICH_CLIPBOARD_TYPE));
  const text = (rich?.text ?? data?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
  if (!text) return;
  const room = MAX_CUSTOM_EMOJI_PER_MESSAGE - (editor.value ? readComposer(editor.value).entities.length : 0);
  const entities = rich ? validCustomEmoji(text, rich.entities, Math.max(0, room)) : [];
  const fragment = composerFragment(document, { text, entities }, nodes, false);
  insertNodes([...fragment.childNodes]);
}

function selectedValue(): ComposerValue | null {
  const sel = window.getSelection();
  const root = editor.value;
  if (!root || !sel?.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const holder = document.createElement("div");
  holder.append(range.cloneContents());
  return readComposer(holder);
}

function onCopy(event: ClipboardEvent) {
  const value = selectedValue();
  if (!value || !event.clipboardData) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", value.text);
  if (value.entities.length) event.clipboardData.setData(RICH_CLIPBOARD_TYPE, JSON.stringify(value));
}

function onCut(event: ClipboardEvent) {
  onCopy(event);
  if (!event.defaultPrevented) return;
  if (!exec("delete")) {
    const sel = window.getSelection();
    if (sel?.rangeCount) sel.getRangeAt(0).deleteContents();
  }
  sync(true);
}

watch(
  () => props.modelValue,
  (next) => {
    if (next === current.text) return;
    if (composing) {
      pendingText = next;
      return;
    }
    applyText(next);
  },
);

onMounted(() => {
  document.addEventListener("selectionchange", onSelectionChange);
  if (props.modelValue) {
    renderValue({ text: props.modelValue, entities: [] });
    sync(false);
  }
  if (props.autofocus) focusEditor();
});

onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", onSelectionChange);
  savedRange = null;
});

// ── API ──

const api: Omit<MessageInputApi, "el"> = {
  insertEmoji(emoji, replace) {
    const node =
      typeof emoji === "string"
        ? nodes.emoji(emoji)
        : emojiNode(document, codepointsToString(emoji.codepoints), props.emojiSize, emoji);
    insertNodes([node], replace);
  },
  insertCustomEmoji(item: ExpressionItem, replace?: TextRange) {
    const root = editor.value;
    if (!root || props.disabled) return false;
    if (readComposer(root).entities.length >= MAX_CUSTOM_EMOJI_PER_MESSAGE) {
      emit("custom-emoji-limit");
      return false;
    }
    insertNodes([nodes.customEmoji(customEmojiFromItem(item, 0))], replace);
    return true;
  },
  insertTextAtCursor(text) {
    const root = editor.value;
    if (!root) return;
    const range = editorRange();
    const start = offsetAt(root, { node: range.startContainer, offset: range.startOffset });
    const end = offsetAt(root, { node: range.endContainer, offset: range.endOffset });
    api.replaceRange(start, Math.max(start, end), text);
  },
  replaceRange(start, end, replacement) {
    const root = editor.value;
    if (!root) return;
    const before = readComposer(root);
    replaceText(start, end, replacement);
    const text = before.text.slice(0, start) + replacement + before.text.slice(end);
    const delta = replacement.length - (end - start);
    const entities = validCustomEmoji(
      text,
      before.entities
        .filter((e) => e.offset + e.length <= start || e.offset >= end)
        .map((e) => (e.offset >= end ? customEmojiEntity(e, e.offset + delta) : e)),
    );
    const got = readComposer(root);
    if (got.text !== text || !sameEntities(got.entities, entities)) renderValue({ text, entities });
    sync(false);
    api.setCursorOffset(start + replacement.length);
  },
  getCursorOffset() {
    const root = editor.value;
    if (!root) return 0;
    const range = editorRange();
    return Math.min(offsetAt(root, { node: range.startContainer, offset: range.startOffset }), readComposer(root).text.length);
  },
  setCursorOffset(offset) {
    if (!editor.value) return;
    select(rangeAt(Math.max(0, offset)));
  },
  getTextBeforeCursor() {
    return api.getText().slice(0, api.getCursorOffset());
  },
  getText() {
    return editor.value ? readComposer(editor.value).text : "";
  },
  getValue() {
    return editor.value ? readComposer(editor.value) : { text: "", entities: [] };
  },
  setValue(value) {
    if (!editor.value) return;
    renderValue({ text: value.text, entities: validCustomEmoji(value.text, value.entities) });
    sync(false);
    if (isFocused()) select(rangeAt(value.text.length));
  },
  focus: focusEditor,
  blur() {
    editor.value?.blur();
  },
  clear() {
    if (!editor.value) return;
    editor.value.replaceChildren();
    savedRange = null;
    sync(false);
  },
};

defineExpose({ ...api, el: editor });
</script>

<template>
  <div class="message-input">
    <CustomEmojiOverlay tag="div" class="message-input__surface">
      <div
        ref="editor"
        class="message-input__editor"
        :contenteditable="!disabled"
        role="textbox"
        aria-multiline="true"
        :aria-placeholder="placeholder"
        :aria-disabled="disabled"
        @input="onInput"
        @keydown="onKeydown"
        @paste="onPaste"
        @copy="onCopy"
        @cut="onCut"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
        @focus="emit('focus')"
        @blur="emit('blur')"
      />
    </CustomEmojiOverlay>
    <div v-if="showPlaceholder" class="message-input__placeholder" @click="focusEditor">{{ placeholder }}</div>
  </div>
</template>

<style scoped>
.message-input {
  position: relative;
  width: 100%;
}

.message-input__editor {
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: inherit;
  font: inherit;
}

.message-input__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  padding-top: 5px;
  opacity: 0.5;
  pointer-events: none;
  user-select: none;
}

.message-input__editor :deep(.ce) {
  --ce-size: 20px;
  margin: 0 1px;
}

.message-input__editor :deep(.emojix-inline-emoji) {
  display: inline-block;
  vertical-align: middle;
  margin: 0 1px;
}

.message-input__editor :deep(.emojix-inline-sprite) {
  background-repeat: no-repeat;
}
</style>
