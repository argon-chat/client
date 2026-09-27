<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ExpressionKind, type ExpressionItem } from "@argon/glue";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { Switch } from "@argon/ui/switch";
import { ImageIcon, LoaderIcon, Trash2Icon, XIcon } from "lucide-vue-next";
import StickerView from "@/components/expressions/StickerView.vue";
import { toMedia, type ExpressionItemPatch } from "@/store/data/expressionsStore";
import { associatedEmojiError, extractEmoji, itemNameError, keywordsError } from "@/lib/expressions/limits";
import { useLocale } from "@/store/system/localeStore";

/**
 * Name, associated emoji, keywords and (emoji only) text colour of one item; delete and "use as
 * cover" too. Each action resolves to an i18n error key, or null when it went through.
 */
const props = defineProps<{
  open: boolean;
  item: ExpressionItem | null;
  /** Emoji names used by other items of the space (compared case-insensitively). */
  takenNames: ReadonlySet<string>;
  isCover: boolean;
  save: (patch: ExpressionItemPatch) => Promise<string | null>;
  remove: () => Promise<string | null>;
  setCover: () => Promise<string | null>;
}>();

const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useLocale();

const QUICK_EMOJI = ["😀", "😂", "🥰", "😎", "🤔", "😭", "😡", "👍", "👎", "❤️", "🔥", "🎉", "👀", "🙏", "💯", "✨"];

const name = ref("");
const emoji = ref<string[]>([]);
const emojiDraft = ref("");
const keywords = ref<string[]>([]);
const keywordDraft = ref("");
const textColor = ref(false);
const busy = ref<"save" | "delete" | "cover" | null>(null);
const serverError = ref<string | null>(null);
const confirmingDelete = ref(false);

const isEmoji = computed(() => props.item?.kind === ExpressionKind.Emoji);

watch(
  () => [props.open, props.item] as const,
  ([open, item]) => {
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

function addEmoji(values: string[]) {
  const next = [...emoji.value];
  for (const e of values) if (!next.includes(e)) next.push(e);
  emoji.value = next;
}

function onEmojiInput(value: string | number) {
  const text = String(value);
  const found = extractEmoji(text);
  if (found.length) {
    addEmoji(found);
    emojiDraft.value = "";
  } else {
    emojiDraft.value = text;
  }
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
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("expression_settings_item_edit_title") }}</DialogTitle>
      </DialogHeader>
      <form v-if="item" class="space-y-4" @submit.prevent="onSave">
        <div class="flex items-center gap-4">
          <div class="item-preview">
            <StickerView :media="toMedia(item)" :size="isEmoji ? 64 : 96" :autoplay="true" group="settings" />
          </div>
          <div class="flex-1 min-w-0 space-y-1.5">
            <Label for="expression-item-name">{{ t("expression_settings_item_name") }}</Label>
            <Input id="expression-item-name" v-model="name" autocomplete="off" spellcheck="false" />
            <p v-if="nameError" class="text-xs text-destructive">{{ t(nameError) }}</p>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label for="expression-item-emoji">{{ t("expression_settings_item_emoji") }}</Label>
          <div class="chips">
            <button
              v-for="e in emoji"
              :key="e"
              type="button"
              class="chip chip--emoji"
              :aria-label="t('expression_settings_remove_value', { value: e })"
              @click="removeEmoji(e)"
            >
              <span>{{ e }}</span>
              <XIcon class="w-3 h-3 opacity-60" />
            </button>
            <Input
              id="expression-item-emoji"
              :model-value="emojiDraft"
              class="chips__input"
              autocomplete="off"
              :placeholder="t('expression_settings_item_emoji_placeholder')"
              @update:model-value="onEmojiInput"
            />
          </div>
          <div class="flex flex-wrap gap-1">
            <button v-for="e in QUICK_EMOJI" :key="e" type="button" class="quick-emoji" @click="addEmoji([e])">{{ e }}</button>
          </div>
          <p v-if="emojiError" class="text-xs text-destructive">{{ t(emojiError) }}</p>
        </div>

        <div class="space-y-1.5">
          <Label for="expression-item-keywords">{{ t("expression_settings_item_keywords") }}</Label>
          <div class="chips">
            <button
              v-for="k in keywords"
              :key="k"
              type="button"
              class="chip"
              :aria-label="t('expression_settings_remove_value', { value: k })"
              @click="keywords = keywords.filter((x) => x !== k)"
            >
              <span>{{ k }}</span>
              <XIcon class="w-3 h-3 opacity-60" />
            </button>
            <Input
              id="expression-item-keywords"
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

        <div v-if="isEmoji" class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t("expression_settings_item_text_color") }}</div>
            <div class="text-xs text-muted-foreground">{{ t("expression_settings_item_text_color_hint") }}</div>
          </div>
          <Switch v-model="textColor" />
        </div>

        <p v-if="serverError" class="text-sm text-destructive">{{ t(serverError) }}</p>

        <DialogFooter class="gap-2 sm:justify-between">
          <div class="flex gap-2">
            <Button type="button" variant="destructive" size="sm" :disabled="!!busy" @click="onDelete">
              <LoaderIcon v-if="busy === 'delete'" class="w-4 h-4 mr-1.5 animate-spin" />
              <Trash2Icon v-else class="w-4 h-4 mr-1.5" />
              {{ t(confirmingDelete ? "expression_settings_delete_confirm" : "expression_settings_delete") }}
            </Button>
            <Button
              v-if="!isCover"
              type="button"
              variant="ghost"
              size="sm"
              :disabled="!!busy"
              @click="act('cover', setCover, false)"
            >
              <LoaderIcon v-if="busy === 'cover'" class="w-4 h-4 mr-1.5 animate-spin" />
              <ImageIcon v-else class="w-4 h-4 mr-1.5" />
              {{ t("expression_settings_item_set_cover") }}
            </Button>
          </div>
          <div class="flex gap-2">
            <Button type="button" variant="ghost" @click="emit('update:open', false)">{{ t("expression_settings_cancel") }}</Button>
            <Button type="submit" :disabled="!valid || !!busy">
              <LoaderIcon v-if="busy === 'save'" class="w-4 h-4 mr-1.5 animate-spin" />
              {{ t("expression_settings_save") }}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.item-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104px;
  height: 104px;
  flex: none;
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.5);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px;
  min-height: 40px;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
}

.chips:focus-within {
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.5);
}

.chips__input {
  flex: 1;
  min-width: 8rem;
  height: 28px;
  border: none;
  padding: 0 4px;
  background: transparent;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

.chip--emoji span {
  font-size: 1rem;
}

.quick-emoji {
  width: 30px;
  height: 30px;
  font-size: 1.1rem;
  border-radius: calc(var(--radius) - 4px);
}

.quick-emoji:hover {
  background: hsl(var(--accent));
}
</style>
