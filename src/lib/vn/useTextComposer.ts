/**
 * MessageInput as a `<textarea>`, for vue-native: the same props, events and exposed API, so its
 * parents (EnterText and whatever reaches the composer through it) do not change. The value is
 * textComposer's `{ text, entities }`, a custom emoji showing as its `:name:`.
 *
 * vue-native has no contenteditable, Selection or Range, which is what the rich composer is built
 * from. vue-native's research/reports/m26/client-gap.md §4, "<textarea> composer"; A-webapi.md #62.
 *
 * **The caret.** Where the field has `selectionStart` and `setSelectionRange` (every browser), the
 * caret is the field's own. vue-native's textarea has neither yet, and a text given to it leaves its
 * caret at the end. There the caret is worked out instead:
 * - after the user's edit, it is where the edit ended (exact, except inside a run of one repeated
 *   character, where it is the end of the run);
 * - after a text was set (an emoji put in, a mention, a draft), it is at the end, where the field put it;
 * - after an arrow key, Home/End or a click, it is unknown, and reported at the end until the next edit.
 * The composer's own edits chain on the caret they meant (an emoji, then a space after it), as in the
 * rich composer; only what the field shows afterwards differs. It says so once in the console.
 */
import { computed, nextTick, onMounted, shallowRef, watch, type Ref } from "vue";
import { codepointsToString } from "@argon-chat/emojix";
import type { MessageEntityCustomEmoji } from "@argon/glue";
import type { ComposerValue } from "@/lib/chat/composerDom";
import {
  carryCustomEmoji,
  customEmojiAlt,
  customEmojiFromItem,
  MAX_CUSTOM_EMOJI_PER_MESSAGE,
  validCustomEmoji,
} from "@/lib/chat/customEmoji";
import {
  readRichClipboard,
  RICH_CLIPBOARD_TYPE,
  type MessageInputApi,
  type TextRange,
} from "@/components/chats/messageInput";
import { cutToMaxLength, fieldEdit, replaceRange } from "./textComposer";

/** MessageInput's props, as far as the field reads them. */
export interface TextComposerProps {
  modelValue: string;
  maxLength?: number;
  disabled: boolean;
  autofocus: boolean;
  singleLine: boolean;
}

interface Events {
  "update:modelValue": [value: string];
  "update:entities": [entities: MessageEntityCustomEmoji[]];
  submit: [value: string];
  focus: [];
  blur: [];
  keydown: [event: KeyboardEvent];
  input: [previous: string];
  paste: [event: ClipboardEvent];
  "custom-emoji-limit": [];
}
type Emit = <K extends keyof Events>(event: K, ...args: Events[K]) => void;

/** The field grows with its lines up to about MessageInput's max-height, then scrolls. */
const MAX_ROWS = 8;
/** Keys that move the caret without an edit, where a field without a selection API hides it. */
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

type Field = HTMLTextAreaElement;

const hasSelection = (el: Field | null): el is Field =>
  !!el && typeof el.selectionStart === "number" && typeof el.setSelectionRange === "function";

let advised = false;
function adviseCaret() {
  if (advised) return;
  advised = true;
  console.warn(
    "[vue-native] composer: this <textarea> has no selectionStart/setSelectionRange, so a text set by the app leaves the caret at its end, and the caret is read from the last edit",
  );
}

const sameEntities = (a: readonly MessageEntityCustomEmoji[], b: readonly MessageEntityCustomEmoji[]) =>
  a.length === b.length && a.every((e, i) => e.offset === b[i].offset && e.itemId === b[i].itemId);

/** `emit` is MessageInput's own; its events are the ones above. */
export function useTextComposer(props: Readonly<TextComposerProps>, emit: (...args: any[]) => void, field: Ref<Field | null>) {
  const send = emit as Emit;
  const value = shallowRef<ComposerValue>({ text: props.modelValue, entities: [] });
  /** What the field shows: the text it last reported, or the last one given to it. */
  let shown = props.modelValue;
  /** Where the composer's own edits put the caret, until the field shows their text. */
  let pending: number | null = null;
  /** Set when the field is being given a text: that moves its caret to the end. */
  let written = false;
  /** With no selection API: the caret as the last edit left it; null when not known (at the end). */
  let tracked: number | null = null;

  function selection(): TextRange {
    const length = value.value.text.length;
    if (pending !== null) return { start: pending, end: pending };
    const el = field.value;
    if (hasSelection(el)) {
      const start = Math.min(el.selectionStart, length);
      return { start, end: Math.max(start, Math.min(el.selectionEnd, length)) };
    }
    const at = Math.min(tracked ?? length, length);
    return { start: at, end: at };
  }

  /** Runs once the field shows the latest text: puts its caret where the composer meant it. */
  function placeCaret() {
    const at = pending;
    const wrote = written;
    pending = null;
    written = false;
    if (at === null) return;
    const el = field.value;
    if (hasSelection(el)) {
      el.setSelectionRange(at, at);
      return;
    }
    if (at !== value.value.text.length) adviseCaret();
    if (wrote) tracked = null;
  }

  function moveCaret(at: number) {
    pending = Math.max(0, Math.min(at, value.value.text.length));
    void nextTick(placeCaret);
  }

  /** Makes `next` the value and tells the parent, as MessageInput's `sync` does. */
  function commit(next: ComposerValue, userInput: boolean, caret: number | null = null) {
    const previous = value.value;
    value.value = next;
    // v-model gives the field a text that differs from what it shows, at the next render.
    if (next.text !== shown) {
      shown = next.text;
      written = true;
      moveCaret(caret ?? next.text.length);
    } else if (caret !== null) moveCaret(caret);
    if (next.text !== previous.text) send("update:modelValue", next.text);
    if (!sameEntities(next.entities, previous.entities)) send("update:entities", next.entities);
    if (userInput) send("input", previous.text);
  }

  /** The field's text changed under the user's hands (v-model's input). */
  function onFieldText(next: string) {
    shown = next;
    const el = field.value;
    const exact = hasSelection(el) ? el.selectionStart : null;
    let edit = fieldEdit(value.value, next, exact);
    const cut = cutToMaxLength(edit.value, props.maxLength);
    if (cut) edit = { value: cut, caret: cut.text.length };
    if (edit.value.text === next) {
      // The field shows the result already, caret and all.
      if (exact === null) tracked = edit.caret;
      commit(edit.value, true);
    } else commit(edit.value, true, edit.caret);
  }

  /** Puts text (and its custom emoji) over `replace`, or the selection, as the user's input. */
  function insert(text: string, emoji: MessageEntityCustomEmoji[] = [], replace?: TextRange) {
    api.focus();
    const { start, end } = replace ?? selection();
    const edit = replaceRange(value.value, start, end, text, emoji);
    commit(edit.value, true, edit.caret);
  }

  function onKeydown(event: KeyboardEvent) {
    // The IME owns the keys while it composes: its Enter picks a candidate, it does not send.
    if (event.isComposing || event.keyCode === 229) return;
    send("keydown", event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      // Always ours: vue-native's field breaks the line on Enter only, never on Shift+Enter.
      event.preventDefault();
      if (props.singleLine || event.ctrlKey || event.metaKey) send("submit", value.value.text);
      else insert("\n");
      return;
    }
    if (CARET_KEYS.has(event.key)) tracked = null;
  }

  /** A press in the field can put the caret anywhere. */
  function onPointerDown() {
    tracked = null;
  }

  function onPaste(event: ClipboardEvent) {
    send("paste", event);
    if (event.defaultPrevented) return;
    // Plain text is the field's own paste. A copy out of a composer carries its custom emoji.
    const rich = readRichClipboard(event.clipboardData?.getData(RICH_CLIPBOARD_TYPE));
    if (!rich) return;
    event.preventDefault();
    const text = rich.text.replace(/\r\n?/g, "\n");
    const room = Math.max(0, MAX_CUSTOM_EMOJI_PER_MESSAGE - value.value.entities.length);
    insert(text, validCustomEmoji(text, rich.entities, room));
  }

  watch(
    () => props.modelValue,
    (next) => {
      if (next === value.value.text) return;
      commit({ text: next, entities: carryCustomEmoji(value.value.text, next, value.value.entities) }, false);
    },
  );

  onMounted(() => {
    if (props.autofocus) api.focus();
  });

  const api: Omit<MessageInputApi, "el"> = {
    insertEmoji(emoji, replace) {
      if (props.disabled) return;
      insert(typeof emoji === "string" ? emoji : codepointsToString(emoji.codepoints), [], replace);
    },
    insertCustomEmoji(item, replace) {
      if (props.disabled) return false;
      if (value.value.entities.length >= MAX_CUSTOM_EMOJI_PER_MESSAGE) {
        send("custom-emoji-limit");
        return false;
      }
      insert(customEmojiAlt(item.name), [customEmojiFromItem(item, 0)], replace);
      return true;
    },
    insertTextAtCursor(text) {
      const { start, end } = selection();
      api.replaceRange(start, end, text);
    },
    replaceRange(start, end, replacement) {
      const edit = replaceRange(value.value, start, end, replacement);
      commit(edit.value, false, edit.caret);
    },
    getCursorOffset() {
      return selection().start;
    },
    setCursorOffset(offset) {
      moveCaret(offset);
    },
    getTextBeforeCursor() {
      return api.getText().slice(0, api.getCursorOffset());
    },
    getText() {
      return value.value.text;
    },
    getValue() {
      return { text: value.value.text, entities: [...value.value.entities] };
    },
    setValue(next) {
      const focused = !!field.value && document.activeElement === field.value;
      commit({ text: next.text, entities: validCustomEmoji(next.text, next.entities) }, false, focused ? next.text.length : null);
    },
    focus() {
      if (!props.disabled) field.value?.focus({ preventScroll: true });
    },
    blur() {
      field.value?.blur();
    },
    clear() {
      commit({ text: "", entities: [] }, false);
    },
  };

  return {
    /** The field's v-model: it is told the text only when it shows another (vModelText). */
    text: computed({ get: () => value.value.text, set: onFieldText }),
    rows: computed(() => Math.min(MAX_ROWS, value.value.text.split("\n").length)),
    onKeydown,
    onPaste,
    onPointerDown,
    onFocus: () => send("focus"),
    onBlur: () => send("blur"),
    api,
  };
}
