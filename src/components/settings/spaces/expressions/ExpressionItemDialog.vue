<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { codepointsToString, emojiRegistry, loadKeywordIndex, type KeywordIndex } from "@argon-chat/emojix";
import { ExpressionKind, type ExpressionItem } from "@argon/glue";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { Switch } from "@argon/ui/switch";
import { ImageIcon, LoaderIcon, Trash2Icon, XIcon } from "lucide-vue-next";
import StickerView from "@/components/expressions/StickerView.vue";
import { toMedia, type ExpressionItemPatch } from "@/store/data/expressionsStore";
import { EXPRESSION_LIMITS, associatedEmojiError, extractEmoji, itemNameError, keywordsError } from "@/lib/expressions/limits";
import { animationsEnabled } from "@/lib/expressions/settings";
import { emojiForName } from "@/lib/chat/emojiSuggest/names";
import { emojiSuggestionsEnabled } from "@/lib/chat/emojiSuggest/settings";
import { textOfHexcode } from "@/lib/chat/emojiSuggest/emoji";
import { useLocale } from "@/store/system/localeStore";

/**
 * Name, associated emoji (optional), keywords and (emoji only) text colour of one item; delete and
 * "use as pack cover" where the member may. Each action resolves to an i18n error key, or null when
 * it went through.
 */
const props = defineProps<{
  open: boolean;
  item: ExpressionItem | null;
  /** Emoji names used by other items of the space (compared case-insensitively). */
  takenNames: ReadonlySet<string>;
  isCover: boolean;
  /** The pack is the member's to change (its cover among it). */
  canSetCover: boolean;
  save: (patch: ExpressionItemPatch) => Promise<string | null>;
  remove: () => Promise<string | null>;
  setCover: () => Promise<string | null>;
}>();

const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useLocale();

const QUICK_EMOJI = ["😀", "😂", "🥰", "😎", "🤔", "😭", "😡", "👍", "👎", "❤️", "🔥", "🎉", "👀", "🙏", "💯", "✨"];
const MAX_EMOJI = EXPRESSION_LIMITS.maxAssociatedEmoji;

const name = ref("");
const emoji = ref<string[]>([]);
const emojiDraft = ref("");
const keywords = ref<string[]>([]);
const keywordDraft = ref("");
const textColor = ref(false);
const busy = ref<"save" | "delete" | "cover" | null>(null);
const serverError = ref<string | null>(null);
const confirmingDelete = ref(false);
const emojiInput = ref<HTMLInputElement | null>(null);
const keywordInput = ref<HTMLInputElement | null>(null);

const isEmoji = computed(() => props.item?.kind === ExpressionKind.Emoji);

// Keyed on the item's id: a store update to the same item (a new cover) keeps what is being typed.
watch(
  () => [props.open, props.item?.itemId] as const,
  ([open]) => {
    const item = props.item;
    if (!open || !item) return;
    name.value = item.name;
    emoji.value = [...item.emoji];
    keywords.value = [...item.keywords];
    textColor.value = item.textColor;
    emojiDraft.value = "";
    keywordDraft.value = "";
    serverError.value = null;
    confirmingDelete.value = false;
  },
  { immediate: true },
);

const nameError = computed(() => {
  const item = props.item;
  if (!item) return null;
  const error = itemNameError(item.kind, name.value);
  if (error) return error;
  if (item.kind === ExpressionKind.Emoji && name.value.toLowerCase() !== item.name.toLowerCase() && props.takenNames.has(name.value.toLowerCase())) {
    return "expression_settings_name_taken";
  }
  return null;
});
const emojiError = computed(() => associatedEmojiError(emoji.value));

// No emoji yet: a few the name suggests (`pepe_cry` → 😢), one tap each. Not with suggestions off.
const nameIndex = shallowRef<KeywordIndex | null>(null);
watch(
  () => props.open && emojiSuggestionsEnabled.value && !emoji.value.length,
  (wanted) => {
    if (!wanted) {
      if (!props.open || !emojiSuggestionsEnabled.value) nameIndex.value = null;
      return;
    }
    if (nameIndex.value) return;
    loadKeywordIndex("en")
      .then((index) => {
        if (props.open && emojiSuggestionsEnabled.value) nameIndex.value = index;
      })
      .catch(() => {});
  },
  { immediate: true },
);

const nameEmoji = computed(() => {
  const index = nameIndex.value;
  if (!index || emoji.value.length || !name.value.trim()) return [];
  return emojiForName(name.value, index).map((hex) => {
    const entry = emojiRegistry.getByHexcode(hex);
    return entry ? codepointsToString(entry.codepoints) : textOfHexcode(hex);
  });
});
const keywordError = computed(() => keywordsError(keywords.value));

const patch = computed<ExpressionItemPatch>(() => {
  const item = props.item;
  const out: ExpressionItemPatch = {};
  if (!item) return out;
  if (name.value !== item.name) out.name = name.value;
  if (emoji.value.join("\u0000") !== item.emoji.join("\u0000")) out.emoji = [...emoji.value];
  if (keywords.value.join("\u0000") !== item.keywords.join("\u0000")) out.keywords = [...keywords.value];
  if (isEmoji.value && textColor.value !== item.textColor) out.textColor = textColor.value;
  return out;
});

const dirty = computed(() => Object.keys(patch.value).length > 0);
const valid = computed(() => !nameError.value && !emojiError.value && !keywordError.value);

// Emoji names are `[a-z0-9_]`: capitals and spaces are turned into what they must be as they are typed.
function onNameInput(value: string | number) {
  const text = String(value);
  name.value = isEmoji.value ? text.toLowerCase().replace(/\s+/g, "_") : text;
}

function addEmoji(values: string[]) {
  const next = [...emoji.value];
  for (const e of values) if (!next.includes(e) && next.length < MAX_EMOJI) next.push(e);
  emoji.value = next;
}

function toggleEmoji(value: string) {
  if (emoji.value.includes(value)) removeEmoji(value);
  else addEmoji([value]);
}

function onEmojiInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const found = extractEmoji(input.value);
  if (found.length) {
    addEmoji(found);
    emojiDraft.value = "";
    input.value = "";
  } else {
    emojiDraft.value = input.value;
  }
}

function onEmojiKeydown(e: KeyboardEvent) {
  if (e.key === "Backspace" && !emojiDraft.value && emoji.value.length) emoji.value = emoji.value.slice(0, -1);
  else if (e.key === "Enter") e.preventDefault();
}

function removeEmoji(value: string) {
  emoji.value = emoji.value.filter((e) => e !== value);
}

function commitKeyword() {
  const word = keywordDraft.value.trim();
  keywordDraft.value = "";
  if (word && !keywords.value.includes(word)) keywords.value = [...keywords.value, word];
}

function onKeywordKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    commitKeyword();
  } else if (e.key === "Backspace" && !keywordDraft.value && keywords.value.length) {
    keywords.value = keywords.value.slice(0, -1);
  }
}

function focusIn(input: HTMLInputElement | null, e: MouseEvent) {
  if (e.target === e.currentTarget) void nextTick(() => input?.focus());
}

async function act(kind: "save" | "delete" | "cover", run: () => Promise<string | null>, closeOnSuccess: boolean) {
  if (busy.value) return;
  busy.value = kind;
  serverError.value = null;
  try {
    const error = await run();
    if (error) serverError.value = error;
    else if (closeOnSuccess) emit("update:open", false);
  } finally {
    busy.value = null;
  }
}

function onSave() {
  commitKeyword();
  if (!valid.value) return;
  if (!dirty.value) {
    emit("update:open", false);
    return;
  }
  void act("save", () => props.save(patch.value), true);
}

function onDelete() {
  if (!confirmingDelete.value) {
    confirmingDelete.value = true;
    return;
  }
  void act("delete", props.remove, true);
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-[560px] grid-cols-[minmax(0,1fr)] overflow-x-hidden p-5 sm:p-6" data-expression-item-dialog>
      <DialogHeader class="min-w-0 pr-6 text-left sm:text-left">
        <DialogTitle class="truncate">{{ t("expression_settings_item_edit_title") }}</DialogTitle>
      </DialogHeader>
      <form v-if="item" class="item-form" @submit.prevent="onSave">
        <div class="flex items-start gap-4 min-w-0">
          <div class="item-preview">
            <StickerView :media="toMedia(item)" :size="96" :autoplay="animationsEnabled" loop group="settings" />
          </div>
          <div class="name-field flex-1 min-w-0 space-y-1.5 pt-1">
            <Label for="expression-item-name">{{ t("expression_settings_item_name") }}</Label>
            <Input
              id="expression-item-name"
              :model-value="name"
              autocomplete="off"
              spellcheck="false"
              :maxlength="isEmoji ? EXPRESSION_LIMITS.emojiNameMax : EXPRESSION_LIMITS.stickerNameMax"
              :aria-invalid="!!nameError"
              @update:model-value="onNameInput"
            />
            <p v-if="nameError" class="text-xs text-destructive" data-name-error>{{ t(nameError) }}</p>
            <p v-else-if="isEmoji" class="text-xs text-muted-foreground break-words">
              {{ t("expression_settings_item_name_hint_emoji", { code: `:${name}:` }) }}
            </p>
            <p v-else class="text-xs text-muted-foreground">{{ t("expression_settings_name_length_sticker") }}</p>
          </div>
        </div>

        <div class="field">
          <div class="field__head">
            <Label for="expression-item-emoji">{{ t("expression_settings_item_emoji") }}</Label>
            <span class="field__count">{{ emoji.length }} / {{ MAX_EMOJI }}</span>
          </div>
          <div class="chips" data-emoji-chips @click="focusIn(emojiInput, $event)">
            <button
              v-for="e in emoji"
              :key="e"
              type="button"
              class="chip chip--emoji"
              :aria-label="t('expression_settings_remove_value', { value: e })"
              @click="removeEmoji(e)"
            >
              <span>{{ e }}</span>
              <XIcon class="w-3 h-3 opacity-60" aria-hidden="true" />
            </button>
            <input
              id="expression-item-emoji"
              ref="emojiInput"
              class="chips__input"
              :value="emojiDraft"
              autocomplete="off"
              :disabled="emoji.length >= MAX_EMOJI"
              :placeholder="t('expression_settings_item_emoji_placeholder')"
              @input="onEmojiInput"
              @keydown="onEmojiKeydown"
            />
          </div>
          <div class="quick-emoji" data-quick-emoji>
            <button
              v-for="e in QUICK_EMOJI"
              :key="e"
              type="button"
              class="quick-emoji__btn"
              :class="{ 'quick-emoji__btn--on': emoji.includes(e) }"
              :aria-pressed="emoji.includes(e)"
              @click="toggleEmoji(e)"
            >
              {{ e }}
            </button>
          </div>
          <div v-if="nameEmoji.length" class="name-emoji" data-name-emoji>
            <span class="name-emoji__label">{{ t("expression_settings_item_emoji_suggested") }}</span>
            <button v-for="e in nameEmoji" :key="e" type="button" class="chip chip--emoji" data-name-emoji-chip @click="addEmoji([e])">
              <span>{{ e }}</span>
            </button>
          </div>
          <p class="text-xs" :class="emojiError ? 'text-destructive' : 'text-muted-foreground'">
            {{ t(emojiError ?? "expression_settings_item_emoji_hint") }}
          </p>
        </div>

        <div class="field">
          <div class="field__head">
            <Label for="expression-item-keywords">{{ t("expression_settings_item_keywords") }}</Label>
            <span class="field__count">{{ keywords.length }} / {{ EXPRESSION_LIMITS.maxKeywords }}</span>
          </div>
          <div class="chips" data-keyword-chips @click="focusIn(keywordInput, $event)">
            <button
              v-for="k in keywords"
              :key="k"
              type="button"
              class="chip"
              :aria-label="t('expression_settings_remove_value', { value: k })"
              @click="keywords = keywords.filter((x) => x !== k)"
            >
              <span class="chip__text">{{ k }}</span>
              <XIcon class="w-3 h-3 opacity-60 shrink-0" aria-hidden="true" />
            </button>
            <input
              id="expression-item-keywords"
              ref="keywordInput"
              v-model="keywordDraft"
              class="chips__input"
              autocomplete="off"
              :placeholder="t('expression_settings_item_keywords_placeholder')"
              @keydown="onKeywordKeydown"
              @blur="commitKeyword"
            />
          </div>
          <p v-if="keywordError" class="text-xs text-destructive">{{ t(keywordError) }}</p>
        </div>

        <div v-if="isEmoji" class="flex items-center justify-between gap-4 min-w-0">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t("expression_settings_item_text_color") }}</div>
            <div class="text-xs text-muted-foreground">{{ t("expression_settings_item_text_color_hint") }}</div>
          </div>
          <Switch v-model="textColor" class="shrink-0" />
        </div>

        <p v-if="serverError" class="text-sm text-destructive" role="alert">{{ t(serverError) }}</p>

        <div class="actions" data-dialog-actions>
          <div class="actions__group">
            <Button type="button" variant="destructive" size="sm" class="action" :disabled="!!busy" data-delete-item @click="onDelete">
              <LoaderIcon v-if="busy === 'delete'" class="w-4 h-4 mr-1.5 animate-spin shrink-0" />
              <Trash2Icon v-else class="w-4 h-4 mr-1.5 shrink-0" />
              {{ t(confirmingDelete ? "expression_settings_delete_confirm" : "expression_settings_delete") }}
            </Button>
            <Button
              v-if="canSetCover && !isCover"
              type="button"
              variant="outline"
              size="sm"
              class="action"
              :disabled="!!busy"
              data-set-cover
              @click="act('cover', setCover, false)"
            >
              <LoaderIcon v-if="busy === 'cover'" class="w-4 h-4 mr-1.5 animate-spin shrink-0" />
              <ImageIcon v-else class="w-4 h-4 mr-1.5 shrink-0" />
              {{ t("expression_settings_item_set_cover") }}
            </Button>
            <span v-else-if="isCover" class="cover-note" data-is-cover>
              <ImageIcon class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {{ t("expression_settings_item_is_cover") }}
            </span>
          </div>
          <div class="actions__group actions__group--end">
            <Button type="button" variant="ghost" size="sm" class="action" data-cancel @click="emit('update:open', false)">
              {{ t("expression_settings_cancel") }}
            </Button>
            <Button type="submit" size="sm" class="action" :disabled="!valid || !!busy" data-save>
              <LoaderIcon v-if="busy === 'save'" class="w-4 h-4 mr-1.5 animate-spin shrink-0" />
              {{ t("expression_settings_save") }}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.item-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.item-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 112px;
  height: 112px;
  flex: none;
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.5);
}

.name-field,
.field {
  overflow-wrap: anywhere;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.field__count {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--muted-foreground));
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  min-height: 40px;
  padding: 4px;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  cursor: text;
}

.chips:focus-within {
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.5);
}

.chips__input {
  flex: 1 1 8rem;
  min-width: 0;
  width: 0;
  height: 28px;
  padding: 0 6px;
  font-size: 0.875rem;
  border: none;
  outline: none;
  background: transparent;
  color: hsl(var(--foreground));
}

.chips__input::placeholder {
  color: hsl(var(--muted-foreground));
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  font-size: 0.8rem;
  border-radius: 999px;
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
}

.chip:hover {
  background: hsl(var(--accent));
}

.chip__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip--emoji span {
  font-size: 1rem;
  line-height: 1;
}

.quick-emoji {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
}

.quick-emoji__btn {
  width: 30px;
  height: 30px;
  font-size: 1.1rem;
  line-height: 1;
  border-radius: calc(var(--radius) - 4px);
  opacity: 0.75;
}

.quick-emoji__btn:hover {
  background: hsl(var(--accent));
  opacity: 1;
}

.name-emoji {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.name-emoji__label {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.quick-emoji__btn--on {
  background: hsl(var(--primary) / 0.15);
  box-shadow: inset 0 0 0 1px hsl(var(--primary) / 0.5);
  opacity: 1;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-top: 4px;
}

.actions__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}

.actions__group--end {
  margin-left: auto;
}

/* A long label wraps inside its button rather than pushing out of the dialog. */
.action {
  max-width: 100%;
  height: auto;
  min-height: 2.25rem;
  white-space: normal;
  text-align: left;
}

.cover-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}
</style>
