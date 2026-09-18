<script setup lang="ts">
import { computed, ref } from "vue";
import { Input } from "@argon/ui/input";
import { IconX } from "@tabler/icons-vue";
import { useLocale } from "@/store/system/localeStore";
import { TAG_LIMIT, TAG_MAX_LENGTH, type TagsContent } from "@/cosmetics/kinds/widget-tags";

/**
 * Tags, edited as tags.
 *
 * <b>It used to be two text fields, which is what a note is.</b> Side by side on a board the two
 * cards were indistinguishable — and a board editor exists to be looked at, so two cards that read
 * the same are two cards nobody can arrange.
 *
 * So the field is the pills: they live inside the box, the caret sits after the last one, and the
 * box takes the height the card was given. Which is also what the card itself looks like.
 */
const props = defineProps<{ content: TagsContent }>();

const emit = defineEmits<{ "update:content": [value: TagsContent] }>();

const { t } = useLocale();

const draft = ref("");
const field = ref<HTMLInputElement | null>(null);

const full = computed(() => props.content.tags.length >= TAG_LIMIT);

function add(): void {
  const tag = draft.value.trim().slice(0, TAG_MAX_LENGTH);

  draft.value = "";

  if (!tag || props.content.tags.includes(tag) || full.value) return;

  emit("update:content", { ...props.content, tags: [...props.content.tags, tag] });
}

function drop(tag: string): void {
  emit("update:content", { ...props.content, tags: props.content.tags.filter(held => held !== tag) });
}

/** Backspace on an empty caret takes the last one off, the way every tag field does. */
function backspace(): void {
  if (draft.value.length > 0 || props.content.tags.length === 0) return;

  emit("update:content", { ...props.content, tags: props.content.tags.slice(0, -1) });
}
</script>

<template>
  <div class="tags-editor">
    <Input
      :model-value="content.heading ?? ''"
      :placeholder="t('cosmetic_widget_tags_heading')"
      :maxlength="48"
      class="h-7 text-xs"
      @update:model-value="emit('update:content', { ...content, heading: String($event) })"
    />

    <div class="tags-field" @click="field?.focus()">
      <!--
        Empty, it still has to look like a field of tags. Two cards whose empty state is a heading
        over a blank box are the same card as far as anybody arranging a board can tell, and the
        difference between this and a note only showed once both were filled in.
      -->
      <span v-if="content.tags.length === 0" class="tags-ghosts" aria-hidden="true">
        <span class="tag-ghost" style="width: 46px" />
        <span class="tag-ghost" style="width: 32px" />
        <span class="tag-ghost" style="width: 54px" />
      </span>

      <button v-for="tag in content.tags" :key="tag" class="tag" @click.stop="drop(tag)">
        <span>{{ tag }}</span>
        <IconX class="w-3 h-3 shrink-0" />
      </button>

      <input
        ref="field"
        v-model="draft"
        class="tags-caret"
        :maxlength="TAG_MAX_LENGTH"
        :disabled="full"
        @keydown.enter.prevent="add"
        @keydown.delete="backspace"
        @blur="add"
      />
    </div>

    <!--
      The prompt lives on the count line rather than in the field, because the field is showing the
      shape of a tag and a placeholder on top of that is two hints in one place.
    -->
    <div class="tags-count">
      {{ content.tags.length === 0 ? t("cosmetic_widget_tags_add") : `${content.tags.length} / ${TAG_LIMIT}` }}
    </div>
  </div>
</template>

<style scoped>
.tags-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

/* The field is the pills. It takes what the card has left, so a tall card is a tall field. */
.tags-field {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 4px;
  flex: 1;
  min-height: 0;
  padding: 6px;
  border-radius: 9px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  overflow-y: auto;
  scrollbar-width: thin;
  cursor: text;
}

/* Behind the caret rather than beside it, so the field is a field and not a list of nothing. */
.tags-ghosts {
  position: absolute;
  inset: 6px 6px auto 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  pointer-events: none;
}

.tag-ghost {
  height: 21px;
  border-radius: 999px;
  border: 1px dashed hsl(var(--border));
  background: hsl(var(--muted-foreground) / 0.06);
}

.tag {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 6px 2px 8px;
  border-radius: 999px;
  border: 1px solid hsl(var(--primary) / 0.35);
  background: hsl(var(--primary) / 0.14);
  font-size: 0.68rem;
  white-space: nowrap;
}

.tag:hover {
  border-color: hsl(var(--destructive));
  background: hsl(var(--destructive) / 0.2);
}

/* Sits after the last pill and takes whatever the row has left, like a caret rather than a box. */
.tags-caret {
  flex: 1;
  min-width: 70px;
  height: 21px;
  border: none;
  background: none;
  font-size: 0.7rem;
  outline: none;
}

.tags-count {
  flex: 0 0 auto;
  font-size: 0.62rem;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: hsl(var(--muted-foreground));
}
</style>
